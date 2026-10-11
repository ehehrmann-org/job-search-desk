#!/usr/bin/env node
/**
 * resume.mjs: render a resume written in markdown to PDF and plain text, in the one
 * plain layout every friend gets (employer systems read it reliably), and check that
 * every number in it comes from the master resume.
 *
 *   node desk/resume.mjs build <resumes/x.md>    writes resumes/x.pdf and resumes/x.txt
 *   node desk/resume.mjs check <resumes/x.md>    numbers not found in cv.md (exit 1 if any)
 *
 * Markdown shape (same as cv.md): "# Name", a contact line, "## Section",
 * "### Company — Location", a bold title line, a dates line, "- " bullets.
 */
import fs from 'node:fs';
import path from 'node:path';

import { DATA, isMain } from './lib/env.mjs';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');

export function toHtml(md) {
  const out = [];
  let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of md.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { close(); continue; }
    let m;
    if ((m = line.match(/^# (.+)/))) { close(); out.push(`<h1>${inline(m[1])}</h1>`); }
    else if ((m = line.match(/^## (.+)/))) { close(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^### (.+)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^\s*[-*] (.+)/))) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else { close(); out.push(`<p>${inline(line.trim())}</p>`); }
  }
  close();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.6in 0.7in; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 2pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #999; margin: 12pt 0 4pt; padding-bottom: 2pt; }
  h3 { font-size: 10.5pt; margin: 8pt 0 0; }
  p { margin: 1pt 0; }
  ul { margin: 2pt 0 4pt 14pt; padding: 0; }
  li { margin: 1.5pt 0; }
  </style></head><body>${out.join('\n')}</body></html>`;
}

export function toText(md) {
  return md.replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,3} /gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/^\s*[-*] /gm, '- ').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Numbers (with %, $, K/M suffixes) in the resume that never appear in the master. */
export function unsupportedNumbers(md, master) {
  const norm = s => s.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\$\s+/g, '$');
  const m = norm(master);
  const nums = norm(md.replace(/<!--[\s\S]*?-->/g, '')).match(/\$?\d+(?:\.\d+)?\s?(?:%|k\b|m\b|x\b|\+)?/g) || [];
  const years = /^(19|20)\d\d$/;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole numbers only: "35%" is not backed by "135%", and "2" is not backed by "2026".
  const inMaster = n => new RegExp(`(^|[^\\d.])${esc(n)}(?!\\d|\\.\\d)`).test(m);
  return [...new Set(nums.map(n => n.trim()))].filter(n => !years.test(n) && /\d/.test(n) && !inMaster(n));
}

async function launch() {
  const { chromium } = await import('playwright');
  try { return await chromium.launch(); }
  catch (e) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const dir = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop() : null;
    const exe = dir && ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'].map(p => path.join(base, dir, p)).find(fs.existsSync);
    if (!exe) throw e;
    return chromium.launch({ executablePath: exe });
  }
}

async function build(file) {
  const md = fs.readFileSync(file, 'utf8');
  const master = fs.readFileSync(path.join(DATA, 'cv.md'), 'utf8');
  const bad = unsupportedNumbers(md, master);
  if (bad.length) { console.error(`Not built: these numbers are not in the master resume: ${bad.join(', ')}. Add them to cv.md with the user's confirmation, or remove them.`); process.exit(1); }
  const base = file.replace(/\.md$/, '');
  fs.writeFileSync(`${base}.txt`, toText(md));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(toHtml(md), { waitUntil: 'load' });
    await page.pdf({ path: `${base}.pdf`, format: 'Letter', printBackground: false });
    const pages = (fs.readFileSync(`${base}.pdf`, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(JSON.stringify({ pdf: `${base}.pdf`, text: `${base}.txt`, pages }));
    if (pages > 2) console.error(`Warning: ${pages} pages; trim to 2.`);
  } finally { await browser.close(); }
}

if (isMain(import.meta.url)) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'build' && file) build(file).catch(e => { console.error(`resume: ${e.message}`); process.exit(1); });
  else if (cmd === 'check' && file) {
    const bad = unsupportedNumbers(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(DATA, 'cv.md'), 'utf8'));
    console.log(bad.length ? `Not in the master resume: ${bad.join(', ')}` : 'Every number is in the master resume.');
    if (bad.length) process.exitCode = 1;
  } else { console.error('usage: resume.mjs build <resumes/x.md> | check <resumes/x.md>'); process.exit(2); }
}
