#!/usr/bin/env node
/**
 * probe-boards.mjs: find the job board behind a company's careers page.
 *
 *   node desk/probe-boards.mjs [--limit 80]
 *
 * Runs in the daily scan (GitHub Actions, from fetch-pending-jds.mjs), because the cloud task
 * cannot reach company websites. For tracked companies the scan can't read yet (portals.yml
 * entries with no job board reader), it opens the careers page (and the site's /careers and
 * /jobs pages), collects every link on them and keeps the first one a job board reader
 * understands (Greenhouse, Lever, Ashby, Workday and the rest of providers/). Only links on
 * the company's own pages count: guessing a board from the name can land on another
 * company with the same name. Results go to data/board-probe.json:
 *
 *   { "<company slug>": { at, result: found | none | error, url?, page?, detail? } }
 *
 * A company with no board found is checked again after 30 days. The morning run applies
 * found boards to portals.yml (page-sync.mjs pull), so those companies get checked daily.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { DATA, isMain, readYamlStrict } from './lib/env.mjs';
import { boardFor } from './lib/boards.mjs';
import { slug } from './lib/page-docs.mjs';

export const PROBE_FILE = path.join(DATA, 'data', 'board-probe.json');
const PORTALS = path.join(DATA, 'portals.yml');
const RETRY_DAYS = 30;
const TIMEOUT_MS = 10_000;
const BUDGET_MS = 6 * 60_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Hosts that are job boards or aggregators, never a company's own website.
export const BOARD_HOST = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|myworkdaysite\.com|bamboohr\.com|recruitee\.com|breezy\.hr|icims\.com|jobvite\.com|teamtailor\.com|personio\.(de|com)|rippling\.com|paylocity\.com|ultipro\.com|adp\.com|dayforcehcm\.com|applytojob\.com|jazzhr\.com|pinpointhq\.com|wellfound\.com|linkedin\.com|indeed\.com|builtin\.com|glassdoor\.com)$/i;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/** The company's own home page from a careers link, or null when the link is on a job board. */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || BOARD_HOST.test(u.hostname.replace(/^www\./, ''))) return null;
    return `${u.protocol}//${u.hostname}/`;
  } catch { return null; }
}

/** Every absolute or root-relative link in a page (href, src, data-url and bare job board URLs in scripts). */
export function linksIn(html, base) {
  const out = new Set();
  const add = raw => {
    const v = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!v || /^(mailto|tel|javascript|#)/i.test(v)) return;
    try { const u = new URL(v, base); if (/^https?:$/.test(u.protocol)) out.add(u.href); } catch { /* not a link */ }
  };
  for (const m of html.matchAll(/\b(?:href|src|data-url|data-href)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/https?:\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|bamboohr\.com|recruitee\.com|breezy\.hr|icims\.com|jobvite\.com|teamtailor\.com|rippling\.com|applytojob\.com|pinpointhq\.com)[^\s"'<>\\)]*/gi)) add(m[0]);
  return [...out];
}

/**
 * A job board link as the scan reads it: Greenhouse embeds become the board's own address, tracking queries go,
 * and links into a board's admin side (app.teamtailor.com, a dashboard or a login) are not boards at all.
 */
export function cleanBoardUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (/^(app|admin|login|dashboard|my)\./.test(host) || /\/(dashboard|login|signin|sign_in|admin)(\/|$)/i.test(u.pathname)) return null;
  if (/greenhouse\.io$/.test(host)) {
    const forSlug = u.searchParams.get('for');
    if (forSlug && /^[a-z0-9_-]+$/i.test(forSlug)) return `https://job-boards.greenhouse.io/${forSlug}`;
    if (/\/embed\//.test(u.pathname)) return null;
  }
  // The vendor's own home page ("Powered by Teamtailor") is not anyone's board.
  if ((/^www\./.test(host) || host.split('.').length === 2) && /^\/?$/.test(u.pathname)) return null;
  u.search = ''; u.hash = '';
  return u.href;
}

/** The first link a job board reader understands, preferring job board hosts over the page's own links. */
export async function boardLink(links, readerFor = boardFor) {
  const ordered = [...new Set(links.map(cleanBoardUrl).filter(Boolean))];
  for (const url of ordered) {
    if (!hostIsBoard(url)) continue;
    const reader = await readerFor(url);
    if (reader) return { url, reader };
  }
  return null;
}
const hostIsBoard = url => { try { return BOARD_HOST.test(new URL(url).hostname.replace(/^www\./, '')) ? 1 : 0; } catch { return 0; } };

async function getPage(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
    if (!res.ok) return { status: res.status, html: '', url: res.url || url };
    const type = res.headers.get('content-type') || '';
    if (!/html|text/i.test(type)) return { status: res.status, html: '', url: res.url || url };
    return { status: res.status, html: (await res.text()).slice(0, 2_000_000), url: res.url || url };
  } finally { clearTimeout(t); }
}

/** Companies the scan can't read yet, oldest check first; skips ones checked in the last 30 days. */
export async function candidates(portals, state, today = new Date()) {
  const cutoff = new Date(today.getTime() - RETRY_DAYS * 86400000).toISOString().slice(0, 10);
  const errCutoff = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);   // a page that didn't open is tried again sooner
  const out = [];
  for (const co of portals.tracked_companies || []) {
    if (!co?.name || co.enabled === false || !co.careers_url || !/^https?:\/\//i.test(co.careers_url)) continue;
    if (co.scan_method !== 'websearch' && await boardFor(co)) continue;
    const prev = state[slug(co.name)];
    if (prev?.result === 'found') continue;
    if (prev && String(prev.at || '') > (prev.result === 'error' ? errCutoff : cutoff)) continue;
    out.push({ co, at: prev?.at || '' });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).map(x => x.co);
}

export async function probe({ limit = 80, fetchPage = getPage } = {}) {
  const portals = readYamlStrict(yaml, PORTALS, {}) || {};
  const state = readJson(PROBE_FILE, {});
  const todo = (await candidates(portals, state)).slice(0, limit);
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let found = 0, none = 0, errors = 0;
  const queue = [...todo];
  async function worker() {
    for (let co = queue.shift(); co; co = queue.shift()) {
      if (Date.now() - started > BUDGET_MS) return;
      const key = slug(co.name);
      const site = siteOf(co.careers_url);
      // The careers link, the usual careers addresses, then the home page; from any of them, up to 2 same-site
      // links that look like a careers page are followed too (5 pages at most).
      const pages = [...new Set([co.careers_url, site && `${site}careers`, site && `${site}jobs`, site].filter(Boolean))];
      let hit = null, reached = false, detail = '', followed = 0;
      for (let i = 0; i < pages.length && i < 6; i++) {
        const page = pages[i];
        try {
          const r = await fetchPage(page);
          if (r.html) reached = true; else detail = `HTTP ${r.status}`;
          const landed = r.url && hostIsBoard(r.url) ? cleanBoardUrl(r.url) : null;
          if (landed) { const reader = await boardFor(landed); if (reader) { hit = { url: landed, reader, page }; break; } }
          const links = r.html ? linksIn(r.html, r.url || page) : [];
          const b = links.length ? await boardLink(links) : null;
          if (b) { hit = { ...b, page }; break; }
          for (const l of links) {
            if (followed >= 2 || pages.includes(l)) continue;
            try { if (siteOf(l) === siteOf(r.url || page) && /career|jobs|join|hiring|work-with-us|openings|positions/i.test(new URL(l).pathname)) { pages.push(l); followed++; } } catch { /* skip */ }
          }
        } catch (e) { detail = e.name === 'AbortError' ? 'timed out' : String(e.message || e).slice(0, 120); }
      }
      if (hit) { state[key] = { at: today, result: 'found', url: hit.url, reader: hit.reader, page: hit.page }; found++; }
      else if (reached) { state[key] = { at: today, result: 'none' }; none++; }
      else { state[key] = { at: today, result: 'error', detail }; errors++; }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
  fs.writeFileSync(PROBE_FILE, JSON.stringify(state, null, 2) + '\n');
  return { checked: found + none + errors, found, none, errors, left: Math.max(0, (await candidates(portals, state)).length) };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--limit');
  const limit = at >= 0 ? Math.max(1, Number(args[at + 1]) || 80) : 80;
  probe({ limit }).then(r => console.log(`probe-boards: ${JSON.stringify(r)}`), e => { console.error(`probe-boards: ${e.message}`); process.exitCode = 1; });
}
