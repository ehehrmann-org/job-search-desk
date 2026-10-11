#!/usr/bin/env node
/**
 * daily.mjs: deterministic steps of the daily task (desk/DAILY-TASK.md).
 *
 *   node desk/daily.mjs todo
 *       JSON: postings to score today (capped by config/desk.yml daily_cap), how many
 *       wait for tomorrow, Interested postings that need a deep evaluation, and on
 *       Mondays the dream companies without a job board (weekly web search).
 *
 *   node desk/daily.mjs alerts <file.json>
 *       <file.json> is an array of jobs read from alert emails:
 *       [{ url, title, company, location, source }]. Applies the title and location
 *       filters from portals.yml, drops anything already seen, appends the rest to
 *       data/pipeline.md (the next scan saves their descriptions) and records every
 *       job in data/scan-history.tsv. Prints counts.
 *
 *   node desk/daily.mjs score
 *       Scores every data/extractions/<id>.json that has no data/scores/<id>.json yet,
 *       checking quotes against jds/<id>.md, and records the verdicts.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, scorePosting, loadDreamCompanies, isDream } from './lib/scoring.mjs';
import { buildTitleFilterWithOverrides, buildTitleFilterOverrides, buildLocationFilter } from '../scan.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { loadBlocklist, blockedBy } from './lib/blocklist.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.resolve(ROOT, process.env.CAREER_OPS_DATA_DIR || '.');
const P = {
  jds: path.join(DATA, 'jds'), scores: path.join(DATA, 'data', 'scores'), extractions: path.join(DATA, 'data', 'extractions'),
  deep: path.join(DATA, 'data', 'deep'), decisions: path.join(DATA, 'data', 'page', 'decisions.json'),
  desk: path.join(DATA, 'config', 'desk.yml'), portals: path.join(DATA, 'portals.yml'),
  pipeline: path.join(DATA, 'data', 'pipeline.md'), history: path.join(DATA, 'data', 'scan-history.tsv'),
  scoring: path.join(DATA, 'config', 'scoring.yml'),
};
const readYaml = (f, d) => { try { return yaml.load(fs.readFileSync(f, 'utf8')) ?? d; } catch { return d; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const ids = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(json|md)$/.test(f)).map(f => f.replace(/\.(json|md)$/, '')) : [];

function todo() {
  const desk = readYaml(P.desk, {});
  const cap = Number(desk.daily_cap) || 10;
  const scored = new Set(ids(P.scores));
  const dreams = loadDreamCompanies(P.portals);
  const lists = loadBlocklist(DATA);
  let blocked = 0;
  const pending = ids(P.jds).filter(id => !scored.has(id)).map(id => {
    const m = readFrontMatter(path.join(P.jds, `${id}.md`)).meta;
    return { id, jd_file: `jds/${id}.md`, company: m.company, title: m.title, url: m.url, jd: m.jd, added: !!m.added, dream: isDream(m.company, dreams), found: m.found };
  }).filter(p => p.added || !blockedBy(lists, p.company, p.url) || (blocked++, false));
  // Added-by-you and dream postings first, then oldest first, so nothing starves.
  pending.sort((a, b) => (b.added - a.added) || (b.dream - a.dream) || String(a.found).localeCompare(String(b.found)));
  const decisions = readJson(P.decisions, {});
  const deepDone = new Set(ids(P.deep));
  const toDeep = Object.entries(decisions)
    .filter(([id, d]) => d && d.status === 'interested' && !deepDone.has(id) && fs.existsSync(path.join(P.jds, `${id}.md`)))
    .map(([id]) => { const m = readFrontMatter(path.join(P.jds, `${id}.md`)).meta; return { id, jd_file: `jds/${id}.md`, company: m.company, title: m.title }; });
  const monday = new Date().getDay() === 1;
  const portals = readYaml(P.portals, {});
  const dreamSearch = monday ? (portals.tracked_companies || []).filter(c => c?.dream && c.enabled !== false && c.scan_method === 'websearch').map(c => ({ name: c.name, query: c.scan_query || `${c.name} careers` })) : [];
  console.log(JSON.stringify({
    daily_cap: cap, to_score: pending.slice(0, cap), waiting: Math.max(0, pending.length - cap), blocked,
    to_deep: toDeep.slice(0, Number(desk.deep_cap) || 3), dream_web_search: dreamSearch,
  }, null, 2));
}

async function alerts(file) {
  const jobs = readJson(file, null);
  if (!Array.isArray(jobs)) throw new Error(`${file} must hold a JSON array`);
  const cfg = readYaml(P.portals, {});
  const titleOk = buildTitleFilterWithOverrides(cfg.title_filter, buildTitleFilterOverrides(cfg.title_filter_overrides));
  const locOk = buildLocationFilter(cfg.location_filter);
  const history = fs.existsSync(P.history) ? fs.readFileSync(P.history, 'utf8') : '';
  let md = fs.existsSync(P.pipeline) ? fs.readFileSync(P.pipeline, 'utf8') : '# Pipeline\n\n## Pending\n\n## Processed\n';
  const today = new Date().toISOString().slice(0, 10);
  const counts = { read: jobs.length, already_seen: 0, blocked: 0, filtered_title: 0, filtered_location: 0, added: 0 };
  const lists = loadBlocklist(DATA);
  const rows = [], lines = [];
  const clean = s => String(s ?? '').replace(/[|\t\n\r]+/g, ' ').trim();
  for (const j of jobs) {
    const url = String(j.url || '').split('?')[0].replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) continue;
    if (history.includes(url) || md.includes(url) || rows.some(r => r.startsWith(url + '\t'))) { counts.already_seen++; continue; }
    let status = 'added';
    if (blockedBy(lists, clean(j.company), url)) status = 'skipped_blacklist';
    else if (!titleOk(clean(j.title), j.company)) status = 'skipped_title';
    else if (!locOk(clean(j.location), url, clean(j.title))) status = 'skipped_location';
    counts[{ added: 'added', skipped_blacklist: 'blocked', skipped_title: 'filtered_title', skipped_location: 'filtered_location' }[status]]++;
    rows.push([url, today, `gmail:${clean(j.source) || 'alert'}`, clean(j.title), clean(j.company), status].join('\t'));
    if (status === 'added') lines.push(`- [ ] ${url} | ${clean(j.company)} | ${clean(j.title)} | ${clean(j.location)} | source: ${clean(j.source) || 'Email alert'}`);
  }
  if (rows.length) fs.appendFileSync(P.history, (history.endsWith('\n') || !history ? '' : '\n') + rows.join('\n') + '\n');
  if (lines.length) {
    md = /## Pending\n/.test(md) ? md.replace(/## Pending\n\n?/, m => `${m}${lines.join('\n')}\n`) : md + `\n## Pending\n\n${lines.join('\n')}\n`;
    fs.writeFileSync(P.pipeline, md);
  }
  console.log(JSON.stringify(counts));
}

function score() {
  const cfg = loadScoringConfig(P.scoring);
  const dreams = loadDreamCompanies(P.portals);
  const scored = new Set(ids(P.scores));
  fs.mkdirSync(P.scores, { recursive: true });
  const out = [];
  for (const id of ids(P.extractions)) {
    if (scored.has(id)) continue;
    const x = readJson(path.join(P.extractions, `${id}.json`), null);
    if (!x) { out.push({ id, error: 'extraction is not valid JSON' }); continue; }
    x.id = id;
    const jdFile = path.join(P.jds, `${id}.md`);
    const jdText = fs.existsSync(jdFile) ? readFrontMatter(jdFile).body : null;
    const v = scorePosting(x, cfg, { dream: isDream(x.company, dreams), jdText: jdText && jdText.trim() ? jdText : null });
    fs.writeFileSync(path.join(P.scores, `${id}.json`), JSON.stringify({
      verdict: v, facts: x.facts || {}, company: x.company || null, title: x.title || null,
      suggested_resume: x.suggested_resume || null, scored_at: new Date().toISOString(),
    }, null, 2) + '\n');
    out.push({ id, company: v.company, title: v.title, status: v.status, score: v.score, dealbreaker: v.dealbreakers[0] || null, evidence_issues: v.evidence_issues.length });
  }
  console.log(JSON.stringify(out, null, 2));
}

const [cmd, arg] = process.argv.slice(2);
const run = { todo, alerts: () => alerts(arg), score }[cmd];
if (!run) { console.error('usage: daily.mjs todo | alerts <file.json> | score'); process.exit(2); }
Promise.resolve().then(run).catch(e => { console.error(`daily: ${e.message}`); process.exit(1); });
