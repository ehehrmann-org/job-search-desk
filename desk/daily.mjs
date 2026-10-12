#!/usr/bin/env node
/**
 * daily.mjs: deterministic steps of the daily task (desk/DAILY-TASK.md).
 *
 *   node desk/daily.mjs todo [--cap N]
 *       JSON: postings to score today (capped by config/desk.yml daily_cap, or --cap),
 *       how many wait for tomorrow, Interested postings that need a deep evaluation, and
 *       on Mondays the dream companies the daily scan can't read (weekly web search).
 *       Order: jobs the user added, dream companies, then newest first. Postings found
 *       more than 14 days ago and never scored are dropped (counted as too_old). A
 *       posting handed out 3 times without a usable extraction is recorded as unscorable.
 *       --cap 0 hands out nothing and records no attempt (used by a quick run to read to_deep only).
 *
 *   node desk/daily.mjs alerts <file.json>
 *       <file.json> is an array of jobs read from alert emails or web search:
 *       [{ url, title, company, location, source }]. Cleans each link, drops anything
 *       already seen, applies the block list and the title and location filters from
 *       portals.yml, appends the rest to data/pipeline.md (the next scan saves their
 *       descriptions) and records every new job in data/scan-history.tsv.
 *
 *   node desk/daily.mjs relink <job site link> <employer link>
 *       A LinkedIn or Indeed posting was found on the employer's own job board: queue the
 *       employer link under the same posting id (and source), so the scan reads that instead.
 *       A file the scan already wrote with `jd: missing` is removed so the scan reads the
 *       employer link; a saved or scored posting is left alone.
 *
 *   node desk/daily.mjs score
 *       Scores every data/extractions/<id>.json that has no data/scores/<id>.json yet,
 *       checking quotes against the saved posting, and records the verdicts. One bad
 *       extraction never stops the others.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, scorePosting, loadDreamCompanies, isDream, cleanFacts } from './lib/scoring.mjs';
import { buildTitleFilterWithOverrides, buildTitleFilterOverrides, buildLocationFilter, sanitizeMarkdownField, formatScanHistoryRow } from '../scan.mjs';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { loadBlocklist, blockedBy } from './lib/blocklist.mjs';
import { canonicalUrl, urlKey, seenKeys } from './lib/urls.mjs';
import { DATA, ROOT, isMain, safeId, readYamlStrict } from './lib/env.mjs';
import { parsePending, postingId } from './fetch-pending-jds.mjs';

const P = {
  jds: path.join(DATA, 'jds'), scores: path.join(DATA, 'data', 'scores'), extractions: path.join(DATA, 'data', 'extractions'),
  deep: path.join(DATA, 'data', 'deep'), decisions: path.join(DATA, 'data', 'page', 'decisions.json'),
  attempts: path.join(DATA, 'data', 'score-attempts.json'),
  desk: path.join(DATA, 'config', 'desk.yml'), portals: path.join(DATA, 'portals.yml'),
  pipeline: path.join(DATA, 'data', 'pipeline.md'), history: path.join(DATA, 'data', 'scan-history.tsv'),
  scoring: path.join(DATA, 'config', 'scoring.yml'),
};
export const MAX_AGE_DAYS = 14;
export const MAX_ATTEMPTS = 3;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const ids = (dir, ext) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).filter(safeId) : [];
const meta = id => { try { return readFrontMatter(path.join(P.jds, `${id}.md`)).meta || {}; } catch { return {}; } };
const isTrue = v => v === true || v === 'true';

function unscorable(id, m, why) {
  const verdict = { id, company: m.company || null, title: m.title || null, url: m.url || null, dream: false, status: 'unscorable', score: null,
    threshold: null, dealbreakers: [], ratings: [], candidacy_gaps: [], candidacy_penalty: 0, checks: [], evidence_issues: [why] };
  writeJson(path.join(P.scores, `${id}.json`), { verdict, facts: {}, company: m.company || null, title: m.title || null, suggested_resume: null, scored_at: new Date().toISOString() });
}

async function todo(args) {
  const desk = readYamlStrict(yaml, P.desk, {});
  const capAt = args.indexOf('--cap');
  const cap = capAt >= 0 ? Math.max(0, Number(args[capAt + 1]) || 0) : Number(desk.daily_cap) || 10;
  const scored = new Set(ids(P.scores, '.json'));
  const dreams = loadDreamCompanies(P.portals);
  const lists = loadBlocklist(DATA);
  const attempts = readJson(P.attempts, {});
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
  let blocked = 0, tooOld = 0, gaveUp = 0, gone = 0;
  const pending = [];
  for (const id of ids(P.jds, '.md')) {
    if (scored.has(id)) continue;
    const m = meta(id);
    const p = { id, jd_file: `jds/${id}.md`, company: m.company || '', title: m.title || '', url: m.url || '', jd: m.jd || 'missing', added: isTrue(m.added), dream: isDream(m.company, dreams), found: String(m.found || '') };
    if (p.jd === 'gone') {
      if (p.added) { unscorable(id, m, 'the job posting was taken down before it could be read'); gaveUp++; } else gone++;
      continue;
    }
    if (!p.added && blockedBy(lists, p.company, p.url)) { blocked++; continue; }
    if (p.added && p.jd === 'missing' && (!m.title || m.title === 'Added job')) { unscorable(id, m, 'the link needs a login; paste the job text instead'); gaveUp++; continue; }
    if ((attempts[id] || 0) >= MAX_ATTEMPTS) { unscorable(id, m, `no usable extraction after ${MAX_ATTEMPTS} tries`); gaveUp++; continue; }
    if (!p.added && !p.dream && p.found && p.found < cutoff) { tooOld++; continue; }
    pending.push(p);
  }
  pending.sort((a, b) => (b.added - a.added) || (b.dream - a.dream) || b.found.localeCompare(a.found) || a.id.localeCompare(b.id));
  const today = pending.slice(0, cap);
  for (const p of today) attempts[p.id] = (attempts[p.id] || 0) + 1;
  for (const id of Object.keys(attempts)) if (scored.has(id)) delete attempts[id];
  if (today.length || Object.keys(attempts).length) writeJson(P.attempts, attempts);

  const decisions = readJson(path.join(P.decisions), {});
  const deepDone = new Set(ids(P.deep, '.json'));
  const toDeep = Object.keys(decisions)
    .filter(id => safeId(id) && decisions[id]?.status === 'interested' && !deepDone.has(id) && fs.existsSync(path.join(P.jds, `${id}.md`)))
    .map(id => { const m = meta(id); return { id, jd_file: `jds/${id}.md`, company: m.company || '', title: m.title || '' }; });

  let dreamSearch = [];
  if (new Date().getUTCDay() === 1) {
    const portals = readYamlStrict(yaml, P.portals, {});
    const { loadProviders, resolveProvider } = await import('../providers/_registry.mjs');
    const providers = await loadProviders(path.join(ROOT, 'providers'));
    dreamSearch = (portals.tracked_companies || [])
      .filter(c => c?.name && c.dream && c.enabled !== false)
      .filter(c => c.scan_method === 'websearch' || !resolveProvider({ ...c, enabled: true }, providers, { skipIds: ['local-parser'] })?.provider)
      .map(c => ({ name: c.name, query: c.scan_query || `${c.name} careers` }));
  }
  console.log(JSON.stringify({
    daily_cap: cap, to_score: today, waiting: Math.max(0, pending.length - cap), blocked, too_old: tooOld, unscorable: gaveUp, gone,
    to_deep: toDeep.slice(0, Number(desk.deep_cap) || 1), dream_web_search: dreamSearch,
  }, null, 2));
}

async function alerts(file) {
  const jobs = readJson(file, null);
  if (!Array.isArray(jobs)) throw new Error(`${file} must hold a JSON array`);
  const cfg = readYamlStrict(yaml, P.portals, {});
  const titleOk = buildTitleFilterWithOverrides(cfg.title_filter, buildTitleFilterOverrides(cfg.title_filter_overrides));
  const locOk = buildLocationFilter(cfg.location_filter);
  const seen = seenKeys(DATA);
  const today = new Date().toISOString().slice(0, 10);
  const counts = { read: jobs.length, bad_link: 0, already_seen: 0, blocked: 0, filtered_title: 0, filtered_location: 0, added: 0 };
  const lists = loadBlocklist(DATA);
  const rows = [], lines = [], added = [];
  const one = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200);
  for (const j of jobs) {
    const url = canonicalUrl(j?.url);
    if (!url) { counts.bad_link++; continue; }
    const key = urlKey(url);
    if (seen.has(key)) { counts.already_seen++; continue; }
    seen.add(key);
    const company = one(j.company), title = one(j.title), location = one(j.location);
    let source = one(j.source) || 'Email alert';
    if (/added by you/i.test(source)) source = 'Email alert';
    let status = 'added';
    if (blockedBy(lists, company, url)) status = 'skipped_blacklist';
    else if (!titleOk(title, company)) status = 'skipped_title';
    else if (!locOk(location, url, title)) status = 'skipped_location';
    counts[{ added: 'added', skipped_blacklist: 'blocked', skipped_title: 'filtered_title', skipped_location: 'filtered_location' }[status]]++;
    const portal = /web search/i.test(source) ? 'web:search' : `gmail:${source}`;
    rows.push(formatScanHistoryRow({ url, source: portal, title, company, location }, today, status));
    if (status !== 'added') continue;
    lines.push(`- [ ] ${url} | ${sanitizeMarkdownField(company)} | ${sanitizeMarkdownField(title)} | ${sanitizeMarkdownField(location)} | source: ${sanitizeMarkdownField(source)}`);
    added.push({ url, company, title, on_job_site: /linkedin\.com|indeed\.com/.test(url) });
  }
  if (rows.length) {
    const hist = fs.existsSync(P.history) ? fs.readFileSync(P.history, 'utf8') : '';
    const head = hist ? (hist.endsWith('\n') ? '' : '\n') : `${SCAN_HISTORY_COLUMNS.join('\t')}\n`;
    fs.appendFileSync(P.history, head + rows.join('\n') + '\n');
  }
  if (lines.length) addPending(lines);
  console.log(JSON.stringify({ ...counts, added_jobs: added }, null, 2));
}

/** Put lines at the top of the Pending section of pipeline.md (creating either as needed). */
export function addPending(lines) {
  let md = fs.existsSync(P.pipeline) ? fs.readFileSync(P.pipeline, 'utf8') : '# Pipeline\n\n## Pending\n\n## Processed\n';
  const block = lines.join('\n') + '\n';
  md = /^## Pending[^\n]*\n/m.test(md) ? md.replace(/^## Pending[^\n]*\n\n?/m, m => `${m.trimEnd()}\n\n${block}`) : `${md.trimEnd()}\n\n## Pending\n\n${block}`;
  fs.mkdirSync(path.dirname(P.pipeline), { recursive: true });
  fs.writeFileSync(P.pipeline, md);
}

function relink(from, to) {
  const url = canonicalUrl(to);
  if (!url) throw new Error(`not a usable link: ${to}`);
  const key = urlKey(from);
  const md = fs.existsSync(P.pipeline) ? fs.readFileSync(P.pipeline, 'utf8') : '';
  const line = parsePending(md).find(p => urlKey(p.url) === key);
  if (!line) throw new Error(`not on the Pending list: ${from}`);
  const id = line.id || postingId(line.url);
  const jdFile = path.join(P.jds, `${id}.md`);
  if (fs.existsSync(jdFile)) {
    const saved = meta(id).jd !== 'missing' || fs.existsSync(path.join(P.scores, `${id}.json`));
    if (saved) { console.log(JSON.stringify({ relinked: false, note: 'its description is already saved' })); return; }
    // The scan wrote an empty file for a link it can't read: drop it so the next scan reads the employer link under the same id.
    fs.rmSync(jdFile, { force: true });
    fs.rmSync(path.join(P.extractions, `${id}.json`), { force: true });
    const attempts = readJson(P.attempts, {});
    if (attempts[id]) { delete attempts[id]; writeJson(P.attempts, attempts); }
  }
  const cells = [line.company, line.title, line.location].map(sanitizeMarkdownField);
  addPending([`- [ ] ${url} | ${cells.join(' | ')} | id: ${id}${line.source ? ` | source: ${sanitizeMarkdownField(line.source)}` : ''}`]);
  console.log(JSON.stringify({ relinked: true, id, url }));
}

function score() {
  const cfg = loadScoringConfig(P.scoring);
  const dreams = loadDreamCompanies(P.portals);
  const scored = new Set(ids(P.scores, '.json'));
  fs.mkdirSync(P.scores, { recursive: true });
  const out = [];
  for (const id of ids(P.extractions, '.json')) {
    if (scored.has(id)) continue;
    try {
      const x = readJson(path.join(P.extractions, `${id}.json`), null);
      if (!x || typeof x !== 'object' || Array.isArray(x)) { try { fs.unlinkSync(path.join(P.extractions, `${id}.json`)); } catch {} out.push({ id, error: 'extraction is not a JSON object; it is handed out again tomorrow' }); continue; }
      x.id = id;
      const jdFile = path.join(P.jds, `${id}.md`);
      const jd = fs.existsSync(jdFile) ? readFrontMatter(jdFile) : { meta: {}, body: '' };
      const body = jd.meta.jd === 'missing' ? '' : jd.body;
      if (!x.company && jd.meta.company) x.company = jd.meta.company;
      if (!x.title && jd.meta.title) x.title = jd.meta.title;
      const v = scorePosting(x, cfg, { dream: isDream(x.company, dreams), jdText: body && body.trim() ? body : null });
      const unrated = v.ratings.filter(r => r.source === 'judged' && r.score == null).map(r => r.name);
      if (unrated.length) { out.push({ id, error: `${unrated.join(', ')} not rated; it is handed out again tomorrow` }); continue; }
      writeJson(path.join(P.scores, `${id}.json`), {
        verdict: v, facts: cleanFacts(x.facts), company: x.company || null, title: x.title || null,
        suggested_resume: typeof x.suggested_resume === 'string' ? x.suggested_resume : null, scored_at: new Date().toISOString(),
        ...(x.injection ? { injection: String(x.injection).slice(0, 300) } : {}),
      });
      out.push({ id, company: v.company, title: v.title, status: v.status, score: v.score, dealbreaker: v.dealbreakers[0] || null, evidence_issues: v.evidence_issues.length, ...(x.injection ? { injection: String(x.injection).slice(0, 300) } : {}) });
    } catch (e) {
      out.push({ id, error: e.message });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = { todo: () => todo(rest), alerts: () => alerts(rest[0]), relink: () => relink(rest[0], rest[1]), score }[cmd];
  if (!run) { console.error('usage: daily.mjs todo [--cap N] | alerts <file.json> | relink <old link> <employer link> | score'); process.exit(2); }
  Promise.resolve().then(run).catch(e => { console.error(`daily: ${e.message}`); process.exit(1); });
}
