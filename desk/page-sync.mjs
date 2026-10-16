#!/usr/bin/env node
/**
 * page-sync.mjs: move data between the repo and the page database.
 * The daily task runs it; the ArtifactData tool does the actual reads and writes.
 *
 *   node desk/page-sync.mjs pull <dump dir>
 *       <dump dir> holds the page's collections as the ArtifactData tool saves them
 *       with out_dir: decisions/, requests/, requests_done/, source_switches/, prefs/.
 *       Merges decisions into data/page/decisions.json, applies source switches and
 *       requests (added jobs, blocks, job board links, suggestions), and prints what
 *       still needs Claude (source lookups, added jobs to check) as JSON.
 *
 *   node desk/page-sync.mjs since
 *       Prints the time to read decisions from (a week before the last pull that saw
 *       them), or "all" when every decision is needed.
 *
 *   node desk/page-sync.mjs done <request id> "<result>" [--posting <id>]
 *       Records that a request was handled; pushed as requests_done/<id>.
 *
 *   node desk/page-sync.mjs push [--problem "what|fix|detail"]... [--problems-file <file>] [--no-run] [--quick] [--update-file <update.mjs check output>]
 *       Writes batch files to data/page/outbox/: new postings, rescores, suggestions,
 *       deep evaluations, handled requests, resumes, the LinkedIn profile text (when changed), the source list (when changed) and
 *       the run document (left out with --no-run, for pushes outside the daily run).
 *       Prints the batch file paths. Every write is a create (no version needed).
 *
 *   node desk/page-sync.mjs ack <batch file>
 *       After a batch was written successfully: marks its documents as pushed.
 *
 *   node desk/page-sync.mjs sites [--cap N]
 *       Fills company websites known without a lookup (portals.yml `website:`, postings on
 *       the company's own site) into data/sites.json and prints the companies on the page
 *       still to look up, at most N (desk.yml site_cap, default 5): { to_look_up: [names] }.
 *
 *   node desk/page-sync.mjs resume-doc <id>
 *       Writes .work/resume-<id>.json with the fields push writes for that resume (master: from
 *       cv.md) and prints its path, for updating a resume already on the page.
 *
 *   node desk/page-sync.mjs sites --record <file.json>
 *       <file.json>: [{ company, url | null }] from the run's web searches. Keeps a url only
 *       when it is the company's own site (its address carries the company's name).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { postingDoc, belongsOnPage, runId, sourcesDoc, sourceCounts, slug } from './lib/page-docs.mjs';
import { loadScoringConfig } from './lib/scoring.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { loadBlocklist, listBlocked, addToBlacklist, removeFromBlacklist, websiteOf } from './lib/blocklist.mjs';
import { boardFor } from './lib/boards.mjs';
import { loadSites, saveSites, fillKnown, dueLookups, recordLookups, pageSites } from './lib/sites.mjs';
import { canonicalUrl, urlKey, seenKeys } from './lib/urls.mjs';
import { DATA, ROOT, isMain, safeId, dict, readYamlStrict } from './lib/env.mjs';
import { applySuggestion, decline as declineSuggestion } from './suggest.mjs';
import { addPending } from './daily.mjs';
import { parsePending } from './fetch-pending-jds.mjs';
import { check as checkLinkedin } from './linkedin.mjs';
import crypto from 'node:crypto';

const P = {
  page: path.join(DATA, 'data', 'page'),
  state: path.join(DATA, 'data', 'page', 'state.json'),
  decisions: path.join(DATA, 'data', 'page', 'decisions.json'),
  switchesApplied: path.join(DATA, 'data', 'page', 'switches-applied.json'),
  done: path.join(DATA, 'data', 'page', 'done'),
  gaps: path.join(DATA, 'data', 'page', 'gaps.json'),
  outbox: path.join(DATA, 'data', 'page', 'outbox'),
  scores: path.join(DATA, 'data', 'scores'),
  extractions: path.join(DATA, 'data', 'extractions'),
  deep: path.join(DATA, 'data', 'deep'),
  suggestions: path.join(DATA, 'data', 'suggestions'),
  jds: path.join(DATA, 'jds'),
  pipeline: path.join(DATA, 'data', 'pipeline.md'),
  history: path.join(DATA, 'data', 'scan-history.tsv'),
  runs: path.join(DATA, 'data', 'scan-runs.tsv'),
  portals: path.join(DATA, 'portals.yml'),
  desk: path.join(DATA, 'config', 'desk.yml'),
  scoring: path.join(DATA, 'config', 'scoring.yml'),
  resumes: path.join(DATA, 'resumes', 'index.yml'),
  linkedin: path.join(DATA, 'linkedin.yml'),
};
const VERSION = fs.readFileSync(path.join(ROOT, 'desk', 'VERSION'), 'utf8').trim();
const BATCH_MAX = 45;               // ArtifactData allows 50 writes per batch
const BATCH_BYTES = 900 * 1024;     // and 1 MiB per batch
const DOC_MAX = 250 * 1024;         // and 256 KiB per document

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const nowIso = () => new Date().toISOString();
const text = (v, max = 200) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
// Morning runs kept in the run document's history (Stats shows them).
export const HISTORY_DAYS = 30;
const state = () => readJson(P.state, { pushed: {}, sources_hash: null, last_good_run: null, search_start: null });

/** One collection from the dump as { id: body }, only ids that are safe as file names. null when the folder is absent. */
function readDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = dict();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || !safeId(f.slice(0, -5))) continue;
    const v = readJson(path.join(dir, f), null);
    if (v && typeof v === 'object' && !Array.isArray(v)) out[f.slice(0, -5)] = v;
  }
  return out;
}
function allJds() {
  if (!fs.existsSync(P.jds)) return [];
  const out = [];
  for (const f of fs.readdirSync(P.jds).filter(f => f.endsWith('.md'))) {
    try { out.push({ file: f, id: f.slice(0, -3), ...readFrontMatter(path.join(P.jds, f)).meta }); } catch { /* unreadable: skipped */ }
  }
  return out;
}

// portals.yml keeps its leading comment block when rewritten.
function readPortals() { return readYamlStrict(yaml, P.portals, {}); }
function writePortals(obj) {
  const raw = fs.existsSync(P.portals) ? fs.readFileSync(P.portals, 'utf8') : '';
  const header = (raw.match(/^(#[^\n]*\n)+/) || [''])[0];
  fs.writeFileSync(P.portals, header + yaml.dump(obj, { lineWidth: 160, noRefs: true }));
}
// desk.yml is edited line by line so its comments survive.
// The daily limits she can change on her page: [lowest, highest, plain name].
const CAP_LIMITS = { web_cap: [0, 30, 'Web searches each morning'], daily_cap: [1, 100, 'Jobs scored each day'], deep_cap: [0, 10, 'Deep evaluations each day'] };

function setDeskKey(key, value) {
  const raw = fs.existsSync(P.desk) ? fs.readFileSync(P.desk, 'utf8') : '';
  const line = `${key}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}:[^\\n#]*?([ \\t]*#[^\\n]*)?$`, 'm');
  fs.writeFileSync(P.desk, re.test(raw) ? raw.replace(re, (m, comment) => `${line}${comment || ''}`) : `${raw.trimEnd()}\n${line}\n`);
}

// ------------------------------------------------------------------ pull

// Which run this is: "quick" when she clicked Run now in the last 20 minutes, no run has
// finished since and no other run already took that click; otherwise "normal" (the scheduled morning run).
export function runMode(rn, lastRunAt, now = Date.now(), seenAt = null) {
  if (!rn || typeof rn !== 'object' || rn.failed) return 'normal';
  const kind = rn.kind === undefined ? 'quick' : rn.kind;
  const at = Date.parse(rn.at);
  if (kind !== 'quick' || !Number.isFinite(at) || at > now + 60000 || now - at > 20 * 60000) return 'normal';
  if (seenAt && seenAt === rn.at) return 'normal';   // a run already took this click
  const last = Date.parse(lastRunAt || '');
  return Number.isFinite(last) && last >= at ? 'normal' : kind;
}

async function pull(dumpDir) {
  if (!dumpDir || !fs.existsSync(dumpDir)) throw new Error(`dump folder not found: ${dumpDir}`);
  const st0 = state();
  st0.pulled_at = nowIso();   // when this run read her switches; the sources document carries it, and the page treats older switches as applied
  const decisions = readDir(path.join(dumpDir, 'decisions'));
  const requests = readDir(path.join(dumpDir, 'requests')) || dict();
  const doneRemote = readDir(path.join(dumpDir, 'requests_done')) || dict();
  const switches = readDir(path.join(dumpDir, 'source_switches')) || dict();
  const prefs = readDir(path.join(dumpDir, 'prefs')) || dict();
  // No decisions folder means the list wasn't saved, not that every decision is gone.
  if (decisions) {
    writeJson(P.decisions, Object.assign(dict(), readJson(P.decisions, {}), decisions));
    st0.decisions_synced_at = nowIso();   // `since` reads decisions changed from a week before this
  }
  const mode = runMode(prefs.run_now, st0.last_run_at, Date.now(), st0.run_now_seen);
  if (mode === 'quick') st0.run_now_seen = prefs.run_now.at;   // this run takes the click; another session that reads the same click runs normal
  writeJson(P.state, st0);

  const summary = { mode, decisions: decisions ? Object.keys(decisions).length : 'unchanged (no decisions folder in the dump)', jobs_queued: [], sources_to_set_up: [], switches_applied: [], dismissed: [], blocked: [], unblocked: [], errors: [] };
  const doneLocal = new Set(fs.existsSync(P.done) ? fs.readdirSync(P.done).map(f => f.replace(/\.json$/, '')) : []);
  const seen = seenKeys(DATA);
  const jdByKey = new Map();
  for (const j of allJds()) { const k = urlKey(j.url); if (k && !jdByKey.has(k)) jdByKey.set(k, j.id); }

  // Group switches and single source switches apply in the order they were clicked, so the newest wins (as on the page).
  const applied = readJson(P.switchesApplied, {});
  const events = [];
  for (const [sid, sw] of Object.entries(switches)) if (typeof sw.on === 'boolean' && sw.at && applied[sid] !== sw.at) events.push({ at: String(sw.at), sid, sw });

  const open = Object.entries(requests).filter(([rid]) => !doneRemote[rid] && !doneLocal.has(rid)).sort((a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')));
  const boardAt = {};
  for (const [rid, r] of open) {
    if (r.kind === 'switch_group') { events.push({ at: String(r.at || ''), rid, r }); continue; }
    try { await handle(rid, r, summary, { seen, jdByKey, boardAt }); }
    catch (e) {
      done(rid, "Couldn't do this one. If it matters, copy the message for Erik from the status line at the bottom of the page.");
      summary.errors.push(`${r.kind} ${rid}: ${e.message}`);
    }
  }

  if (events.length) {
    let portals;
    try { portals = readPortals(); } catch (e) { summary.errors.push(`portals.yml: ${e.message}`); portals = null; }
    let portalsChanged = false;
    events.sort((a, b) => a.at.localeCompare(b.at));
    for (const ev of events) {
      try {
        if (ev.r) {
          if (!portals) throw new Error('portals.yml could not be read');
          if (ev.r.group !== 'search') { done(ev.rid, 'Nothing to change'); continue; }
          let n = 0;
          for (const co of portals.tracked_companies || []) {
            if (!co?.name || co.dream || await boardFor(co)) continue;
            co.enabled = !!ev.r.on; n++;
          }
          portalsChanged = true;
          done(ev.rid, `${n} ${n === 1 ? 'company' : 'companies'} turned ${ev.r.on ? 'on' : 'off'}`);
          summary.switches_applied.push({ id: 'group:search', on: !!ev.r.on, count: n });
        } else if (ev.sid === 'gmail') {
          setDeskKey('gmail_alerts', !!ev.sw.on);
          applied[ev.sid] = ev.sw.at;
          summary.switches_applied.push({ id: 'gmail', on: !!ev.sw.on });
        } else if (ev.sid === 'web' || ev.sid === 'sweep') {
          setDeskKey(ev.sid === 'web' ? 'web_search' : 'board_sweep', !!ev.sw.on);
          applied[ev.sid] = ev.sw.at;
          summary.switches_applied.push({ id: ev.sid, on: !!ev.sw.on });
        } else {
          if (!portals) throw new Error('portals.yml could not be read');
          if (boardAt[ev.sid] && ev.at < boardAt[ev.sid]) { applied[ev.sid] = ev.sw.at; continue; }   // the link she pasted later turned it on
          const co = (portals.tracked_companies || []).find(c => c?.name && `co-${slug(c.name)}` === ev.sid);
          applied[ev.sid] = ev.sw.at;
          if (!co) continue;
          co.enabled = !!ev.sw.on; portalsChanged = true;
          summary.switches_applied.push({ id: ev.sid, on: !!ev.sw.on });
        }
      } catch (e) { summary.errors.push(`switch ${ev.sid || ev.rid}: ${e.message}`); }
    }
    if (portalsChanged) writePortals(portals);
    writeJson(P.switchesApplied, applied);
  }
  if (!summary.errors.length) delete summary.errors;
  console.log(JSON.stringify(summary, null, 2));
}

async function handle(rid, r, summary, ctx) {
  const day = String(r.at || nowIso()).slice(0, 10);
  if (r.kind === 'add_job') return addJob(rid, r, summary, ctx);
  if (r.kind === 'add_description') return addDescription(rid, r, summary);
  if (r.kind === 'add_source') {
    summary.sources_to_set_up.push({ id: rid, text: text(r.text, 500), dream: !!r.dream, gap: safeId(r.gap) ? r.gap : null });
    return;
  }
  if (r.kind === 'block_company' && text(r.company)) {
    const site = r.website ? websiteOf(r.company) : null;
    if (r.website && !site) return done(rid, `${text(r.company, 120)} isn't a website address. Type it like jobright.ai`);
    const name = site || text(r.company, 120);
    const added = addToBlacklist(DATA, name, text(r.reason, 160) || 'Blocked from the job page', day, site ? 'domain' : 'company');
    done(rid, added ? `Blocked ${name}` : `${name} was already blocked`);
    summary.blocked.push(name);
    return;
  }
  if (r.kind === 'unblock_company' && text(r.company)) {
    const removed = removeFromBlacklist(DATA, text(r.company, 120));
    done(rid, removed ? `Unblocked ${text(r.company, 120)}` : `${text(r.company, 120)} wasn't on your list`);
    summary.unblocked.push(text(r.company, 120));
    return;
  }
  if (r.kind === 'set_board') {
    const url = canonicalUrl(r.url);
    const portals = readPortals();
    const co = (portals.tracked_companies || []).find(c => c?.name && `co-${slug(c.name)}` === r.source);
    if (!co) return done(rid, `${text(r.company, 120) || 'That company'} is no longer in your sources`);
    const board = url ? await boardFor(url) : null;
    if (!board) {
      (summary.boards_not_readable ||= []).push(co.name);
      return done(rid, `That link isn't a job board the scan can read. Try the link of one job posting from ${co.name}'s careers page.`);
    }
    co.careers_url = url; co.enabled = true; delete co.scan_method; delete co.scan_query; delete co.provider;
    writePortals(portals);
    if (ctx.boardAt) ctx.boardAt[r.source] = String(r.at || '');
    (summary.boards_set ||= []).push(co.name);
    return done(rid, `${co.name} is now checked daily`);
  }
  if (r.kind === 'apply_suggestion' || r.kind === 'decline_suggestion') {
    if (r.kind === 'decline_suggestion') { declineSuggestion(r.week, r.sid); return done(rid, 'Not now'); }
    try {
      const res = applySuggestion(r.week, r.sid);
      const moved = (res.rescored || []).length;
      done(rid, res.applied ? `Done: ${res.title}.${moved ? ` ${moved} open job${moved === 1 ? '' : 's'} rescored.` : ''}` : res.note);
      (summary.suggestions_applied ||= []).push({ title: res.title, rescored: moved });
    } catch (e) {
      done(rid, `Couldn't apply this one: ${e.message}`);
      (summary.suggestions_failed ||= []).push(e.message);
    }
    return;
  }
  if (r.kind === 'set_cap') {
    const lim = CAP_LIMITS[r.key];
    const v = Number(r.value);
    if (!lim || !Number.isInteger(v) || v < lim[0] || v > lim[1]) return done(rid, "That number isn't allowed");
    setDeskKey(r.key, v);
    summary.caps_set = [...(summary.caps_set || []), { key: r.key, value: v }];
    return done(rid, `${lim[2]}: ${v} from the next run`);
  }
  if (r.kind === 'dismiss_gap') {
    const gaps = readJson(P.gaps, []);
    writeJson(P.gaps, (Array.isArray(gaps) ? gaps : []).filter(g => g?.id !== r.gap));
    summary.dismissed.push(text(r.gap, 80));
    return done(rid, 'Dismissed');
  }
  done(rid, "This request isn't one the daily run knows how to handle.");
}

function addJob(rid, r, summary, { seen, jdByKey }) {
  const raw = String(r.text || '').slice(0, 60000);
  const found = (raw.match(/https?:\/\/[^\s<>"'|]+/) || [])[0];
  const url = found ? canonicalUrl(found.replace(/[).,;]+$/, '')) : null;
  const textOnly = !url || raw.trim().length > found.length + 200;
  const extra = { added: true, source: 'Added by you', applied: !!r.applied };
  const day = String(r.at || nowIso()).slice(0, 10);
  const key = url ? urlKey(url) : '';
  const soon = 'Scoring in this run';   // a quick run scores pasted text too (daily.mjs todo --priority-only)
  const entry = { id: rid, ...(url ? { url } : {}) };
  if (key && !seen.has(key)) entry.missed_by_scan = true;

  if (textOnly) {
    writeJd(rid, { url: url || '', company: 'Added job', title: 'Added job', found: day, jd: 'saved', ...extra }, raw);
    done(rid, soon, rid);
    summary.jobs_queued.push({ ...entry, how: 'pasted text saved; score it this run' });
    return;
  }
  // Already saved by the scan: take it over under this request's id (and its score, so it isn't scored twice).
  const known = jdByKey.get(key);
  if (known && known !== rid) {
    const { meta, body } = readFrontMatter(path.join(P.jds, `${known}.md`));
    const { id: _drop, added: _a, source: _s, applied: _p, ...rest } = meta;
    writeJd(rid, { ...rest, url, found: day, ...extra }, body);
    const ex = readJson(path.join(P.extractions, `${known}.json`), null);
    const sc = readJson(path.join(P.scores, `${known}.json`), null);
    if (ex) writeJson(path.join(P.extractions, `${rid}.json`), { ...ex, id: rid });
    if (sc?.verdict && sc.verdict.status !== 'unscorable') writeJson(path.join(P.scores, `${rid}.json`), { ...sc, verdict: { ...sc.verdict, id: rid } });
    done(rid, sc ? 'Added' : soon, rid, known);
    summary.jobs_queued.push({ ...entry, how: sc ? 'already scored; copied' : 'description already saved; score it this run' });
    return;
  }
  const res = queueLink(url, rid);
  done(rid, 'Scoring tomorrow, after the scan reads the posting', rid, res.replaces);
  summary.jobs_queued.push({ ...entry, on_job_site: /linkedin\.com|indeed\.com/.test(url), how: 'link queued; the next scan saves the description' });
}

// She pasted the description of a posting that was scored from its title only. Save it as the
// posting's text and put the posting back in line for scoring; the old score and extraction are
// kept under data/replaced/ (never deleted), and the new score reaches the page as a rescore.
function addDescription(rid, r, summary) {
  const id = r.posting;
  const raw = String(r.text || '').trim().slice(0, 60000);
  if (!safeId(id) || !fs.existsSync(path.join(P.jds, `${id}.md`))) return done(rid, "That job isn't in your copy any more.");
  if (raw.length < 200) return done(rid, 'That was too short to be a job description. Paste the whole description.');
  const { meta } = readFrontMatter(path.join(P.jds, `${id}.md`));
  const { id: _drop, ...rest } = meta;
  writeJd(id, { ...rest, jd: 'saved', pasted: true }, raw);
  const stamp = nowIso().replace(/[^0-9]/g, '').slice(0, 14);
  for (const [dir, f] of [[P.scores, `${id}.json`], [P.extractions, `${id}.json`]]) {
    const from = path.join(dir, f);
    if (fs.existsSync(from)) { const to = path.join(DATA, 'data', 'replaced', path.basename(dir), `${id}~${stamp}.json`); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); }
  }
  done(rid, 'Description saved. Scoring in this run', id);
  (summary.descriptions_added ||= []).push(id);
}

function writeJd(id, meta, body) {
  fs.mkdirSync(P.jds, { recursive: true });
  const head = ['---', ...Object.entries({ id, ...meta }).map(([k, v]) => `${k}: ${JSON.stringify(v ?? '')}`), '---', ''];
  fs.writeFileSync(path.join(P.jds, `${id}.md`), head.join('\n') + String(body || '').trim() + '\n');
}

/**
 * Put a link at the top of the Pending list under this id. Existing lines are never edited
 * (crossed saves merge line by line): the scan reads the list top down and saves each link
 * once, so this line wins over an older one with the same link. An earlier added job with
 * the same link is replaced (the page hides it).
 */
function queueLink(url, id) {
  const key = urlKey(url);
  const md = fs.existsSync(P.pipeline) ? fs.readFileSync(P.pipeline, 'utf8') : '';
  let replaces = null;
  for (const p of parsePending(md)) if (urlKey(p.url) === key && p.id && p.id !== id && p.source === 'Added by you') { replaces = p.id; break; }
  addPending([`- [ ] ${url} | Added job | Added job | | id: ${id} | source: Added by you`]);
  return { replaces };
}

function done(rid, result, postingId, replaces) {
  if (!safeId(rid)) throw new Error(`not a request id: ${rid}`);
  writeJson(path.join(P.done, `${rid}.json`), { at: nowIso(), result: text(result, 300), ...(postingId ? { posting_id: postingId } : {}), ...(replaces ? { replaces } : {}) });
}

// ------------------------------------------------------------------ push

async function push(args) {
  const st = state();
  const at = nowIso();
  st.pushed ||= {};
  const pushed = k => new Set(st.pushed[k] || []);
  const writes = [];
  const problems = [];
  const seenProblem = new Set();
  const problem = p => { if (p.what && !seenProblem.has(p.what)) { seenProblem.add(p.what); problems.push(p); } };
  // A document over the page's limit becomes a problem she can see (and the run document carries), never a silent skip.
  const add = (collection, doc_id, body) => {
    const json = JSON.stringify(body);
    const size = Buffer.byteLength(json, 'utf8');
    if (size > DOC_MAX) {
      const detail = `${collection}/${doc_id} is ${size} bytes, over the 256 KiB limit`;
      problem(collection === 'sources'
        ? { what: 'Your list of companies is too long for the page.', fix: 'Ask Claude to take companies you do not need off your list, or copy the message for Erik.', detail, since: at }
        : { what: 'One item is too big to put on the page.', fix: 'Copy the message for Erik.', detail, since: at });
      return;
    }
    writes.push({ collection, doc_id, json, size });
  };
  for (const line of args.problems || []) {
    const [what, fix, ...detail] = String(line).split('|');
    problem({ what: text(what, 200), fix: text(fix, 300), ...(detail.length ? { detail: text(detail.join('|'), 500) } : {}), since: at });
  }

  // Postings
  const scores = Object.values(readDir(P.scores) || {}).filter(r => r?.verdict?.id && safeId(r.verdict.id));
  const jdMeta = id => { try { return readFrontMatter(path.join(P.jds, `${id}.md`)).meta || {}; } catch { return {}; } };
  const donePostings = pushed('postings');
  let newPostings = 0;
  for (const rec of scores) {
    const id = rec.verdict.id; if (donePostings.has(id)) continue;
    const jd = jdMeta(id);
    if (!belongsOnPage(rec, jd)) continue;
    add('postings', id, postingDoc(rec, jd));
    newPostings++;
  }
  // Rescored postings that are already on the page: a new create-only document each time
  st.rescores ||= {};
  for (const rec of scores) {
    const id = rec.verdict.id;
    if (!rec.rescored_at || !donePostings.has(id) || st.rescores[id] === rec.rescored_at) continue;
    const v = rec.verdict;
    add('rescores', `${id}~${rec.rescored_at.replace(/[^0-9]/g, '').slice(0, 14)}`, { posting_id: id, at: rec.rescored_at, jd: jdMeta(id).jd === 'saved' ? 'saved' : undefined, score: v.score, status_hint: v.status, threshold: v.threshold, dealbreakers: v.dealbreakers, ratings: (v.ratings || []).map(r => ({ id: r.id, name: r.name, bucket: r.bucket, score: r.score, why: r.why })), checks: v.checks || [] });
  }
  // Weekly suggestions
  const doneSug = pushed('suggestions');
  if (fs.existsSync(P.suggestions)) for (const f of fs.readdirSync(P.suggestions).filter(f => /^\d{4}-W\d\d\.json$/.test(f))) {
    const wk = f.slice(0, -5); if (doneSug.has(wk)) continue;
    const d = readJson(path.join(P.suggestions, f), null);
    if (d?.items?.length) add('suggestions', wk, { week: wk, at: d.at, items: d.items.map(x => ({ id: x.id, title: x.title, why: x.why, change: x.change })) });
  }
  // Deep evaluations
  const doneDeep = pushed('deep');
  for (const [id, d] of Object.entries(readDir(P.deep) || {})) if (!doneDeep.has(id)) add('deep', id, d);
  // Handled requests
  const doneReq = pushed('requests_done');
  for (const [id, d] of Object.entries(readDir(P.done) || {})) if (!doneReq.has(id)) add('requests_done', id, d);
  // Resumes (create once per id; changing an existing one is an interactive step)
  const doneRes = pushed('resumes');
  let resumes = [];
  try { resumes = readYamlStrict(yaml, P.resumes, {}).resumes || []; } catch (e) { problem({ what: 'Your resume list has a problem.', fix: 'Copy the message for Erik.', detail: text(e.message, 300), since: at }); }
  for (const r of resumes) if (r?.id && safeId(r.id) && !doneRes.has(r.id)) add('resumes', r.id, resumeDoc(r, at));
  // The master resume (cv.md), once; later changes go through the resume update step (resume-doc master).
  if (!doneRes.has('master') && !resumes.some(r => r?.id === 'master')) { const m = masterDoc(); if (m) add('resumes', 'master', m); }
  // LinkedIn profile text: a new create-only document each time profile/linkedin.yml changes; the page shows the newest.
  try {
    const li = linkedinDoc(at);
    if (li && li.body.hash !== st.linkedin_hash) add('linkedin', li.id, li.body);
  } catch (e) { problem({ what: 'Your LinkedIn profile text has a problem.', fix: 'Ask Claude to "write my LinkedIn profile" again, or copy the message for Erik.', detail: text(e.message, 300), since: at }); }

  // Sources snapshot
  const decisions = readJson(P.decisions, {});
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let snap = null;
  try {
    const { rows, gaps, blocked, sites } = await buildSources(sourceCounts(allJds(), scores, decisions, since30));
    snap = sourcesDoc(rows, gaps, at, blocked, sites);
    snap.body.switches_as_of = st.pulled_at || at;   // outside the hash: a moved stamp alone must not re-push an unchanged list
    if (snap.hash !== st.sources_hash) add('sources', snap.id, snap.body);
  } catch (e) {
    problem({ what: 'Your list of sources has a problem.', fix: 'Copy the message for Erik.', detail: text(e.message, 300), since: at });
  }

  // Run document
  if (!args.noRun) {
    const scanRuns = fs.existsSync(P.runs) ? fs.readFileSync(P.runs, 'utf8').trim().split('\n').slice(1).map(l => l.split('\t')).filter(r => r[0]) : [];
    const lastScan = scanRuns.at(-1);
    if (!lastScan) problem({ what: 'The daily scan has not run yet.', fix: 'Check that the daily scan is turned on in your private copy on GitHub (the Actions tab).', since: at });
    else if (Date.now() - new Date(lastScan[0]).getTime() > 26 * 3600000)
      problem({ what: `The daily scan last ran ${lastScan[0].slice(0, 10)}.`, fix: 'GitHub may have paused the daily scan. Copy the message for Erik.', since: lastScan[0] });
    else if (lastScan[1] !== 'completed') problem({ what: 'The last daily scan did not finish.', fix: 'It usually recovers the next day. If this is here two days in a row, copy the message for Erik.', since: lastScan[0] });
    st.search_start ||= (scanRuns[0]?.[0] || at).slice(0, 10);
    let desk = {};
    try { desk = readYamlStrict(yaml, P.desk, {}); } catch (e) { problem({ what: 'Your settings file has a problem.', fix: 'Copy the message for Erik.', detail: text(e.message, 300), since: at }); }
    let scoring = null;
    try { const c = loadScoringConfig(P.scoring); scoring = { threshold: c.threshold, dims: c.dimensions.map(d => ({ id: d.id, name: d.name, bucket: d.bucket })) }; }
    catch (e) { problem({ what: 'Your scoring settings have a problem.', fix: 'Type "change my scoring" in Claude and say it shows an error.', detail: text(e.message, 300), since: at }); }
    const todayIso = at.slice(0, 10);
    const scoredToday = scores.filter(s => (s.scored_at || '').startsWith(todayIso) && s.verdict.status !== 'unscorable');
    // The funnel counts what the scan and alerts let through since the search started, like passed_filters; hand-added jobs never passed the filters.
    const sysScores = scores.filter(s => {
      if (s.verdict.status === 'unscorable') return false;
      const jd = jdMeta(s.verdict.id);
      if (jd.added === 'true' || jd.added === true) return false;
      return String(jd.found || (s.scored_at || '')).slice(0, 10) >= st.search_start;
    });
    const ok = problems.length === 0;
    // What this run did, counted since the run before it (for the Latest run panel on Stats).
    const prevAt = st.last_run_at || null;
    const after = t => !prevAt || String(t || '') > prevAt;
    const scansSince = scanRuns.filter(r => after(r[0]));
    const scoredSince = scores.filter(s => after(s.scored_at) && s.verdict.status !== 'unscorable');
    let started = null;
    try { started = (fs.readFileSync(path.join(P.page, 'last-run.md'), 'utf8').match(/^started:\s*(\S+)/m) || [])[1] || null; } catch { /* no run log */ }
    const sitesFound = Object.values(loadSites(DATA)).filter(e => e?.how === 'search' && e.url && e.at === todayIso).length;
    const last = {
      since: prevAt, started: started && !Number.isNaN(Date.parse(started)) ? started : null,
      scans: scansSince.length,
      companies: scansSince.reduce((m, r) => Math.max(m, Number(r[2]) || 0), 0),
      listed: scansSince.length ? Number(scansSince.at(-1)[4]) || 0 : 0,
      found: scansSince.reduce((n, r) => n + (Number(r[13]) || 0), 0) + (args.quick ? 0 : alertsAdded(todayIso)),
      scored: scoredSince.length,
      dealbreakers: scoredSince.filter(s => s.verdict.status === 'dealbreaker').length,
      to_review: newPostings,
      deep: Object.values(readDir(P.deep) || {}).filter(d => after(d?.at)).length,
      requests: Object.values(readDir(P.done) || {}).filter(d => after(d?.at)).length,
      sites: sitesFound,
    };
    // Daily history for the Stats page: one entry per morning run (Run now is left out),
    // counted since the morning run before it. A copy without history starts from its scores.
    if (!Array.isArray(st.history)) {
      const byDay = {};
      sysScores.forEach(s => {
        const d = String(s.scored_at || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= todayIso) return;
        const e = byDay[d] = byDay[d] || { at: d + 'T12:00:00.000Z', found: null, scored: 0, to_review: 0, backfilled: true };
        e.scored++;
        if (s.verdict.status === 'qualified' || s.verdict.dream) e.to_review++;
      });
      st.history = Object.keys(byDay).sort().map(d => byDay[d]);
    }
    if (!args.quick) {
      const prevDaily = st.last_daily_at || prevAt;
      const afterDaily = t => !prevDaily || String(t || '') > prevDaily;
      const scans = scanRuns.filter(r => afterDaily(r[0]));
      st.history.push({
        at,
        found: scans.reduce((n, r) => n + (Number(r[13]) || 0), 0) + alertsAdded(todayIso),
        scored: scores.filter(x => afterDaily(x.scored_at) && x.verdict.status !== 'unscorable').length,
        to_review: newPostings,
      });
      st.history = st.history.slice(-HISTORY_DAYS);
      st.last_daily_at = at;
    }
    if (ok) st.last_good_run = at;
    st.last_run_at = at;
    add('runs', runId(new Date(at)), {
      at, ok, problems, last_good_run: st.last_good_run, version: VERSION,
      plan: desk.plan || null, daily_cap: desk.daily_cap ?? null, deep_cap: desk.deep_cap ?? null, web_cap: Number.isInteger(desk.web_cap) ? desk.web_cap : 5, help_email: desk.help_email || null,
      update: updateInfo(args.updateFile),
      task_id: typeof desk.task_id === 'string' && /^trig_[A-Za-z0-9]+$/.test(desk.task_id) ? desk.task_id : null,
      repo: typeof desk.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(desk.repo) ? desk.repo : null, quick: !!args.quick,
      scoring,
      funnel: {
        since: st.search_start,
        open_today: lastScan ? Number(lastScan[4]) || 0 : 0,
        passed_filters: scanRuns.filter(r => r[0].slice(0, 10) >= st.search_start).reduce((s, r) => s + (Number(r[13]) || 0), 0)
          + alertsAdded(st.search_start),
        scored: sysScores.length,
        qualified: sysScores.filter(s => s.verdict.status === 'qualified').length,
      },
      today: { scored: scoredToday.length, qualified: scoredToday.filter(s => s.verdict.status === 'qualified').length },
      last,
      history: st.history.slice(-HISTORY_DAYS),
    });
  }

  // Batches (the outbox is rebuilt from scratch every push)
  fs.rmSync(P.outbox, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.outbox, 'docs'), { recursive: true });
  const batches = [];
  let cur = [], bytes = 0;
  for (const w of writes) {
    const file = path.join(P.outbox, 'docs', `${w.collection}__${w.doc_id.replace(/[^A-Za-z0-9_~-]/g, '_')}.json`);
    fs.writeFileSync(file, w.json);
    if (cur.length >= BATCH_MAX || bytes + w.size > BATCH_BYTES) { batches.push(cur); cur = []; bytes = 0; }
    cur.push({ op: 'set', collection: w.collection, doc_id: w.doc_id, file_path: file });
    bytes += w.size;
  }
  if (cur.length) batches.push(cur);
  const files = batches.map((b, i) => {
    const f = path.join(P.outbox, `batch-${String(i + 1).padStart(3, '0')}.json`);
    writeJson(f, { writes: b, sources_hash: snap && b.some(w => w.collection === 'sources') ? snap.hash : undefined });
    return f;
  });
  writeJson(P.state, st);
  console.log(JSON.stringify({ batches: files, writes: writes.length, ok: problems.length === 0, problems: problems.map(p => p.what) }, null, 2));
}

// Jobs that came in through email alerts or web search and passed the filters (daily.mjs alerts).
function alertsAdded(since) {
  if (!fs.existsSync(P.history)) return 0;
  return fs.readFileSync(P.history, 'utf8').split('\n')
    .map(l => l.split('\t')).filter(c => (/^gmail:|^web/.test(c[2] || '') || /-full$/.test(c[2] || '')) && c[5] === 'added' && (c[1] || '') >= since).length;
}

// linkedin/<YYYYMMDDHHMMSS>: profile/linkedin.yml as the page shows it; null when there is none yet.
function linkedinDoc(at = new Date().toISOString()) {
  if (!fs.existsSync(P.linkedin)) return null;
  const d = readYamlStrict(yaml, P.linkedin, null);
  const cv = fs.existsSync(path.join(DATA, 'cv.md')) ? fs.readFileSync(path.join(DATA, 'cv.md'), 'utf8') : '';
  const problems = checkLinkedin(d, cv);
  if (problems.length) throw new Error(problems.slice(0, 3).join(' '));
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const list = v => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
  const otw = d.open_to_work || {};
  const body = {
    updated: s(d.updated) || at.slice(0, 10), aims_at: s(d.aims_at), headline: s(d.headline), about: s(d.about),
    experience: d.experience.map(r => ({ company: s(r.company), title: s(r.title), dates: s(r.dates), description: s(r.description) })),
    skills: list(d.skills),
    open_to_work: { titles: list(otw.titles), locations: list(otw.locations), workplaces: list(otw.workplaces) },
  };
  body.hash = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  body.at = at;
  return { id: at.replace(/[^0-9]/g, '').slice(0, 14), body };
}

// A resume document as push writes it.
function resumeDoc(r, at = new Date().toISOString()) {
  const textFile = r.text_file ? path.resolve(DATA, 'resumes', r.text_file) : null;
  const inside = textFile && textFile.startsWith(path.join(DATA, 'resumes') + path.sep) && fs.existsSync(textFile);
  return { name: r.name, kind: r.kind || 'default', for_posting: r.for_posting || null, updated: r.updated || at.slice(0, 10), asset_id: r.asset_id || null, text: inside ? fs.readFileSync(textFile, 'utf8') : (r.text || null) };
}
// The master resume from cv.md, as plain text for application forms.
function masterDoc() {
  const f = path.join(DATA, 'cv.md');
  if (!fs.existsSync(f)) return null;
  const md = fs.readFileSync(f, 'utf8');
  if (md.trim().length < 200) return null;
  const text = md.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[-*]\s+/gm, '• ').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { name: 'Master resume', kind: 'master', for_posting: null, updated: fs.statSync(f).mtime.toISOString().slice(0, 10), asset_id: null, text };
}
// .work/resume-<id>.json: the fields of one resume as push writes them, for the resume update step.
function resumeDocCmd(id) {
  if (!id || !safeId(id)) throw new Error('usage: page-sync.mjs resume-doc <resume id>');
  let doc = null;
  if (id === 'master') doc = masterDoc();
  else {
    const idx = readYamlStrict(yaml, P.resumes, {}).resumes || [];
    const r = idx.find(x => x?.id === id);
    if (r) doc = resumeDoc(r);
  }
  if (!doc) throw new Error(`no resume ${id} in resumes/index.yml`);
  const out = path.join(ROOT, '.work', `resume-${id}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(out);
}

// Companies with a job on the page, the ones she is acting on first, then newest first.
function pageCompanies() {
  const decisions = readJson(P.decisions, {});
  const onPage = new Set(state().pushed?.postings || []);
  const open = new Set(['interested', 'applied', 'screen', 'hm', 'offer']);
  const rows = [];
  for (const rec of Object.values(readDir(P.scores) || {})) {
    if (!rec?.verdict?.id || !safeId(rec.verdict.id)) continue;
    let jd = {};
    try { jd = readFrontMatter(path.join(P.jds, `${rec.verdict.id}.md`)).meta || {}; } catch { /* no saved posting */ }
    if (!onPage.has(rec.verdict.id) && !belongsOnPage(rec, jd)) continue;
    const d = postingDoc(rec, jd);
    if (!d.company) continue;
    rows.push({ name: d.company, url: d.url, found: d.found || '', active: open.has(decisions[d.id]?.status) });
  }
  rows.sort((a, b) => (b.active - a.active) || String(b.found).localeCompare(String(a.found)));
  const by = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!by.has(k)) by.set(k, { name: r.name, urls: [] });
    if (r.url) by.get(k).urls.push(r.url);
  }
  return [...by.values()];
}

function sites(args) {
  const day = new Date().toISOString().slice(0, 10);
  const store = loadSites(DATA);
  const rec = args.indexOf('--record');
  if (rec >= 0) {
    const results = readJson(args[rec + 1], null);
    if (!Array.isArray(results)) throw new Error(`${args[rec + 1]} is not a list of { company, url }`);
    const out = recordLookups(store, results, day);
    saveSites(DATA, store);
    console.log(JSON.stringify(out));
    return;
  }
  const companies = pageCompanies();
  fillKnown(store, companies, readPortals(), day);
  saveSites(DATA, store);
  const ci = args.indexOf('--cap');
  const desk = readYamlStrict(yaml, P.desk, {});
  const cap = ci >= 0 ? Number(args[ci + 1]) : Number.isInteger(desk.site_cap) ? desk.site_cap : 5;
  console.log(JSON.stringify({ to_look_up: dueLookups(store, companies, day, Math.max(0, cap || 0)) }, null, 2));
}

async function buildSources(counts) {
  const portals = readPortals();
  const desk = readYamlStrict(yaml, P.desk, {});
  const rows = [];
  const c = name => counts[slug(name)] || { found: 0, qual: 0, app: 0 };
  rows.push({ id: 'gmail', group: 'mail', name: 'Gmail job alerts', desc: 'LinkedIn, Indeed and other alert emails', how: 'Read every run', on: desk.gmail_alerts !== false, cost: false, found: 0, qual: 0, app: 0 });
  rows.push({ id: 'sweep', group: 'mail', name: 'Nightly sweep of public job boards', desc: 'About 15,000 companies on Greenhouse, Lever and Ashby, checked for your titles and locations', how: 'Every night, free (no Claude usage)', on: desk.board_sweep !== false, cost: false, found: 0, qual: 0, app: 0 });
  const webList = (portals.search_queries || []).filter(q => q && q.enabled !== false && q.query);
  if (webList.length) {
    const perDay = Math.min(Number.isInteger(desk.web_cap) ? desk.web_cap : 5, webList.length);
    rows.push({ id: 'web', group: 'mail', name: 'Web search across job boards', desc: `${webList.length} searches for your titles on Greenhouse, Lever, Ashby and other job boards, finding companies you haven't listed`, how: `Every morning, ${perDay} at a time`, on: desk.web_search !== false, cost: true, found: 0, qual: 0, app: 0 });
  }
  for (const co of portals.tracked_companies || []) {
    if (!co?.name) continue;
    const board = co.scan_method === 'websearch' ? null : await boardFor(co);
    const group = co.dream ? 'dream' : board ? 'boards' : 'search';
    rows.push({
      id: `co-${slug(co.name)}`, group, name: co.name,
      desc: board ? board.replace(/(^|-)(\w)/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()) : 'No job board found',
      how: board ? 'Checked daily' : co.dream ? 'Checked weekly by web search' : 'Not checked: needs a careers or job board link',
      on: co.enabled !== false, cost: !board && !!co.dream, ...c(co.name),
    });
  }
  const gaps = readJson(P.gaps, []);
  const companies = pageCompanies();
  const store = loadSites(DATA);
  if (fillKnown(store, companies, portals, new Date().toISOString().slice(0, 10))) saveSites(DATA, store);
  return { rows, gaps: Array.isArray(gaps) ? gaps : [], blocked: listBlocked(loadBlocklist(DATA)), sites: pageSites(store, companies) };
}

// ------------------------------------------------------------------ ack

function ack(file) {
  const abs = path.resolve(file || '');
  if (!abs.startsWith(P.outbox + path.sep)) throw new Error(`not a batch file in the outbox: ${file}`);
  const b = readJson(abs, null);
  if (!b || !Array.isArray(b.writes)) throw new Error(`not a batch file: ${file}`);
  const st = state();
  st.pushed ||= {};
  for (const w of b.writes) {
    if (w.collection === 'rescores') { const body = readJson(w.file_path, null); if (body?.posting_id) (st.rescores ||= {})[body.posting_id] = body.at; }
    if (w.collection === 'linkedin') { const body = readJson(w.file_path, null); if (body?.hash) st.linkedin_hash = body.hash; }
    if (['postings', 'deep', 'requests_done', 'resumes', 'suggestions'].includes(w.collection)) {
      const set = new Set(st.pushed[w.collection] || []); set.add(w.doc_id); st.pushed[w.collection] = [...set];
    }
  }
  if (b.sources_hash) st.sources_hash = b.sources_hash;
  writeJson(P.state, st);
  fs.renameSync(abs, abs.replace(/\.json$/, '.sent.json'));
  console.log(`acknowledged ${b.writes.length} writes from ${path.basename(abs)}`);
}

// ------------------------------------------------------------------ main

// A newer template version, from `update.mjs check` output saved by the daily run; null when none or unreadable.
function updateInfo(file) {
  if (!file) return null;
  const c = readJson(file, null);
  if (!c || typeof c.latest !== 'string' || typeof c.current !== 'string' || !/^\d+\.\d+\.\d+$/.test(c.latest)) return null;
  const v = x => x.split('.').map(Number);
  const [a, b] = [v(c.latest), v(c.current)];
  const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (newer <= 0) return null;
  const notes = (Array.isArray(c.changelog) ? c.changelog : []).flatMap(x => String(x.text || '').split('\n')).map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 12).map(l => { const t = text(l, 1000); return t.length < 1000 ? t : t.slice(0, t.lastIndexOf(' ', 990)) + '…'; });
  return { to: c.latest, notes, needs_erik: Array.isArray(c.needs_erik) && c.needs_erik.length > 0 };
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = name => { const out = []; rest.forEach((a, i) => { if (a === name && rest[i + 1] != null) out.push(rest[i + 1]); }); return out; };
  const main = {
    pull: () => pull(rest[0]),
    since: () => {
      const t = Date.parse(state().decisions_synced_at || '');
      console.log(!fs.existsSync(P.decisions) || !Number.isFinite(t) ? 'all' : new Date(t - 7 * 86400000).toISOString());
    },
    push: () => {
      const fromFile = flag('--problems-file').flatMap(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : []);
      return push({ problems: [...flag('--problem'), ...fromFile], noRun: rest.includes('--no-run'), quick: rest.includes('--quick'), updateFile: flag('--update-file')[0] || null });
    },
    ack: () => ack(rest[0]),
    sites: () => sites(rest),
    'resume-doc': () => resumeDocCmd(rest[0]),
    done: () => {
      const posting = flag('--posting')[0];
      if (posting && !safeId(posting)) throw new Error(`not a posting id: ${posting}`);
      done(rest[0], rest[1] || 'Done', posting);
      console.log(`recorded ${rest[0]}`);
    },
  }[cmd];
  if (!main) { console.error('usage: page-sync.mjs pull <dump dir> | since | push [--problem "what|fix|detail"] [--problems-file f] [--no-run] [--quick] [--update-file <update.mjs check output>] | ack <batch file> | done <request id> "<result>" [--posting <id>]'); process.exit(2); }
  Promise.resolve().then(main).catch(e => { console.error(`page-sync: ${e.message}`); process.exit(1); });
}
