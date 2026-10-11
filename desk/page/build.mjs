#!/usr/bin/env node
// Assembles the Job Search Desk page from style.css and body.html into dist/job-search-desk.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const body = fs.readFileSync(path.join(dir, 'body.html'), 'utf8');
const icons = fs.readFileSync(path.join(dir, 'icons.js'), 'utf8');
const head = `<title>Job Search Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}</style>
`;
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist', 'job-search-desk.html');
fs.writeFileSync(out, head + '\n<script>\n' + icons + '</script>\n' + body);
console.log(`built ${out} (${fs.statSync(out).size} bytes)`);
