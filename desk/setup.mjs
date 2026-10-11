#!/usr/bin/env node
/**
 * setup.mjs: checkpoints, the progress checklist and step checks for setup (desk/SETUP.md).
 *
 *   node desk/setup.mjs status                 the checklist, with time left
 *   node desk/setup.mjs start <step>           mark a step started (for "continue setup")
 *   node desk/setup.mjs done <step> ["note"]   run the step's check; mark it done only if it passes
 *   node desk/setup.mjs check [step]           run one step's check (or all done steps) without changing state
 *   node desk/setup.mjs init                   create an empty profile folder from the templates
 *   node desk/setup.mjs sample                 pick 8 scored postings for step 11 (3 high, 3 middle, 2 low)
 *   node desk/setup.mjs board <url>            which job board the daily scan would read for this link, if any
 *
 * State lives in profile/.setup-state.json so it travels with the private copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, validateScoringConfig, scorePosting } from './lib/scoring.mjs';

import { ROOT, DATA, isMain } from './lib/env.mjs';
import { loadDreamCompanies, isDream } from './lib/scoring.mjs';
const STATE = path.join(DATA, '.setup-state.json');
const f = (...p) => path.join(DATA, ...p);

export const STEPS = [
  { n: 1, title: 'Your private copy', min: 10, session: 1 },
  { n: 2, title: 'Connect Claude to your copy', min: 10, session: 1 },
  { n: 3, title: 'Your Claude plan', min: 3, session: 1 },
  { n: 4, title: 'Your profile', min: 25, session: 1 },
  { n: 5, title: 'How jobs get scored', min: 15, session: 1 },
  { n: 6, title: 'Dream companies', min: 10, session: 1 },
  { n: 7, title: 'Job sources', min: 10, session: 2 },
  { n: 8, title: 'Gmail and job alerts', min: 15, session: 2 },
  { n: 9, title: 'Your achievements', min: 20, session: 2 },
  { n: 10, title: 'Your resumes', min: 15, session: 2 },
  { n: 11, title: 'Test the scoring', min: 10, session: 2 },
  { n: 12, title: 'Go live', min: 5, session: 2 },
];

const readState = () => { try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); return s && typeof s.steps === 'object' ? s : { steps: {} }; } catch { return { steps: {} }; } };
const writeState = s => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n'); };
const readYaml = (p, d) => { try { return yaml.load(fs.readFileSync(p, 'utf8')) ?? d; } catch { return d; } };
const exists = p => fs.existsSync(p);

// ------------------------------------------------------------------ checks
// Each returns a list of plain-language problems; empty means the step is done.

const CHECKS = {
  1: () => [],   // happens on GitHub before this copy exists; reaching this script proves it
  2: () => [],   // likewise: this session can read the copy
  3: () => {
    const d = readYaml(f('config', 'desk.yml'), {});
    const out = [];
    if (!['Pro', 'Max 5x', 'Max 20x', 'Not sure'].includes(d.plan)) out.push('plan is not set to Pro, Max 5x, Max 20x or Not sure');
    if (!(Number(d.daily_cap) > 0)) out.push('daily_cap is missing');
    return out;
  },
  4: () => {
    const out = [];
    if (!exists(f('cv.md')) || fs.readFileSync(f('cv.md'), 'utf8').trim().length < 500) out.push('the master resume (cv.md) is missing or too short');
    const p = readYaml(f('config', 'profile.yml'), null);
    if (!p?.candidate?.full_name) out.push('profile.yml has no name');
    if (!p?.target_roles?.primary?.length) out.push('profile.yml has no target roles');
    if (!p?.location?.city) out.push('profile.yml has no location');
    if (!p?.location?.timezone) out.push('profile.yml has no time zone (location.timezone, e.g. America/Chicago); step 12 needs it for the daily run');
    const portals = readYaml(f('portals.yml'), {});
    if (!portals?.title_filter?.positive?.length) out.push('portals.yml has no job titles to look for');
    if (!(portals?.location_filter?.allow || []).length) out.push('portals.yml has no locations to allow (location_filter.allow)');
    if (!readYaml(f('config', 'desk.yml'), {}).current_employer) out.push('desk.yml has no current_employer (use "none" if not employed)');
    return out;
  },
  5: () => {
    const out = [];
    let cfg;
    try { cfg = readYaml(f('config', 'scoring.yml'), null); } catch { cfg = null; }
    if (!cfg) return ['scoring.yml is missing'];
    out.push(...validateScoringConfig(cfg));
    if (!(cfg.history || []).some(h => /step 5/i.test(String(h)))) out.push('scoring.yml history has no "step 5" line recording that she approved the first version');
    const emp = readYaml(f('config', 'desk.yml'), {}).current_employer;
    if (emp && emp !== 'none' && !(cfg.dealbreakers?.excluded_companies || []).some(c => String(c).toLowerCase() === String(emp).toLowerCase()))
      out.push(`the current employer (${emp}) is not in excluded_companies`);
    return out;
  },
  6: () => {
    const portals = readYaml(f('portals.yml'), {});
    const dreams = (portals.tracked_companies || []).filter(c => c?.dream);
    const out = [];
    for (const d of dreams) if (!d.careers_url && d.scan_method !== 'websearch') out.push(`${d.name} has neither a job board link nor a weekly web search`);
    return out; // zero dream companies is allowed
  },
  7: () => {
    const portals = readYaml(f('portals.yml'), {});
    return (portals.tracked_companies || []).filter(c => c?.enabled !== false).length ? [] : ['no job sources are turned on'];
  },
  8: () => {
    const d = readYaml(f('config', 'desk.yml'), {});
    const out = [];
    if (d.gmail_alerts !== false && !d.gmail_checked) out.push('the Gmail connection was not confirmed (gmail_checked)');
    if (d.gmail_alerts !== false && !(d.alert_searches || []).length) out.push('no job alert searches are recorded (alert_searches)');
    return out;
  },
  9: () => {
    const cv = exists(f('cv.md')) ? fs.readFileSync(f('cv.md'), 'utf8') : '';
    const bullets = (cv.match(/^\s*[-*] .+/gm) || []).length;
    const bank = exists(f('interview-prep', 'story-bank.md')) ? fs.readFileSync(f('interview-prep', 'story-bank.md'), 'utf8') : '';
    const stories = (bank.match(/^#{2,3} \S/gm) || []).length;
    const out = [];
    if (bullets < 8) out.push(`the master resume has ${bullets} bullets; aim for 8 to 12 approved achievement bullets`);
    if (stories < 3) out.push(`interview-prep/story-bank.md has ${stories} stories (one "## " heading each); write at least 3, one per theme`);
    return out;
  },
  10: () => {
    const idx = readYaml(f('resumes', 'index.yml'), {});
    const list = (idx.resumes || []).filter(r => r?.kind !== 'master');
    const out = [];
    if (list.length < 1 || list.length > 3) out.push(`${list.length} default resumes; there should be 1 to 3`);
    for (const r of list) {
      if (!r.id || !r.name) out.push('a resume entry is missing its id or name');
      if (!r.pdf || !exists(f('resumes', r.pdf))) out.push(`${r.name || r.id}: PDF missing`);
      if (!r.text_file || !exists(f('resumes', r.text_file))) out.push(`${r.name || r.id}: plain-text version missing`);
    }
    return out;
  },
  11: () => {
    const cases = (readYaml(f('config', 'scoring-cases.yml'), []) || []).filter(c => c?.input && typeof c.input === 'object');
    const counted = cases.filter(c => c.decision === 'apply' || c.decision === 'skip');
    if (cases.length < 5) return [`${cases.length} test postings recorded; step 11 needs at least 5 (8 when the scan found enough)`];
    let cfg; try { cfg = loadScoringConfig(f('config', 'scoring.yml')); } catch (e) { return [e.message]; }
    if (counted.length < 4) return [`only ${counted.length} of the test postings got a Would apply or Wouldn't; at least 4 are needed to measure agreement`];
    const dreams = loadDreamCompanies(f('portals.yml'));
    const agree = counted.filter(c => { const r = scorePosting(c.input, cfg, { dream: isDream(c.input.company, dreams) }); return c.decision === 'apply' ? r.status === 'qualified' : r.status !== 'qualified'; }).length;
    const changes = (cfg.history || []).filter(h => /step 11/i.test(String(h))).length;
    const target = Math.ceil(counted.length * 0.75);
    return agree >= target || changes >= 3 ? [] : [`${agree} of ${counted.length} agree (${target} needed), and fewer than 3 changes were tried (record each accepted change in scoring.yml history with "step 11")`];
  },
  12: () => {
    const d = readYaml(f('config', 'desk.yml'), {});
    const out = [];
    if (!d.page_url) out.push('the job page link is not recorded (page_url)');
    if (!d.task_id) out.push('the daily task is not recorded (task_id)');
    if (!d.page_consent) out.push('the first click on the job page was not confirmed (page_consent)');
    const idx = readYaml(f('resumes', 'index.yml'), {});
    for (const r of (idx.resumes || []).filter(r => r?.kind !== 'master')) if (!r.asset_id) out.push(`${r.name || r.id}: PDF not uploaded to the job page yet (asset_id)`);
    return out;
  },
};

// ------------------------------------------------------------------ commands

function status() {
  const s = readState();
  const left = STEPS.filter(x => !s.steps[x.n]?.done).reduce((a, x) => a + x.min, 0);
  const lines = [];
  let session = 0;
  for (const x of STEPS) {
    if (x.session !== session) { session = x.session; lines.push(`Session ${session}`); }
    const st = s.steps[x.n];
    const mark = st?.done ? '[x]' : st?.started ? '[~]' : '[ ]';
    lines.push(`  ${mark} ${x.n}. ${x.title}${st?.done ? '' : ` (about ${x.min} min)`}`);
  }
  const next = STEPS.find(x => !s.steps[x.n]?.done);
  lines.push('');
  lines.push(next ? `Next: step ${next.n}, ${next.title}. About ${left} minutes left in total.` : 'Setup is complete.');
  console.log(lines.join('\n'));
}

function start(n) {
  if (!STEPS.some(x => x.n === Number(n))) throw new Error(`no step ${n}`);
  n = Number(n);
  const s = readState();
  (s.steps[n] ||= {}).started = new Date().toISOString();
  writeState(s);
  console.log(`step ${n} started`);
}

function check(n) {
  if (n && !CHECKS[Number(n)]) throw new Error(`no step ${n}`);
  const list = n ? [Number(n)] : STEPS.map(x => x.n).filter(k => readState().steps[k]?.done);
  let bad = 0;
  for (const k of list) {
    const problems = CHECKS[k]();
    if (problems.length) { bad++; console.log(`Step ${k} is not finished:\n  - ${problems.join('\n  - ')}`); }
    else console.log(`Step ${k} check passed.`);
  }
  return bad === 0;
}

function done(n, note) {
  n = Number(n);
  if (!STEPS.some(x => x.n === n)) throw new Error(`no step ${n}`);
  const problems = CHECKS[n]();
  if (problems.length) { console.log(`Step ${n} is not finished:\n  - ${problems.join('\n  - ')}`); process.exitCode = 1; return; }
  const s = readState();
  s.steps[n] = { ...(s.steps[n] || {}), done: new Date().toISOString(), ...(note ? { note } : {}) };
  writeState(s);
  status();
}

function init() {
  const tpl = path.join(ROOT, 'desk', 'templates', 'profile');
  const copy = (src, dst) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const a = path.join(src, e.name), b = path.join(dst, e.name);
      if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
      else if (!exists(b)) fs.copyFileSync(a, b);
    }
  };
  fs.mkdirSync(DATA, { recursive: true });
  copy(tpl, DATA);
  if (!exists(f('config', 'scoring.yml'))) fs.copyFileSync(path.join(ROOT, 'desk', 'templates', 'scoring.example.yml'), f('config', 'scoring.yml'));
  console.log(`profile folder ready at ${path.relative(ROOT, DATA) || '.'}`);
}

/** Step 11: 8 scored postings, about 3 high, 3 middle, 2 low, spread across title families. */
function sample() {
  const dir = f('data', 'scores');
  const recs = exists(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => { try { return JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')); } catch { return null; } }) : [];
  const scored = recs.filter(r => typeof r?.verdict?.score === 'number' && fs.existsSync(f('data', 'extractions', `${r.verdict.id}.json`)));
  if (scored.length < 8) {
    console.log(JSON.stringify({ short: true, scored: scored.length, picked: scored.map(r => ({ id: r.verdict.id, jd_file: `jds/${r.verdict.id}.md` })), note: 'fewer than 8 scored postings without a deal-breaker: score more first (daily.mjs todo --cap 20), or add live postings found by web search (see SETUP step 11)' }, null, 2));
    return;
  }
  const family = r => String(r.title || r.verdict.title || '').toLowerCase().replace(/\b(senior|sr|lead|head|director|vp|vice president|manager|of|the|and|associate|principal)\b/g, '').replace(/[^a-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  const sorted = [...scored].sort((a, b) => b.verdict.score - a.verdict.score);
  const third = Math.ceil(sorted.length / 3);
  const bands = [sorted.slice(0, third), sorted.slice(third, 2 * third), sorted.slice(2 * third)];
  const want = [3, 3, 2];
  const picked = [], fams = new Set();
  bands.forEach((band, i) => {
    const fresh = band.filter(r => !fams.has(family(r)));
    const pool = [...fresh, ...band.filter(r => fams.has(family(r)))];
    for (const r of pool) { if (picked.filter(p => p.band === i).length >= want[i]) break; if (!picked.some(p => p.id === r.verdict.id)) { picked.push({ band: i, id: r.verdict.id }); fams.add(family(r)); } }
  });
  // Shuffle so the order gives nothing away.
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picked[i], picked[j]] = [picked[j], picked[i]]; }
  console.log(JSON.stringify(picked.map(p => ({ id: p.id, jd_file: `jds/${p.id}.md` })), null, 2));
}

/** Steps 6 and 7: does the daily scan have a reader for this careers or job board link? */
async function board(url) {
  const { boardFor } = await import('./lib/boards.mjs');
  const id = url ? await boardFor(url) : null;
  console.log(JSON.stringify(id ? { readable: true, board: id } : { readable: false, note: 'no reader for this link; find the job board behind the careers page, or use a weekly web search' }));
}

if (isMain(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  const run = { board: () => board(a), status, start: () => start(a), done: () => done(a, b), check: () => { if (!check(a)) process.exitCode = 1; }, init, sample }[cmd];
  if (!run) { console.error('usage: setup.mjs status | start <step> | done <step> ["note"] | check [step] | init | sample | board <url>'); process.exit(2); }
  Promise.resolve().then(run).catch(e => { console.error(`setup: ${e.message}`); process.exit(1); });
}
