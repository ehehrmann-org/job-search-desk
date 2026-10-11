#!/usr/bin/env node
/**
 * fetch-pending-jds.mjs: save the job description for every pending posting.
 *
 *   node desk/fetch-pending-jds.mjs [--limit 80]
 *
 * Runs in the daily scan (GitHub Actions) right after scan.mjs, because the
 * cloud scoring task cannot reach job boards. Reads the Pending section of
 * data/pipeline.md and writes one file per posting to jds/<id>.md:
 *
 *   ---
 *   id: "3f9a1c0b2e"
 *   url: "https://..."
 *   company: "..."
 *   title: "..."
 *   location: "..."
 *   found: "2026-10-11"
 *   jd: saved | missing
 *   ---
 *   <job description text>
 *
 * The id is the first 10 hex characters of the SHA-1 of the URL (or the id: cell
 * a pending line carries), so the same posting always gets the same file. Existing
 * files are never refetched. "missing" means the board has no public API upstream
 * can read (Greenhouse, Lever, Ashby, Workday and SmartRecruiters are covered), or a
 * covered board failed 3 days running; the scoring task then scores from the title
 * and company alone and says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchJdViaKnownApi } from '../browser-extract.mjs';
import { resolveAtsApi, JD_TEXT_API_ATS } from '../liveness-api.mjs';
import { DATA, isMain, safeId } from './lib/env.mjs';
import { urlKey } from './lib/urls.mjs';

const PIPELINE = path.join(DATA, 'data', 'pipeline.md');
const RETRIES = path.join(DATA, 'data', 'jd-retries.json');
const JDS = path.join(DATA, 'jds');
const CONCURRENCY = 4;
const MAX_TRIES = 3;
const LABELS = ['posted', 'note', 'id', 'source', 'trust'];

export const postingId = url => crypto.createHash('sha1').update(String(url).trim()).digest('hex').slice(0, 10);

/** Pending lines: "- [ ] url | company | title | location | ... | posted: YYYY-MM-DD | source: ..." */
export function parsePending(markdown) {
  const out = [];
  let inPending = false;
  for (const line of markdown.split('\n')) {
    if (/^##\s/.test(line)) { inPending = /^##\s+Pending/i.test(line); continue; }
    if (!inPending) continue;
    const m = line.match(/^\s*- \[ \] (https?:\/\/\S+)(.*)$/i);
    if (!m) continue;
    const cells = m[2].split(/\s*\|\s*/).map(s => s.trim());
    if (cells[0] === '') cells.shift();
    const isLabel = c => LABELS.some(k => c.toLowerCase().startsWith(`${k}:`));
    const labeled = k => { const c = cells.filter(x => x.toLowerCase().startsWith(`${k}:`)).pop(); return c ? c.slice(k.length + 1).trim() : ''; };
    const plain = cells.filter(c => !isLabel(c));
    const id = labeled('id');
    out.push({ url: m[1], company: plain[0] || '', title: plain[1] || '', location: plain[2] || '', posted: labeled('posted'), id: safeId(id) ? id : '', source: labeled('source') });
  }
  return out;
}

const yamlLine = (k, v) => `${k}: ${JSON.stringify(String(v ?? ''))}`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

async function main(args) {
  if (!fs.existsSync(PIPELINE)) { console.log('fetch-pending-jds: no pipeline.md'); return; }
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Math.max(1, Number(args[limitAt + 1]) || 80) : 80;
  fs.mkdirSync(JDS, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const retries = readJson(RETRIES, {});
  // Top line wins: the same link or id further down (an older line) is skipped.
  const seen = new Set();
  const first = k => (k && seen.has(k) ? false : (k && seen.add(k), true));
  const todo = parsePending(fs.readFileSync(PIPELINE, 'utf8'))
    .map(p => ({ ...p, id: p.id || postingId(p.url) }))
    .filter(p => { const a = first(`id:${p.id}`), b = first(`url:${urlKey(p.url)}`); return a && b; })
    .filter(p => !fs.existsSync(path.join(JDS, `${p.id}.md`)))
    .filter(p => retries[p.id]?.last !== today)
    .slice(0, limit);

  let saved = 0, missing = 0, later = 0;
  const queue = [...todo];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      let result = null;
      try { result = await fetchJdViaKnownApi(p.url, 20_000, 15_000); } catch { result = null; }
      const ok = !!(result && typeof result.text === 'string' && result.text.trim().length > 200);
      let covered = false;
      try { const r = resolveAtsApi(p.url); covered = !!(r && JD_TEXT_API_ATS.has(r.ats)); } catch { covered = false; }
      if (!ok && covered) {
        const r = retries[p.id] = { tries: (retries[p.id]?.tries || 0) + 1, last: today };
        if (r.tries < MAX_TRIES) { later++; continue; }
      }
      delete retries[p.id];
      ok ? saved++ : missing++;
      const head = ['---', yamlLine('id', p.id), yamlLine('url', p.url), yamlLine('company', p.company), yamlLine('title', p.title),
        yamlLine('location', p.location), yamlLine('posted', p.posted), yamlLine('found', today), `jd: ${ok ? 'saved' : 'missing'}`,
        ...(p.source ? [yamlLine('source', p.source)] : []), ...(p.source === 'Added by you' ? ['added: true'] : []), '---', ''];
      fs.writeFileSync(path.join(JDS, `${p.id}.md`), head.join('\n') + (ok ? result.text.trim() + '\n' : ''));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (Object.keys(retries).length || fs.existsSync(RETRIES)) fs.writeFileSync(RETRIES, JSON.stringify(retries, null, 2) + '\n');
  console.log(`fetch-pending-jds: ${todo.length} new postings, ${saved} descriptions saved, ${missing} missing, ${later} to retry tomorrow`);
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(e => { console.error(`fetch-pending-jds: ${e.message}`); process.exit(1); });
