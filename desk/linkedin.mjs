#!/usr/bin/env node
/**
 * linkedin.mjs: the LinkedIn profile text on her page ("write my LinkedIn profile").
 * Claude writes profile/linkedin.yml; this script gives it the inputs and checks the result.
 * The profile aims at her whole set of target titles, never one posting, so it holds up
 * while resumes get tailored.
 *
 *   node desk/linkedin.mjs brief
 *       JSON: LinkedIn's limits, her target titles and level, her roles from cv.md, and the
 *       phrases that recur across the postings she qualified for or acted on (how many
 *       companies use each one; empty until 8 postings), plus the requirements those postings repeat.
 *
 *   node desk/linkedin.mjs check [file]
 *       Checks profile/linkedin.yml (or <file>): every field present and within LinkedIn's
 *       limits, each role matches one in cv.md, every number appears in cv.md, no em dashes.
 *       Prints { ok, problems[] }; exit 1 when there are problems.
 *
 * profile/linkedin.yml:
 *   updated: YYYY-MM-DD
 *   aims_at: one line, the titles and level the profile targets
 *   headline: ...                      (220 characters at most)
 *   about: |                           (2,600 at most)
 *   experience:                        (newest first; roles from cv.md)
 *     - { company, title, dates, description }   (title 100, description 2,000 at most)
 *   skills: [ ... ]                    (most important first; 50 at most)
 *   open_to_work: { titles: [...], locations: [...], workplaces: [...] }   (5 titles, 5 locations)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { DATA, isMain, readYamlStrict } from './lib/env.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { unsupportedNumbers } from './resume.mjs';

export const LIMITS = { headline: 220, about: 2600, title: 100, description: 2000, skills: 50, titles: 5, locations: 5 };
const WORKPLACES = ['On-site', 'Hybrid', 'Remote'];
const FILE = path.join(DATA, 'linkedin.yml');

// ------------------------------------------------------------------ cv.md roles

const DATE_LINE = /\b(19|20)\d\d\b|present|current/i;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = s => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/**
 * Roles under the Experience heading of cv.md, in either shape the desk uses:
 *   ### Company, City, ST  /  **Title**  /  dates
 *   ### Title | Company (Location)  /  **dates**
 */
export function cvRoles(md) {
  const roles = [];
  let inExp = false, cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h2 = line.match(/^##\s+(.+)/);
    if (h2 && !line.startsWith('###')) { inExp = /experience/i.test(h2[1]) && !/earlier/i.test(h2[1]); cur = null; continue; }
    if (!inExp) continue;
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      const head = clean(h3[1]);
      if (head.includes('|')) { const [title, rest] = head.split('|').map(s => s.trim()); cur = { company: rest.replace(/\s*\(.*\)\s*$/, '').trim(), title, dates: '' }; }
      else cur = { company: head.replace(/,.*$/, '').trim(), title: '', dates: '' };
      roles.push(cur);
      continue;
    }
    if (!cur || !line) continue;
    if (!cur.title && /^\*\*.+\*\*$/.test(line) && !DATE_LINE.test(line)) { cur.title = clean(line); continue; }
    if (!cur.dates && DATE_LINE.test(line) && line.length < 60 && !line.startsWith('-')) cur.dates = clean(line).replace(/\s*--\s*/g, ' – ');
  }
  return roles.filter(r => r.company);
}

// ------------------------------------------------------------------ brief

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or our the their this to was we will with you your who what when where which while within without into over per via than that these those they them us all any can may must should would could more most other such each both also not no only own same so too very just about across after before between during under up out off new well including include includes based able etc ' +
  'role roles job jobs position team teams work working company companies candidate candidates experience experiences years year opportunity opportunities apply benefits salary pay compensation equity bonus health dental vision insurance pto paid time leave employer employment equal applicants status disability veteran gender race religion orientation national origin age please us inc llc ' +
  // Hiring boilerplate, legal notices and places, which recur in every posting and say nothing about the work.
  'discriminate discrimination genetic information identity expression color sex protected legally law laws federal state local fair chance consideration receive accommodation accommodations inclusive workplace req id type fulltime full-time part-time model interview hiring process range location locations remote hybrid onsite on-site office degree bachelor bachelors related field looks like make sure looking committed do does ll re ve united states san francisco los angeles york city chicago boston seattle austin denver usa').split(' '));

function phrases(text) {
  // Two- and three-word phrases; tables, links and single words are too noisy to help.
  const prose = text.split('\n').filter(l => !/^\s*(\||---|#|url:|source:)/i.test(l)).join('\n').replace(/https?:\/\/\S+/g, ' ');
  const words = prose.toLowerCase().replace(/['\u2019][a-z]+/g, '').replace(/[^a-z0-9+#& -]/g, ' ').split(/\s+/).filter(w => w && w.length > 1 && !/\d/.test(w));
  const out = new Set();
  for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n);
    if (STOP.has(g[0]) || STOP.has(g[n - 1])) continue;
    out.add(g.join(' '));
  }
  return out;
}

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean);
}

export function brief() {
  const profile = readYamlStrict(yaml, path.join(DATA, 'config', 'profile.yml'), {}) || {};
  const cv = fs.existsSync(path.join(DATA, 'cv.md')) ? fs.readFileSync(path.join(DATA, 'cv.md'), 'utf8') : '';
  let decisions = {};
  try { decisions = JSON.parse(fs.readFileSync(path.join(DATA, 'data', 'page', 'decisions.json'), 'utf8')); } catch {}
  const acted = id => ['interested', 'applied', 'screen', 'hm', 'offer', 'accepted'].includes(decisions[id]?.status) || !!decisions[id]?.dates?.applied;
  // The postings that describe the jobs she wants: the ones she acted on, then the ones that reached her bar, newest first.
  const scores = readJsonDir(path.join(DATA, 'data', 'scores'))
    .filter(s => s?.verdict?.id && (acted(s.verdict.id) || s.verdict.status === 'qualified'))
    .sort((a, b) => (acted(b.verdict.id) - acted(a.verdict.id)) || String(b.scored_at || '').localeCompare(String(a.scored_at || '')))
    .slice(0, 60);
  const df = new Map(), titles = new Map(), reqs = new Map(), seen = new Set();
  let used = 0;
  for (const s of scores) {
    const f = path.join(DATA, 'jds', `${s.verdict.id}.md`);
    if (!fs.existsSync(f)) continue;
    let body = "", meta = {}; try { ({ body, meta } = readFrontMatter(f)); } catch { continue; }
    if (/career-ops/i.test(String(meta.source || '')) || /imported from career-ops/i.test(body)) continue;
    if (!body || body.length < 200) continue;
    // Text pasted from LinkedIn starts with the site's own buttons; the posting starts at "About the job".
    const at = body.search(/^\s*About the job\s*$/m);
    if (at > -1) body = body.slice(at);
    const key = norm(`${s.company || s.verdict.company || ''} ${s.title || s.verdict.title || ''}`), sig = norm(body).slice(0, 400);
    if (seen.has(key) || seen.has(sig)) continue;   // the same job found twice counts once
    seen.add(key); seen.add(sig); used++;
    // Counted per company, so one company's boilerplate in several postings counts once.
    const co = norm(s.company || s.verdict.company || key);
    for (const p of phrases(body)) { const set = df.get(p) || new Set(); set.add(co); df.set(p, set); }
    const t = String(s.title || s.verdict.title || '').replace(/\s*[(\[].*$/, '').trim();
    if (t) titles.set(t, (titles.get(t) || 0) + 1);
    const ex = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'data', 'extractions', `${s.verdict.id}.json`), 'utf8')); } catch { return null; } })();
    for (const c of ex?.candidacy || []) if (c?.requirement) { const k = String(c.requirement).slice(0, 140); reqs.set(k, (reqs.get(k) || 0) + 1); }
  }
  const min = Math.max(3, Math.round(used * 0.12));
  // Keep the longest phrases: drop a phrase when a longer one containing it appears about as often.
  const ranked = (used >= 8 ? [...df].map(([p, set]) => [p, set.size]) : []).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length);
  const kept = [];
  for (const [p, n] of ranked) {
    if (kept.some(k => k.phrase.includes(p) && k.postings >= n * 0.8)) continue;
    kept.push({ phrase: p, postings: n });
    if (kept.length >= 60) break;
  }
  return {
    limits: LIMITS,
    workplaces: WORKPLACES,
    target_roles: profile.target_roles?.primary || [],
    level: profile.preferences?.level || null,
    location: profile.location || null,
    best_job: profile.narrative?.best_job || null,
    roles: cvRoles(cv),
    postings_used: used,
    note: used >= 8 ? null : 'Fewer than 8 postings to learn from yet: write from her target titles and cv.md, and refresh once more jobs are scored.',
    titles_seen: [...titles].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([title, postings]) => ({ title, postings })),
    recurring_phrases: kept,
    recurring_requirements: [...reqs].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([requirement, postings]) => ({ requirement, postings })),
    rules: [
      'Aim at all of her target titles, never one posting; it has to hold up while resumes get tailored.',
      'Every fact and number comes from cv.md or from her in this conversation.',
      'First person in About, in her own voice; no em dashes, no buzzwords.',
      'Use her recurring phrases where they are true of her; never claim a skill cv.md does not support.',
      'Experience: her roles from cv.md, newest first, each a short lead line on scope and 3 to 5 lines of results.',
    ],
  };
}

// ------------------------------------------------------------------ check

const str = v => (typeof v === 'string' ? v : '');

export function check(doc, cv) {
  const out = [];
  if (!doc || typeof doc !== 'object') return ['The file is empty or not a list of fields.'];
  const len = (v, max, name) => { if (str(v).length > max) out.push(`${name} is ${str(v).length} characters; LinkedIn allows ${max}.`); };
  if (!str(doc.headline).trim()) out.push('headline is missing.');
  if (!str(doc.about).trim()) out.push('about is missing.');
  len(doc.headline, LIMITS.headline, 'headline');
  len(doc.about, LIMITS.about, 'about');
  const roles = cvRoles(cv || '');
  const exp = Array.isArray(doc.experience) ? doc.experience : [];
  if (!exp.length) out.push('experience has no roles.');
  exp.forEach((r, i) => {
    const name = `experience ${i + 1} (${str(r?.company) || 'no company'})`;
    if (!str(r?.company).trim() || !str(r?.title).trim()) out.push(`${name} needs a company and a title.`);
    if (!str(r?.description).trim()) out.push(`${name} has no description.`);
    len(r?.title, LIMITS.title, `${name} title`);
    len(r?.description, LIMITS.description, `${name} description`);
    if (roles.length && str(r?.company) && !roles.some(c => norm(c.company).includes(norm(r.company)) || norm(r.company).includes(norm(c.company))))
      out.push(`${name}: no role at that company in cv.md.`);
  });
  const skills = Array.isArray(doc.skills) ? doc.skills.map(s => str(s).trim()).filter(Boolean) : [];
  if (!skills.length) out.push('skills is empty.');
  if (skills.length > LIMITS.skills) out.push(`skills has ${skills.length}; keep the ${LIMITS.skills} that matter most.`);
  const dup = skills.filter((s, i) => skills.findIndex(t => t.toLowerCase() === s.toLowerCase()) !== i);
  if (dup.length) out.push(`skills lists ${[...new Set(dup)].join(', ')} twice.`);
  const otw = doc.open_to_work || {};
  if ((otw.titles || []).length > LIMITS.titles) out.push(`open_to_work has ${(otw.titles || []).length} titles; LinkedIn takes ${LIMITS.titles}.`);
  if ((otw.locations || []).length > LIMITS.locations) out.push(`open_to_work has ${(otw.locations || []).length} locations; LinkedIn takes ${LIMITS.locations}.`);
  for (const w of otw.workplaces || []) if (!WORKPLACES.includes(w)) out.push(`open_to_work workplace "${w}" is not one of ${WORKPLACES.join(', ')}.`);
  const all = [doc.headline, doc.about, ...exp.flatMap(r => [r?.title, r?.description]), ...skills].map(str).join('\n');
  if (/\u2014/.test(all)) out.push('Uses an em dash; use a comma, a period or a colon.');
  const nums = unsupportedNumbers(all, cv || '');
  if (nums.length) out.push(`Numbers not in cv.md: ${nums.join(', ')}. Use her numbers only, or confirm and add them to cv.md first.`);
  return out;
}

// ------------------------------------------------------------------ main

if (isMain(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'brief') console.log(JSON.stringify(brief(), null, 2));
    else if (cmd === 'check') {
      const file = arg ? path.resolve(arg) : FILE;
      if (!fs.existsSync(file)) throw new Error(`no ${path.relative(process.cwd(), file)} yet`);
      const doc = readYamlStrict(yaml, file, null);
      const cv = fs.existsSync(path.join(DATA, 'cv.md')) ? fs.readFileSync(path.join(DATA, 'cv.md'), 'utf8') : '';
      const problems = check(doc, cv);
      console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
      if (problems.length) process.exitCode = 1;
    } else { console.error('usage: linkedin.mjs brief | check [file]'); process.exitCode = 2; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
