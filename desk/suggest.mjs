#!/usr/bin/env node
/**
 * suggest.mjs: weekly scoring suggestions, and applying the ones the user approves.
 *
 *   node desk/suggest.mjs week                 (Sundays) up to 3 suggestions from the last 4 weeks
 *                                              of decisions; writes data/suggestions/<week>.json
 *   node desk/suggest.mjs apply <week> <id>    apply one approved suggestion to config/scoring.yml,
 *                                              rescore every undecided posting, print what changed
 *   node desk/suggest.mjs decline <week> <id>  record "not now" (not suggested again for 4 weeks)
 *   node desk/suggest.mjs rescore              rescore every undecided posting with the current
 *                                              scoring.yml (the daily run does this every day)
 *
 * Everything here is arithmetic on stored data: no model calls, no Claude usage.
 * A suggestion is only made with at least 3 decisions behind it, and never repeats a
 * change the user declined in the last 4 weeks.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, validateScoringConfig, scorePosting, loadDreamCompanies, isDream } from './lib/scoring.mjs';
import { DATA, isMain } from './lib/env.mjs';
const P = {
  scoring: path.join(DATA, 'config', 'scoring.yml'),
  scores: path.join(DATA, 'data', 'scores'),
  extractions: path.join(DATA, 'data', 'extractions'),
  decisions: path.join(DATA, 'data', 'page', 'decisions.json'),
  out: path.join(DATA, 'data', 'suggestions'),
  portals: path.join(DATA, 'portals.yml'),
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const MIN_EVIDENCE = 3;
const WINDOW_DAYS = 28;
const k = n => `$${Math.round(n / 1000)}K`;

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function loadRecords() {
  const scores = fs.existsSync(P.scores) ? fs.readdirSync(P.scores).filter(f => f.endsWith('.json')).map(f => readJson(path.join(P.scores, f), null)).filter(r => r?.verdict?.id) : [];
  const decisions = readJson(P.decisions, {});
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return scores.map(r => ({ ...r, id: r.verdict.id, decision: decisions[r.verdict.id] || null })).map(r => {
    const d = r.decision; if (!d) return r;
    const when = (d.dates && (d.dates.closed || d.dates.applied || d.dates.interested)) || (d.at || '').slice(0, 10);
    return { ...r, recent: when >= since };
  });
}

// The page keeps dates.interested when a job is skipped later, so the status decides.
const acted = r => r.decision && r.decision.status !== 'skipped' && !!(r.decision.dates?.interested || r.decision.dates?.applied);
const skipped = (r, reason) => r.decision?.status === 'skipped' && (!reason || (r.decision.reasons || []).includes(reason));

/** Candidate suggestions, best first. Each carries plain-language text and a machine patch. */
// A job skipped because it had closed or was a duplicate says nothing about fit, so it is left out of every signal.
const NOT_FIT = ['Job closed', 'Duplicate'];
const closedFirst = r => r.decision?.status === 'skipped' && (r.decision.reasons || []).some(x => NOT_FIT.includes(x));

export function analyze(cfg, recs) {
  const out = [];
  const recent = recs.filter(r => r.recent && !closedFirst(r));
  const qual = recent.filter(r => r.verdict.status === 'qualified' && !r.verdict.dream);

  // 1. The bar: too low (most qualified postings get skipped) or too high (she applied to ones below it).
  const qActed = qual.filter(acted), qSkipped = qual.filter(r => skipped(r));
  if (qActed.length + qSkipped.length >= 8 && qActed.length / (qActed.length + qSkipped.length) < 0.5 && qActed.length) {
    // Halfway between the best-scoring skip below her lowest pick and that pick, so the bar
    // keeps a margin under the jobs she went for.
    const lowAct = Math.min(...qActed.map(r => r.verdict.score));
    const below = qSkipped.map(r => r.verdict.score).filter(x => x < lowAct);
    const t = below.length ? Math.floor(((Math.max(...below) + lowAct) / 2) * 10) / 10 : cfg.threshold;
    const filtered = qSkipped.filter(r => r.verdict.score < t).length;
    if (t >= cfg.threshold + 0.1 && filtered >= MIN_EVIDENCE)
      out.push({ id: 'threshold-up', title: `Raise your bar from ${cfg.threshold.toFixed(1)} to ${t.toFixed(1)}`,
        why: `You skipped ${qSkipped.length} of the last ${qActed.length + qSkipped.length} jobs that reached your bar. Every job you marked Interested or Applied scored ${lowAct.toFixed(1)} or higher, and ${filtered} of the skipped ones scored under ${t.toFixed(1)}.`,
        change: `Jobs scoring under ${t.toFixed(1)} stop reaching To review. Dream companies still always show.`,
        patch: { op: 'set', path: ['threshold'], value: t } });
  }
  const belowApplied = recent.filter(r => r.verdict.status === 'below_bar' && r.decision?.dates?.applied);
  if (belowApplied.length >= MIN_EVIDENCE) {
    const t = Math.floor(Math.min(...belowApplied.map(r => r.verdict.score)) * 10) / 10;
    if (t < cfg.threshold)
      out.push({ id: 'threshold-down', title: `Lower your bar from ${cfg.threshold.toFixed(1)} to ${t.toFixed(1)}`,
        why: `You applied to ${belowApplied.length} jobs that scored under your bar (lowest ${t.toFixed(1)}), so the bar is hiding jobs you want.`,
        change: `Jobs scoring ${t.toFixed(1)} or higher reach To review.`,
        patch: { op: 'set', path: ['threshold'], value: t } });
  }

  // 2. Pay floor from "Pay too low" skips.
  const payTops = recent.filter(r => skipped(r, 'Pay too low') && r.facts?.base_top).map(r => r.facts.base_top);
  if (payTops.length >= MIN_EVIDENCE) {
    const floor = Math.ceil((Math.max(...payTops) + 1) / 5000) * 5000;
    const actedTops = recent.filter(r => acted(r) && r.facts?.base_top).map(r => r.facts.base_top);
    const current = cfg.dealbreakers.comp_floor?.base || 0;
    if (floor > current && (!actedTops.length || floor <= Math.min(...actedTops)))
      out.push({ id: 'pay-floor', title: `Set your minimum pay to ${k(floor)}`,
        why: `You skipped ${payTops.length} jobs for pay; the best-paid of them topped out at ${k(Math.max(...payTops))}.` + (actedTops.length ? ` Every job you acted on paid ${k(Math.min(...actedTops))} or more.` : ''),
        change: `Jobs whose posted range tops out under ${k(floor)} are skipped before scoring. Jobs that don't post pay still show.`,
        patch: { op: 'set', path: ['dealbreakers', 'comp_floor'], value: { ...(cfg.dealbreakers.comp_floor || {}), base: floor, variable_share: cfg.dealbreakers.comp_floor?.variable_share ?? 0.75 } } });
  }

  // 3. An industry she keeps skipping.
  const inds = {};
  recent.filter(r => skipped(r, 'Industry') && r.facts?.industry).forEach(r => { const key = String(r.facts.industry).toLowerCase().trim(); inds[key] = (inds[key] || 0) + 1; });
  const [topInd, n] = Object.entries(inds).sort((a, b) => b[1] - a[1])[0] || [];
  if (topInd && n >= MIN_EVIDENCE && !cfg.dealbreakers.excluded_industries.some(i => i.toLowerCase() === topInd))
    out.push({ id: `industry-${topInd.replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`, title: `Stop showing ${topInd} jobs`,
      why: `You skipped ${n} ${topInd} jobs for their industry in the last ${WINDOW_DAYS / 7} weeks.`,
      change: `${topInd[0].toUpperCase() + topInd.slice(1)} becomes a deal-breaker: those jobs are skipped before scoring.`,
      patch: { op: 'add', path: ['dealbreakers', 'excluded_industries'], value: topInd } });

  // 4. Company size from "Company too big or small" skips.
  const sizes = recent.filter(r => skipped(r, 'Company too big or small') && r.facts?.employees).map(r => r.facts.employees);
  if (sizes.length >= MIN_EVIDENCE) {
    const actedSizes = recent.filter(r => acted(r) && r.facts?.employees).map(r => r.facts.employees);
    // Without a job she went for, a size skip says nothing about which way (too big or too small).
    const big = sizes.filter(s => actedSizes.length && s > Math.max(...actedSizes));
    const small = sizes.filter(s => actedSizes.length && s < Math.min(...actedSizes));
    const cur = cfg.dealbreakers.company_size || {};
    if (big.length >= MIN_EVIDENCE) {
      const max = Math.min(...big) - 1;
      if (cur.max == null || max < cur.max)
        out.push({ id: 'size-max', title: `Skip companies over ${max.toLocaleString('en-US')} people`,
          why: `You skipped ${big.length} jobs at companies of ${Math.min(...big).toLocaleString('en-US')} people or more for their size. The largest company you acted on has about ${Math.max(...actedSizes).toLocaleString('en-US')}.`,
          change: `Companies over ${max.toLocaleString('en-US')} people are skipped before scoring, unless they're dream companies or a listed exception.`,
          patch: { op: 'set', path: ['dealbreakers', 'company_size'], value: { ...cur, max } } });
    } else if (small.length >= MIN_EVIDENCE) {
      const min = Math.max(...small) + 1;
      if (cur.min == null || min > cur.min)
        out.push({ id: 'size-min', title: `Skip companies under ${min} people`,
          why: `You skipped ${small.length} jobs at companies of ${Math.max(...small)} people or fewer for their size.`,
          change: `Companies under ${min} people are skipped before scoring.`,
          patch: { op: 'set', path: ['dealbreakers', 'company_size'], value: { ...cur, min } } });
    }
  }

  // 5. Office days from "Location" skips.
  const actedDays = recent.filter(r => acted(r) && r.facts?.office_days > 0).map(r => r.facts.office_days);
  const days = recent.filter(r => skipped(r, 'Location') && r.facts?.office_days > 0 && (!actedDays.length || r.facts.office_days > Math.max(...actedDays))).map(r => r.facts.office_days);
  if (days.length >= MIN_EVIDENCE && cfg.dealbreakers.location) {
    const max = Math.min(...days) - 1;
    if (max >= 0 && (cfg.dealbreakers.location.max_office_days == null || max < cfg.dealbreakers.location.max_office_days))
      out.push({ id: 'office-days', title: max === 0 ? 'Only show remote jobs' : `Skip jobs with more than ${max} office day${max === 1 ? '' : 's'} a week`,
        why: `You skipped ${days.length} jobs for location that asked for ${Math.min(...days)} or more office days a week.` + (actedDays.length ? ` The jobs you went for asked for ${Math.max(...actedDays)} or fewer.` : ''),
        change: max === 0 ? 'Hybrid and office jobs are skipped before scoring.' : `Jobs asking for more than ${max} office days a week are skipped before scoring.`,
        patch: { op: 'set', path: ['dealbreakers', 'location'], value: { ...cfg.dealbreakers.location, max_office_days: max } } });
  }

  // 6. A dimension that rated high on jobs she skipped for that very reason: weigh it more.
  const MAP = { 'Wrong function': /role|fit|function|work|craft/i, 'Wrong seniority': /level|senior|scope/i, 'Location': /location|office|commute/i, 'Industry': /industry|company type|sector/i };
  const ORDER = ['nice', 'important', 'must'];
  for (const [reason, re] of Object.entries(MAP)) {
    const dim = cfg.dimensions.find(d => re.test(d.name) || re.test(d.id));
    if (!dim || dim.bucket === 'must') continue;
    const misses = recent.filter(r => skipped(r, reason) && (r.verdict.ratings || []).some(x => x.id === dim.id && x.score >= 4));
    if (misses.length >= MIN_EVIDENCE) {
      const up = ORDER[ORDER.indexOf(dim.bucket) + 1];
      const label = { must: 'Must have', important: 'Important', nice: 'Nice to have' };
      out.push({ id: `bucket-${dim.id}`, title: `Make "${dim.name}" ${label[up]}`,
        why: `You skipped ${misses.length} jobs as "${reason.toLowerCase()}" even though they rated 4 or 5 on ${dim.name}. It isn't carrying enough weight.`,
        change: `${dim.name} counts ${up === 'must' ? '3' : '2'} times instead of ${dim.bucket === 'important' ? '2' : '1'}. To change what a 5 means instead, tell Claude "change my scoring".`,
        patch: { op: 'set', path: ['dimensions', { id: dim.id }, 'bucket'], value: up } });
    }
  }
  return out;
}

function week() {
  const cfg = loadScoringConfig(P.scoring);
  const recs = loadRecords();
  const wk = isoWeek();
  const file = path.join(P.out, `${wk}.json`);
  if (fs.existsSync(file)) { console.log(JSON.stringify({ week: wk, note: 'already made this week', file })); return; }
  // Skip anything declined in the last 4 weeks.
  const declined = new Set();
  if (fs.existsSync(P.out)) for (const f of fs.readdirSync(P.out).filter(f => /^\d{4}-W\d\d\.json$/.test(f)).sort().slice(-4)) {
    for (const s of readJson(path.join(P.out, f), { items: [] }).items || []) if (s.outcome === 'declined') declined.add(s.id);
  }
  const items = analyze(cfg, recs).filter(s => !declined.has(s.id)).slice(0, 3);
  const decided = recs.filter(r => r.recent && r.decision).length;
  fs.mkdirSync(P.out, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ week: wk, at: new Date().toISOString(), decided, items }, null, 2) + '\n');
  console.log(JSON.stringify({ week: wk, decided, suggestions: items.map(s => s.title) }, null, 2));
}

// Week and suggestion ids arrive from the page: only these shapes may reach a file path.
const WEEK = /^\d{4}-W\d\d$/;
const SID = /^[a-z0-9_-]{1,48}$/;
// The only settings a suggestion may change.
const ALLOWED = new Set(['threshold', 'dealbreakers.comp_floor', 'dealbreakers.excluded_industries', 'dealbreakers.company_size', 'dealbreakers.location', 'dimensions.*.bucket']);
const pathKey = pth => pth.map(k => (typeof k === 'object' ? '*' : k)).join('.');

function setPath(obj, pth, op, value) {
  if (!Array.isArray(pth) || !ALLOWED.has(pathKey(pth))) throw new Error(`a suggestion may not change ${JSON.stringify(pth)}`);
  if (pth.some(k => ['__proto__', 'constructor', 'prototype'].includes(typeof k === 'object' ? k?.id : k))) throw new Error('invalid setting name');
  let cur = obj;
  for (let i = 0; i < pth.length - 1; i++) {
    const key = pth[i];
    if (typeof key === 'object') { cur = cur.find(x => x.id === key.id); if (!cur) throw new Error(`no dimension ${key.id}`); continue; }
    if (typeof pth[i + 1] === 'object') { cur = cur[key]; continue; }
    cur[key] ??= {};
    cur = cur[key];
  }
  const last = pth.at(-1);
  if (op === 'add') { cur[last] = [...(cur[last] || []), value]; } else cur[last] = value;
}

/** Apply one suggestion; rescore every posting the user hasn't decided on. Prints the changes. */
export function applySuggestion(wk, id) {
  if (!WEEK.test(String(wk)) || !SID.test(String(id))) throw new Error('not a valid suggestion');
  const file = path.join(P.out, `${wk}.json`);
  const doc = readJson(file, null);
  const s = doc?.items?.find(x => x.id === id);
  if (!s) throw new Error(`no suggestion ${id} in ${wk}`);
  if (s.outcome === 'applied') return { applied: false, note: 'already applied', title: s.title };
  const raw = fs.readFileSync(P.scoring, 'utf8');
  const header = (raw.match(/^(#[^\n]*\n)+/) || [''])[0];
  const cfg = yaml.load(raw);
  setPath(cfg, s.patch.path, s.patch.op, s.patch.value);
  cfg.history = [...(cfg.history || []), `${new Date().toISOString().slice(0, 10)} weekly suggestion approved: ${s.title}`];
  const errors = validateScoringConfig(cfg);
  if (errors.length) throw new Error(`the change would break scoring.yml: ${errors.join('; ')}`);
  fs.writeFileSync(P.scoring, header + yaml.dump(cfg, { lineWidth: 160, noRefs: true }));
  s.outcome = 'applied'; s.applied_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return { applied: true, title: s.title, rescored: rescoreOpen() };
}

export function decline(wk, id) {
  if (!WEEK.test(String(wk)) || !SID.test(String(id))) return false;
  const file = path.join(P.out, `${wk}.json`);
  const doc = readJson(file, null);
  const s = doc?.items?.find(x => x.id === id);
  if (!s) return false;
  s.outcome = 'declined'; fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return true;
}

/** Rescore postings with no decision yet from their stored extractions; update data/scores. */
export function rescoreOpen() {
  const cfg = loadScoringConfig(P.scoring);
  const dreams = loadDreamCompanies(P.portals);
  const decisions = readJson(P.decisions, {});
  const changed = [];
  if (!fs.existsSync(P.scores)) return changed;
  for (const f of fs.readdirSync(P.scores).filter(f => f.endsWith('.json'))) {
    const rec = readJson(path.join(P.scores, f), null);
    const id = rec?.verdict?.id;
    if (!id || decisions[id] || rec.verdict.status === 'unscorable') continue;
    const x = readJson(path.join(P.extractions, `${id}.json`), null);
    if (!x) continue;
    x.id = id;
    x.company ||= rec.company || rec.verdict.company;
    x.title ||= rec.title || rec.verdict.title;
    const v = scorePosting(x, cfg, { dream: isDream(x.company, dreams) });
    if (v.status !== rec.verdict.status || v.score !== rec.verdict.score) {
      changed.push({ id, from: `${rec.verdict.status} ${rec.verdict.score ?? ''}`.trim(), to: `${v.status} ${v.score ?? ''}`.trim() });
      fs.writeFileSync(path.join(P.scores, f), JSON.stringify({ ...rec, verdict: v, rescored_at: new Date().toISOString() }, null, 2) + '\n');
    }
  }
  return changed;
}

const [cmd, a, b] = process.argv.slice(2);
if (isMain(import.meta.url)) {
  try {
    if (cmd === 'week') week();
    else if (cmd === 'rescore') { const c = rescoreOpen(); console.log(JSON.stringify({ rescored: c.length, changes: c }, null, 2)); }
    else if (cmd === 'apply') console.log(JSON.stringify(applySuggestion(a, b), null, 2));
    else if (cmd === 'decline') console.log(decline(a, b) ? 'declined' : 'not found');
    else { console.error('usage: suggest.mjs week | rescore | apply <week> <id> | decline <week> <id>'); process.exit(2); }
  } catch (e) { console.error(`suggest: ${e.message}`); process.exit(1); }
}
