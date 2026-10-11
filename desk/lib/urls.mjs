// Posting links: one clean spelling per posting, and a key for "have we seen this one?".
// Alert emails wrap job links in tracking (LinkedIn /comm/ paths, trackingId, refId,
// Indeed rc/clk redirects); the same job then arrives under several spellings.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeUrl } from '../../url-key.mjs';
import { readFrontMatter } from './frontmatter.mjs';

const STRIP = [/^utm_/i, /^trk/i, /^trackingid$/i, /^refid$/i, /^gh_src$/i, /^lever-(source|origin)/i, /^fbclid$/i, /^gclid$/i, /^mc_[ce]id$/i, /^igshid$/i, /^_hs/i];

/**
 * A clean, openable link for a posting, or null when the text is not a usable http(s) link.
 * LinkedIn and Indeed links reduce to their job id; elsewhere tracking parameters go and
 * everything that identifies the posting (path, other parameters, #/job/<id> routes) stays.
 */
export function canonicalUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2000 || /[\s|<>"'`\\[\]{}]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/);
    const cur = u.searchParams.get('currentJobId');
    const id = m ? m[1] : cur && /^\d{6,}$/.test(cur) ? cur : null;
    return id ? `https://www.linkedin.com/jobs/view/${id}` : null;
  }
  if (host === 'indeed.com' || host.endsWith('.indeed.com')) {
    const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
    return jk && /^[\w-]{6,40}$/.test(jk) ? `https://www.indeed.com/viewjob?jk=${jk}` : null;
  }
  for (const k of [...u.searchParams.keys()]) if (STRIP.some(re => re.test(k))) u.searchParams.delete(k);
  if (!/^#\/jobs?\//i.test(u.hash)) u.hash = '';
  u.protocol = 'https:';
  return u.toString();
}

/** Comparison key: '' means "no key", which never matches anything. */
export function urlKey(raw) {
  const c = canonicalUrl(raw);
  return normalizeUrl(c || String(raw ?? '').trim());
}

/** Every posting link already known: scan history, the pipeline, saved descriptions. */
export function seenKeys(dataDir) {
  const keys = new Set();
  const add = u => { const k = urlKey(u); if (k) keys.add(k); };
  const hist = path.join(dataDir, 'data', 'scan-history.tsv');
  if (fs.existsSync(hist)) for (const line of fs.readFileSync(hist, 'utf8').split('\n')) add(line.split('\t')[0]);
  const pipe = path.join(dataDir, 'data', 'pipeline.md');
  if (fs.existsSync(pipe)) for (const m of fs.readFileSync(pipe, 'utf8').matchAll(/^\s*- \[[ x!]\] (\S+)/gim)) add(m[1]);
  const jds = path.join(dataDir, 'jds');
  if (fs.existsSync(jds)) for (const f of fs.readdirSync(jds).filter(f => f.endsWith('.md'))) {
    try { add(readFrontMatter(path.join(jds, f)).meta.url); } catch { /* unreadable file: not a known link */ }
  }
  return keys;
}
