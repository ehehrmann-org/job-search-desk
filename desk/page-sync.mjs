#!/usr/bin/env node
/**
 * page-sync.mjs: move data between the repo and the page database.
 * The daily task runs it; the ArtifactData tool does the actual reads and writes.
 *
 *   node desk/page-sync.mjs pull <dump dir>
 *       <dump dir> holds the page's collections as the ArtifactData tool saves them
 *       with out_dir: decisions/, requests/, requests_done/, source_switches/.
 *       Mirrors decisions to data/page/decisions.json, applies source switches to
 *       portals.yml, queues added jobs (link -> pipeline.md, pasted text -> jds/),
 *       and prints what still needs Claude (source lookups) as JSON.
 *
 *   node desk/page-sync.mjs done <request id> "<result>" [--posting <id>]
 *       Records that a request was handled; pushed as requests_done/<id>.
 *
 *   node desk/page-sync.mjs push [--problem "what|fix"]... [--problems-file <file>]
 *       Writes batch files to data/page/outbox/: new postings, deep evaluations,
 *       handled requests, the run document and (when changed) the source list.
 *       Prints the batch file paths. Every write is a create (no version needed).
 *
 *   node desk/page-sync.mjs ack <batch file>
 *       After a batch was written successfully: marks its documents as pushed.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { postingDoc, belongsOnPage, runId, sourcesDoc, sourceCounts, slug } from './lib/page-docs.mjs';
import { loadScoringConfig } from './lib/scoring.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { loadBlocklist, listBlocked, addToBlacklist, removeFromBlacklist } from './lib/blocklist.mjs';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';
import { applySuggestion, decline as declineSuggestion } from './suggest.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.resolve(ROOT, process.env.CAREER_OPS_DATA_DIR || '.');
const P = {
  page: path.join(DATA, 'data', 'page'),
  state: path.join(DATA, 'data', 'page', 'state.json'),
  decisions: path.join(DATA, 'data', 'page', 'decisions.json'),
  done: path.join(DATA, 'data', 'page', 'done'),
  gaps: path.join(DATA, 'data', 'page', 'gaps.json'),
  outbox: path.join(DATA, 'data', 'page', 'outbox'),
  scores: path.join(DATA, 'data', 'scores'),
  deep: path.join(DATA, 'data', 'deep'),
  jds: path.join(DATA, 'jds'),
  pipeline: path.join(DATA, 'data', 'pipeline.md'),
  history: path.join(DATA, 'data', 'scan-history.tsv'),
  runs: path.join(DATA, 'data', 'scan-runs.tsv'),
  portals: path.join(DATA, 'portals.yml'),
  desk: path.join(DATA, 'config', 'desk.yml'),
  scoring: path.join(DATA, 'config', 'scoring.yml'),
  resumes: path.join(DATA, 'resumes', 'index.yml'),
};
const VERSION = fs.readFileSync(path.join(ROOT, 'desk', 'VERSION'), 'utf8').trim();
const BATCH_MAX = 45;               // ArtifactData allows 50 writes per batch
const BATCH_BYTES = 900 * 1024;     // and 1 MiB per batch

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const readYaml = (f, d) => { try { return yaml.load(fs.readFileSync(f, 'utf8')) ?? d; } catch { return d; } };
const nowIso = () => new Date().toISOString();
const state = () => readJson(P.state, { pushed: {}, sources_hash: null, last_good_run: null, search_start: null });

function readDir(dir) {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = readJson(path.join(dir, f), null);
  return out;
}
function allJds() {
  if (!fs.existsSync(P.jds)) return [];
  return fs.readdirSync(P.jds).filter(f => f.endsWith('.md')).map(f => ({ file: f, ...readFrontMatter(path.join(P.jds, f)).meta }));
}

// ------------------------------------------------------------------ pull

async function pull(dumpDir) {
  if (!dumpDir || !fs.existsSync(dumpDir)) throw new Error(`dump folder not found: ${dumpDir}`);
  const decisions = readDir(path.join(dumpDir, 'decisions'));
  const requests = readDir(path.join(dumpDir, 'requests'));
  const doneRemote = readDir(path.join(dumpDir, 'requests_done'));
  const switches = readDir(path.join(dumpDir, 'source_switches'));
  writeJson(P.decisions, decisions);

  const summary = { decisions: Object.keys(decisions).length, jobs_queued: [], sources_to_set_up: [], switches_applied: [], dismissed: [], blocked: [], unblocked: [] };
  const doneLocal = new Set(fs.existsSync(P.done) ? fs.readdirSync(P.done).map(f => f.replace(/\.json$/, '')) : []);
  const history = fs.existsSync(P.history) ? fs.readFileSync(P.history, 'utf8') : '';

  for (const [rid, r] of Object.entries(requests)) {
    if (!r || doneRemote[rid] || doneLocal.has(rid)) continue;
    if (r.kind === 'add_job') {
      const url = (String(r.text || '').match(/https?:\/\/[^\s<>"']+/) || [])[0];
      const isTextOnly = !url || String(r.text).trim().length > url.length + 200;
      const extra = { added: true, source: 'Added by you', applied: !!r.applied };
      if (isTextOnly) {
        writeJd(rid, { url: url || '', company: 'Added job', title: 'Added job', found: (r.at || nowIso()).slice(0, 10), jd: 'saved', ...extra }, String(r.text));
        done(rid, 'Scoring in this run', rid);
        summary.jobs_queued.push({ id: rid, how: 'pasted text saved; score it this run' });
      } else {
        appendPipeline(url, rid);
        done(rid, "Scoring tomorrow, after the scan reads the posting", rid);
        summary.jobs_queued.push({ id: rid, url, how: 'link queued; the next scan saves the description' });
      }
      if (url && !history.includes(url.split('?')[0])) summary.jobs_queued.at(-1).missed_by_scan = true;
    } else if (r.kind === 'add_source') {
      summary.sources_to_set_up.push({ id: rid, text: r.text, dream: !!r.dream, gap: r.gap || null });
    } else if (r.kind === 'block_company' && r.company) {
      addToBlacklist(DATA, r.company, r.reason || 'Blocked from the job page', (r.at || nowIso()).slice(0, 10));
      done(rid, `Blocked ${r.company}`);
      summary.blocked.push(r.company);
    } else if (r.kind === 'unblock_company' && r.company) {
      const removed = removeFromBlacklist(DATA, r.company);
      done(rid, removed ? `Unblocked ${r.company}` : `${r.company} wasn't on your list`);
      summary.unblocked.push(r.company);
    } else if (r.kind === 'set_board' && r.source && r.url) {
      const portals = readYaml(P.portals, {});
      const co = (portals.tracked_companies || []).find(c => `co-${slug(c.name)}` === r.source);
      const providers = await loadProviders(path.join(ROOT, 'providers'));
      const hit = resolveProvider({ name: r.company || 'check', careers_url: r.url }, providers, { skipIds: ['local-parser'] });
      if (!co) done(rid, `${r.company || 'That company'} is no longer in your sources`);
      else if (!hit?.provider) { done(rid, `That link isn't a job board the scan can read. Try the link of one job posting from ${co.name}'s careers page.`); summary.boards_not_readable = [...(summary.boards_not_readable || []), co.name]; }
      else {
        co.careers_url = r.url; co.enabled = true; delete co.scan_method; delete co.scan_query;
        fs.writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 160, noRefs: true }));
        done(rid, `${co.name} is now checked daily`);
        summary.boards_set = [...(summary.boards_set || []), co.name];
      }
    } else if (r.kind === 'switch_group' && r.group === 'search') {
      const portals = readYaml(P.portals, {});
      const providers = await loadProviders(path.join(ROOT, 'providers'));
      let n = 0;
      for (const co of portals.tracked_companies || []) {
        if (!co?.name || co.dream) continue;
        if (resolveProvider({ ...co, enabled: true }, providers, { skipIds: ['local-parser'] })?.provider) continue;
        co.enabled = !!r.on; n++;
      }
      fs.writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 160, noRefs: true }));
      done(rid, `${n} companies turned ${r.on ? 'on' : 'off'}`);
      summary.switches_applied.push({ id: 'group:search', on: !!r.on, count: n });
    } else if ((r.kind === 'apply_suggestion' || r.kind === 'decline_suggestion') && r.week && r.sid) {
      if (r.kind === 'decline_suggestion') { declineSuggestion(r.week, r.sid); done(rid, 'Not now'); continue; }
      try {
        const res = applySuggestion(r.week, r.sid);
        const moved = (res.rescored || []).length;
        done(rid, res.applied ? `Done: ${res.title}.${moved ? ` ${moved} open job${moved === 1 ? '' : 's'} rescored.` : ''}` : res.note);
        summary.suggestions_applied = [...(summary.suggestions_applied || []), { title: res.title, rescored: moved }];
      } catch (e) {
        done(rid, `Couldn't apply this one: ${e.message}`);
        summary.suggestions_failed = [...(summary.suggestions_failed || []), e.message];
      }
    } else if (r.kind === 'dismiss_gap') {
      const gaps = readJson(P.gaps, []);
      writeJson(P.gaps, gaps.filter(g => g.id !== r.gap));
      done(rid, 'Dismissed');
      summary.dismissed.push(r.gap);
    }
  }

  // Source switches -> portals.yml enabled flags and config/desk.yml (Gmail)
  if (Object.keys(switches).length) {
    const portals = readYaml(P.portals, {});
    const desk = readYaml(P.desk, {});
    let portalsChanged = false, deskChanged = false;
    const applied = readJson(path.join(P.page, 'switches-applied.json'), {});
    for (const [sid, sw] of Object.entries(switches)) {
      if (!sw || applied[sid] === sw.at) continue;
      if (sid === 'gmail') { desk.gmail_alerts = !!sw.on; deskChanged = true; }
      else {
        const co = (portals.tracked_companies || []).find(c => `co-${slug(c.name)}` === sid);
        if (!co) continue;
        co.enabled = !!sw.on; portalsChanged = true;
      }
      applied[sid] = sw.at;
      summary.switches_applied.push({ id: sid, on: !!sw.on });
    }
    if (portalsChanged) fs.writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 160, noRefs: true }));
    if (deskChanged) fs.writeFileSync(P.desk, yaml.dump(desk, { lineWidth: 160 }));
    writeJson(path.join(P.page, 'switches-applied.json'), applied);
  }
  console.log(JSON.stringify(summary, null, 2));
}

function writeJd(id, meta, body) {
  fs.mkdirSync(P.jds, { recursive: true });
  const head = ['---', ...Object.entries({ id, ...meta }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', ''];
  fs.writeFileSync(path.join(P.jds, `${id}.md`), head.join('\n') + body.trim() + '\n');
}
function appendPipeline(url, id) {
  let md = fs.existsSync(P.pipeline) ? fs.readFileSync(P.pipeline, 'utf8') : '# Pipeline\n\n## Pending\n\n## Processed\n';
  if (md.includes(url)) return;
  const line = `- [ ] ${url} | Added job | Added job | | id: ${id} | source: Added by you`;
  md = /## Pending\n/.test(md) ? md.replace(/## Pending\n\n?/, m => `${m}${line}\n`) : md + `\n## Pending\n\n${line}\n`;
  fs.writeFileSync(P.pipeline, md);
}
function done(rid, result, postingIdArg) {
  writeJson(path.join(P.done, `${rid}.json`), { at: nowIso(), result, ...(postingIdArg ? { posting_id: postingIdArg } : {}) });
}

// ------------------------------------------------------------------ push

async function push(args) {
  const st = state();
  const at = nowIso();
  st.pushed ||= {};
  const pushed = k => new Set(st.pushed[k] || []);
  const writes = [];
  const add = (collection, doc_id, body) => writes.push({ collection, doc_id, body });

  // Postings
  const scores = Object.values(readDir(P.scores)).filter(Boolean);
  const jdMeta = id => { const f = path.join(P.jds, `${id}.md`); return fs.existsSync(f) ? readFrontMatter(f).meta : {}; };
  const donePostings = pushed('postings');
  for (const rec of scores) {
    const id = rec.verdict?.id; if (!id || donePostings.has(id)) continue;
    const jd = jdMeta(id);
    if (!belongsOnPage(rec, jd)) continue;
    add('postings', id, postingDoc(rec, jd));
  }
  // Rescored postings that are already on the page: a new create-only document each time
  st.rescores ||= {};
  for (const rec of scores) {
    const id = rec.verdict?.id;
    if (!id || !rec.rescored_at || !donePostings.has(id) || st.rescores[id] === rec.rescored_at) continue;
    const v = rec.verdict;
    add('rescores', `${id}~${rec.rescored_at.replace(/[^0-9]/g, '').slice(0, 14)}`, { posting_id: id, at: rec.rescored_at, score: v.score, status_hint: v.status, threshold: v.threshold, dealbreakers: v.dealbreakers, ratings: v.ratings.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, score: r.score, why: r.why })), checks: v.checks });
  }
  // Weekly suggestions
  const doneSug = pushed('suggestions');
  const sugDir = path.join(DATA, 'data', 'suggestions');
  if (fs.existsSync(sugDir)) for (const f of fs.readdirSync(sugDir).filter(f => /^\d{4}-W\d\d\.json$/.test(f))) {
    const wk = f.slice(0, -5); if (doneSug.has(wk)) continue;
    const d = readJson(path.join(sugDir, f), null);
    if (d?.items?.length) add('suggestions', wk, { week: wk, at: d.at, items: d.items.map(x => ({ id: x.id, title: x.title, why: x.why, change: x.change })) });
  }
  // Deep evaluations
  const doneDeep = pushed('deep');
  for (const [id, d] of Object.entries(readDir(P.deep))) if (d && !doneDeep.has(id)) add('deep', id, d);
  // Handled requests
  const doneReq = pushed('requests_done');
  for (const [id, d] of Object.entries(readDir(P.done))) if (d && !doneReq.has(id)) add('requests_done', id, d);
  // Resumes (create once per id; changing an existing one is an interactive step)
  const doneRes = pushed('resumes');
  const resumes = readYaml(P.resumes, { resumes: [] }).resumes || [];
  for (const r of resumes) if (r?.id && !doneRes.has(r.id)) {
    const textFile = r.text_file ? path.join(DATA, 'resumes', r.text_file) : null;
    add('resumes', r.id, { name: r.name, kind: r.kind || 'default', for_posting: r.for_posting || null, updated: r.updated || at.slice(0, 10), asset_id: r.asset_id || null, text: textFile && fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8') : (r.text || null) });
  }

  // Sources snapshot
  const decisions = readJson(P.decisions, {});
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { rows, gaps, blocked } = await buildSources(sourceCounts(allJds(), scores, decisions, since30));
  const snap = sourcesDoc(rows, gaps, at, blocked);
  if (snap.hash !== st.sources_hash) add('sources', snap.id, snap.body);

  // Run document
  const problems = (args.problems || []).map(p => { const [what, fix, ...detail] = p.split('|'); return { what: what.trim(), fix: (fix || '').trim(), ...(detail.length ? { detail: detail.join('|').trim().slice(0, 500) } : {}), since: at }; });
  const scanRuns = fs.existsSync(P.runs) ? fs.readFileSync(P.runs, 'utf8').trim().split('\n').slice(1).map(l => l.split('\t')) : [];
  const lastScan = scanRuns.at(-1);
  if (!lastScan) problems.push({ what: 'The daily scan has not run yet.', fix: 'Check that the daily scan is turned on in your private copy on GitHub.', since: at });
  else if (Date.now() - new Date(lastScan[0]).getTime() > 26 * 3600000)
    problems.push({ what: `The daily scan last ran ${lastScan[0].slice(0, 10)}.`, fix: 'GitHub may have paused the daily scan. Copy the message for Erik.', since: lastScan[0] });
  else if (lastScan[1] !== 'completed') problems.push({ what: 'The last daily scan did not finish.', fix: 'It usually recovers the next day. If this is here two days in a row, copy the message for Erik.', since: lastScan[0] });
  st.search_start ||= (scanRuns[0]?.[0] || at).slice(0, 10);
  const desk = readYaml(P.desk, {});
  let scoring = null;
  try { const c = loadScoringConfig(P.scoring); scoring = { threshold: c.threshold, dims: c.dimensions.map(d => ({ id: d.id, name: d.name, bucket: d.bucket })) }; } catch (e) { problems.push({ what: 'Your scoring settings have a problem.', fix: 'Type "check my scoring" in Claude.', since: at }); }
  const todayIso = at.slice(0, 10);
  const scoredToday = scores.filter(s => (s.scored_at || '').startsWith(todayIso));
  const ok = problems.length === 0;
  if (ok) st.last_good_run = at;
  add('runs', runId(new Date(at)), {
    at, ok, problems, last_good_run: st.last_good_run, version: VERSION,
    plan: desk.plan || null, daily_cap: desk.daily_cap || null, help_email: desk.help_email || null,
    scoring,
    funnel: {
      since: st.search_start,
      open_today: lastScan ? Number(lastScan[4]) || 0 : 0,
      passed_filters: scanRuns.filter(r => r[0].slice(0, 10) >= st.search_start).reduce((s, r) => s + (Number(r[13]) || 0), 0)
        + alertsAdded(st.search_start),
      scored: scores.length,
      qualified: scores.filter(s => s.verdict.status === 'qualified').length,
    },
    today: { scored: scoredToday.length, qualified: scoredToday.filter(s => s.verdict.status === 'qualified').length },
  });

  // Batches (the outbox is rebuilt from scratch every push)
  fs.rmSync(P.outbox, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.outbox, 'docs'), { recursive: true });
  const batches = [];
  let cur = [], bytes = 0;
  for (const w of writes) {
    const file = path.join(P.outbox, 'docs', `${w.collection}__${w.doc_id}.json`);
    const json = JSON.stringify(w.body);
    if (json.length > 250 * 1024) { console.error(`skipped ${w.collection}/${w.doc_id}: over 250 KiB`); continue; }
    fs.writeFileSync(file, json);
    if (cur.length >= BATCH_MAX || bytes + json.length > BATCH_BYTES) { batches.push(cur); cur = []; bytes = 0; }
    cur.push({ op: 'set', collection: w.collection, doc_id: w.doc_id, file_path: file });
    bytes += json.length;
  }
  if (cur.length) batches.push(cur);
  const files = batches.map((b, i) => {
    const f = path.join(P.outbox, `batch-${String(i + 1).padStart(3, '0')}.json`);
    writeJson(f, { writes: b, sources_hash: b.some(w => w.collection === 'sources') ? snap.hash : undefined });
    return f;
  });
  writeJson(P.state, st);
  console.log(JSON.stringify({ batches: files, writes: writes.length, ok, problems: problems.map(p => p.what) }, null, 2));
}

// Jobs that came in through email alerts or web search and passed the filters (daily.mjs alerts).
function alertsAdded(since) {
  if (!fs.existsSync(P.history)) return 0;
  return fs.readFileSync(P.history, 'utf8').split('\n')
    .map(l => l.split('\t')).filter(c => /^gmail:|^web/.test(c[2] || '') && c[5] === 'added' && (c[1] || '') >= since).length;
}

async function buildSources(counts) {
  const portals = readYaml(P.portals, {});
  const desk = readYaml(P.desk, {});
  const providers = await loadProviders(path.join(ROOT, 'providers'));
  const rows = [];
  const c = name => counts[slug(name)] || { found: 0, qual: 0, app: 0 };
  rows.push({ id: 'gmail', group: 'mail', name: 'Gmail job alerts', desc: 'LinkedIn, Indeed and other alert emails', how: 'Read every run', on: desk.gmail_alerts !== false, cost: false, found: 0, qual: 0, app: 0 });
  for (const co of portals.tracked_companies || []) {
    if (!co?.name) continue;
    const res = resolveProvider({ ...co, enabled: true }, providers, { skipIds: ['local-parser'] });
    const board = res?.provider ? res.provider.id : null;
    const group = co.dream ? 'dream' : board ? 'boards' : 'search';
    rows.push({
      id: `co-${slug(co.name)}`, group, name: co.name,
      desc: board ? board.replace(/(^|-)(\w)/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()) : 'No job board found',
      how: board ? 'Checked daily' : co.dream ? 'Checked weekly by web search' : 'Not checked: needs a careers or job board link',
      on: co.enabled !== false, cost: !board && !!co.dream, ...c(co.name),
    });
  }
  const gaps = readJson(P.gaps, []);
  return { rows, gaps, blocked: listBlocked(loadBlocklist(DATA)) };
}

// ------------------------------------------------------------------ ack

function ack(file) {
  const b = readJson(file, null);
  if (!b) throw new Error(`not a batch file: ${file}`);
  const st = state();
  st.pushed ||= {};
  for (const w of b.writes) {
    if (w.collection === 'rescores') { const body = readJson(w.file_path, {}); (st.rescores ||= {})[body.posting_id] = body.at; }
    if (['postings', 'deep', 'requests_done', 'resumes', 'suggestions'].includes(w.collection)) {
      const set = new Set(st.pushed[w.collection] || []); set.add(w.doc_id); st.pushed[w.collection] = [...set];
    }
  }
  if (b.sources_hash) st.sources_hash = b.sources_hash;
  writeJson(P.state, st);
  fs.renameSync(file, file.replace(/\.json$/, '.sent.json'));
  console.log(`acknowledged ${b.writes.length} writes from ${path.basename(file)}`);
}

// ------------------------------------------------------------------ main

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const out = []; rest.forEach((a, i) => { if (a === name) out.push(rest[i + 1]); }); return out; };
const main = {
  pull: () => pull(rest[0]),
  push: () => {
    const fromFile = flag('--problems-file').flatMap(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : []);
    return push({ problems: [...flag('--problem'), ...fromFile] });
  },
  ack: () => ack(rest[0]),
  done: () => { done(rest[0], rest[1] || 'Done', flag('--posting')[0]); console.log(`recorded ${rest[0]}`); },
}[cmd];
if (!main) { console.error('usage: page-sync.mjs pull <dump dir> | push [--problem "what|fix"] | ack <batch file> | done <request id> "<result>" [--posting <id>]'); process.exit(2); }
Promise.resolve().then(main).catch(e => { console.error(`page-sync: ${e.message}`); process.exit(1); });
