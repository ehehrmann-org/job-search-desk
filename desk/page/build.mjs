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
<link rel="stylesheet" media="print" id="gf" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}</style>
`;
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist', 'job-search-desk.html');
// The font stylesheet loads as a print sheet (non-blocking) and switches to all media once it has arrived.
const fontJs = "(function(){var l=document.getElementById('gf');if(!l)return;var on=function(){l.media='all'};if(l.sheet){on();}else{l.addEventListener('load',on,{once:true});}})();\n";
fs.writeFileSync(out, head + '\n<script>\n' + fontJs + icons + '</script>\n' + body);
console.log(`built ${out} (${fs.statSync(out).size} bytes)`);
