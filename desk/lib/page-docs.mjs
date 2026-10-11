/**
 * page-docs.mjs: build the documents the daily task writes to the page database.
 * Pure functions, no file or network access; desk/page-sync.mjs does the I/O.
 * The shapes are the contract in desk/DB.md.
 */
import crypto from 'node:crypto';

const ATS_NAMES = [
  [/greenhouse\.io/, 'Greenhouse'], [/lever\.co/, 'Lever'], [/ashbyhq\.com/, 'Ashby'],
  [/myworkdayjobs\.com|workday/, 'Workday'], [/workable\.com/, 'Workable'], [/smartrecruiters\.com/, 'SmartRecruiters'],
  [/bamboohr\.com/, 'BambooHR'], [/recruitee\.com/, 'Recruitee'], [/breezy\.hr/, 'Breezy'], [/icims\.com/, 'iCIMS'],
  [/linkedin\.com/, 'LinkedIn'], [/indeed\.com/, 'Indeed'], [/builtin/, 'Built In'],
];

export function sourceName(url, fallback = '') {
  if (fallback) return fallback;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Unknown source'; }
  for (const [re, name] of ATS_NAMES) if (re.test(host)) return name;
  return host;
}

export function payLabel(facts = {}) {
  const k = n => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  const lo = facts.base_bottom, hi = facts.base_top;
  if (lo == null && hi == null) return 'Pay not listed';
  const range = lo != null && hi != null && lo !== hi ? `$${k(lo)}–${k(hi)}` : `$${k(hi ?? lo)}`;
  return facts.pay_includes_variable ? `${range} incl. bonus` : range;
}

export const slug = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);

/**
 * postings/<id>
 * @param {object} rec - a data/scores/<id>.json record: { verdict, facts, suggested_resume, company, title }
 * @param {object} jd - front matter of jds/<id>.md
 */
export function postingDoc(rec, jd = {}) {
  const v = rec.verdict;
  const placeholder = t => !t || t === 'Added job' || t === 'Pasted job text';
  return {
    id: v.id,
    company: placeholder(jd.company) ? (rec.company || v.company || jd.company || '') : jd.company,
    title: placeholder(jd.title) ? (rec.title || v.title || jd.title || '') : jd.title,
    url: jd.url || v.url || '',
    location: jd.location || '',
    pay: payLabel(rec.facts),
    source: sourceName(jd.url || v.url, jd.source || ''),
    found: jd.found || (rec.scored_at || '').slice(0, 10),
    posted: jd.posted || '',
    dream: !!v.dream,
    score: v.score,
    threshold: v.threshold,
    status_hint: v.status,
    ratings: v.ratings.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, score: r.score, why: r.why })),
    checks: v.checks,
    suggested_resume: rec.suggested_resume || null,
    jd: jd.jd || 'saved',
    added_by_user: jd.added === 'true' || jd.added === true,
  };
}

/** Whether a scored posting belongs on the page. */
export function belongsOnPage(rec, jd = {}) {
  return rec.verdict.status === 'qualified' || jd.added === 'true' || jd.added === true;
}

export function runId(date = new Date()) {
  return date.toISOString().slice(0, 16).replace(':', '');
}

/** sources/<id>: rows + gaps; id is the date plus a content hash, so unchanged lists are not rewritten. */
export function sourcesDoc(rows, gaps, at, blocked = []) {
  const hash = crypto.createHash('sha1').update(JSON.stringify({ rows, gaps, blocked })).digest('hex').slice(0, 8);
  return { id: `${at.slice(0, 10)}-${hash}`, hash, body: { at, rows, gaps, blocked } };
}

/** Counts per company over the window, from jds front matter, score records and decisions. */
export function sourceCounts(jds, scores, decisions, sinceIso) {
  const by = {};
  const bump = (co, k) => { const key = slug(co); (by[key] ||= { found: 0, qual: 0, app: 0 })[k]++; };
  for (const j of jds) if ((j.found || '') >= sinceIso) bump(j.company, 'found');
  for (const s of scores) if ((s.scored_at || '').slice(0, 10) >= sinceIso && s.verdict.status === 'qualified') bump(s.company || s.verdict.company, 'qual');
  for (const s of scores) {
    const d = decisions[s.verdict.id];
    if (d?.dates?.applied && d.dates.applied >= sinceIso) bump(s.company || s.verdict.company, 'app');
  }
  return by;
}
