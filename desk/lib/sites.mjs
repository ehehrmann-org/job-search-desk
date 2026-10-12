/**
 * sites.mjs: company websites for the job page (company names link to them).
 *
 * Kept in data/sites.json as { "<normCo(name)>": { name, url | null, at, how } }.
 * `how` is portals (a `website:` on the company's portals.yml entry), posting (the job
 * posting sits on the company's own site) or search (the daily run looked it up).
 * url null means looked up and not found; it is tried again after RETRY_DAYS.
 * A site is only kept when its address carries the company's name, so a wrong search
 * result or a job board never becomes a company link.
 */
import fs from 'node:fs';
import path from 'node:path';

export const RETRY_DAYS = 60;

/** Same key the page uses (normCo in desk/page/body.html). */
export const normCo = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Hosts that are never a company's own website: job boards, ATS, social and directory sites.
const NOT_COMPANY = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|breezy\.hr|icims\.com|applytojob\.com|jazzhr\.com|jobvite\.com|taleo\.net|oraclecloud\.com|successfactors\.com|ultipro\.com|ukg\.com|adp\.com|paylocity\.com|paycomonline\.net|rippling\.com|teamtailor\.com|personio\.(de|com)|pinpointhq\.com|dover\.com|gem\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|wellfound\.com|angel\.co|adzuna\.com|simplyhired\.com|monster\.com|dice\.com|careerbuilder\.com|builtin\.com|builtin[a-z]+\.com|jobright\.ai|startup\.jobs|gofractional\.com|hirewithjarvis\.com|chiefofstaff\.network|otta\.com|welcometothejungle\.com|remotive\.com|weworkremotely\.com|himalayas\.app|jooble\.org|talent\.com|crunchbase\.com|zoominfo\.com|bloomberg\.com|wikipedia\.org|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|google\.com|bing\.com|yelp\.com|bbb\.org|pitchbook\.com|clutch\.co|dnb\.com|rocketreach\.co|apollo\.io|comparably\.com|theorg\.com)$/i;

const TWO_PART_TLD = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/i;
const SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|agency|the|gmbh|plc|lp|llp)\b/g;

/** The registrable part of a host name: careers.acme.co.uk -> acme.co.uk. */
export function baseDomain(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  return parts.slice(TWO_PART_TLD.test(h) ? -3 : -2).join('.');
}

/** The company's own name without notes in brackets: "Acme Inc. (via a recruiter)" -> "Acme Inc." */
export const plainName = s => String(s ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();

// Names that hide the employer: nothing to look up.
const MASKED = /undisclosed|confidential|masked|stealth|unnamed|anonymous|^\W*$/i;

/** Whether a host name plausibly belongs to the company: its main label carries the company's name. */
export function nameMatches(host, company) {
  const label = baseDomain(host).split('.')[0].replace(/[^a-z0-9]/g, '');
  const words = plainName(company).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').split(/\s+/).filter(Boolean);
  if (!label || !words.length) return false;
  const joined = words.join('');
  if (label === joined || label.includes(joined) || (joined.length >= 4 && joined.includes(label) && label.length >= 4)) return true;
  const first = words[0];
  return first.length >= 4 && label.startsWith(first);
}

/** A company website as https://host/, or null when the link is not usable as one. */
export function cleanSite(url, company) {
  let u;
  try { u = new URL(String(url ?? '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || NOT_COMPANY.test(host)) return null;
  if (!nameMatches(host, company)) return null;
  return `https://${host.replace(/^(careers|jobs|apply|work|join|boards?)\./, '')}/`;
}

export function loadSites(dataDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'sites.json'), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function saveSites(dataDir, sites) {
  const f = path.join(dataDir, 'data', 'sites.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(sites).sort().map(k => [k, sites[k]]));
  fs.writeFileSync(f, JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Fill what is known without a lookup: a portals.yml `website:` and job postings on the
 * company's own site. companies: [{ name, urls: [posting links] }]. Returns true if changed.
 */
export function fillKnown(sites, companies, portals, day) {
  let changed = false;
  const byName = new Map();
  for (const co of portals?.tracked_companies || []) if (co?.name && co.website) byName.set(normCo(co.name), co);
  for (const { name, urls } of companies) {
    const k = normCo(name);
    if (!k) continue;
    const pc = byName.get(k);
    const fromPortals = pc ? cleanSite(pc.website, name) : null;
    if (fromPortals) {
      if (sites[k]?.url !== fromPortals) { sites[k] = { name, url: fromPortals, at: day, how: 'portals' }; changed = true; }
      continue;
    }
    if (sites[k]?.url) continue;
    for (const u of urls || []) {
      const s = cleanSite(u, name);
      if (s) { sites[k] = { name, url: s, at: day, how: 'posting' }; changed = true; break; }
    }
  }
  return changed;
}

/** Companies still without a website that are due a lookup, in the order given, at most cap: [{ company, search }]. */
export function dueLookups(sites, companies, today, cap) {
  const out = [];
  if (!(cap > 0)) return out;
  const seen = new Set();
  for (const { name } of companies) {
    const k = normCo(name);
    if (!k || seen.has(k) || MASKED.test(name) || !plainName(name)) continue;
    seen.add(k);
    const e = sites[k];
    if (e?.url) continue;
    if (e && e.at && (Date.parse(today) - Date.parse(e.at)) / 86400000 < RETRY_DAYS) continue;
    out.push({ company: name, search: plainName(name) });
    if (out.length >= cap) break;
  }
  return out;
}

/** Record lookups: [{ company, url | null }]. Returns { kept, rejected } counts. */
export function recordLookups(sites, results, day) {
  let kept = 0, rejected = 0;
  for (const r of Array.isArray(results) ? results : []) {
    const name = String(r?.company ?? '').trim().slice(0, 200);
    const k = normCo(name);
    if (!k) continue;
    if (sites[k]?.url && sites[k].how !== 'search') continue;
    const s = r.url ? cleanSite(r.url, name) : null;
    if (r.url && !s) rejected++;
    if (s) kept++;
    sites[k] = { name, url: s, at: day, how: 'search' };
  }
  return { kept, rejected };
}

/** The map the page reads: { normCo(name): url } for the given companies. */
export function pageSites(sites, companies) {
  const out = {};
  for (const { name } of companies) {
    const k = normCo(name);
    if (k && sites[k]?.url) out[k] = sites[k].url;
  }
  return out;
}
