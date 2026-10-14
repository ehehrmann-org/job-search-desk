#!/usr/bin/env node
// Assembles the Job Search Desk page from style.css and body.html into dist/job-search-desk.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const body = fs.readFileSync(path.join(dir, 'body.html'), 'utf8');
const icons = fs.readFileSync(path.join(dir, 'icons.js'), 'utf8');
// Optional page_title in her desk.yml (kept across updates); plain text only.
let title = 'Job Search Desk';
try {
  const m = fs.readFileSync(path.join(dir, '..', '..', process.env.CAREER_OPS_DATA_DIR || 'profile', 'config', 'desk.yml'), 'utf8').match(/^page_title:\s*"?([^"\n#]{1,60}?)"?\s*(#.*)?$/m);
  if (m && m[1].trim()) title = m[1].trim().replace(/[<>&]/g, '');
} catch {}
const head = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap">
<style>
${css}</style>
`;
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist', 'job-search-desk.html');
// The page's own version, shown small in the header next to the update flag.
const version = fs.readFileSync(path.join(dir, '..', 'VERSION'), 'utf8').trim().replace(/[^0-9.]/g, '');
fs.writeFileSync(out, head + '\n<script>\nvar JSD_VERSION = "' + version + '";\n' + icons + '</script>\n' + body);
console.log(`built ${out} (${fs.statSync(out).size} bytes)`);
