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
 *   id: 3f9a1c0b2e
 *   url: https://...
 *   company: ...
 *   title: ...
 *   location: ...
 *   found: 2026-10-11
 *   jd: saved | missing
 *   ---
 *   <job description text>
 *
 * The id is the first 10 hex characters of the SHA-1 of the URL, so the same
 * posting always gets the same file. Existing files are never refetched.
 * "missing" means the board has no public API upstream can read (fetch-jd.mjs
 * covers Greenhouse, Lever, Ashby, Workday and SmartRecruiters); the scoring
 * task then scores from the title and company alone and says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchJdViaKnownApi } from '../browser-extract.mjs';

const DATA = process.env.CAREER_OPS_DATA_DIR || '.';
const PIPELINE = path.join(DATA, 'data', 'pipeline.md');
const JDS = path.join(DATA, 'jds');
const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : 80;
const CONCURRENCY = 4;

export const postingId = url => crypto.createHash('sha1').update(String(url).trim()).digest('hex').slice(0, 10);

/** Pending lines: "- [ ] url | company | title | location | ... | posted: YYYY-MM-DD" */
export function parsePending(markdown) {
  const out = [];
  let inPending = false;
  for (const line of markdown.split('\n')) {
    if (/^##\s/.test(line)) { inPending = /^##\s+Pending/i.test(line); continue; }
    if (!inPending) continue;
    const m = line.match(/^- \[ \] (\S+)(.*)$/);
    if (!m) continue;
    const cells = m[2].split(/\s*\|\s*/).map(s => s.trim());
    if (cells[0] === '') cells.shift();
    const labeled = k => { const c = cells.find(x => x.startsWith(`${k}:`)); return c ? c.slice(k.length + 1).trim() : ''; };
    const plain = cells.filter(c => !/^(posted|note|id|source):/.test(c));
    out.push({ url: m[1], company: plain[0] || '', title: plain[1] || '', location: plain[2] || '', posted: labeled('posted'), id: labeled('id'), source: labeled('source') });
  }
  return out;
}

const yamlLine = (k, v) => `${k}: ${JSON.stringify(String(v ?? ''))}`;

async function main() {
  if (!fs.existsSync(PIPELINE)) { console.log('fetch-pending-jds: no pipeline.md'); return; }
  fs.mkdirSync(JDS, { recursive: true });
  const todo = parsePending(fs.readFileSync(PIPELINE, 'utf8'))
    .map(p => ({ ...p, id: p.id || postingId(p.url) }))
    .filter(p => !fs.existsSync(path.join(JDS, `${p.id}.md`)))
    .slice(0, LIMIT);

  const today = new Date().toISOString().slice(0, 10);
  let saved = 0, missing = 0;
  const queue = [...todo];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      let result = null;
      try { result = await fetchJdViaKnownApi(p.url, 20_000, 15_000); } catch { result = null; }
      const ok = !!(result && result.text && result.text.trim().length > 200);
      ok ? saved++ : missing++;
      const head = ['---', yamlLine('id', p.id), yamlLine('url', p.url), yamlLine('company', p.company), yamlLine('title', p.title),
        yamlLine('location', p.location), yamlLine('posted', p.posted), yamlLine('found', today), `jd: ${ok ? 'saved' : 'missing'}`,
        ...(p.source ? [yamlLine('source', p.source)] : []), ...(p.source === 'Added by you' ? ['added: true'] : []), '---', ''];
      fs.writeFileSync(path.join(JDS, `${p.id}.md`), head.join('\n') + (ok ? result.text.trim() + '\n' : ''));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`fetch-pending-jds: ${todo.length} new postings, ${saved} descriptions saved, ${missing} missing`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`fetch-pending-jds: ${e.message}`); process.exit(1); });
