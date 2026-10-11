// Company block list: the built-in reposting services (desk/lists/reposting-services.md)
// plus the user's own do-not-apply list (data/blacklist.md, upstream's format, which
// scan.mjs already honours). Matching is upstream's: case- and punctuation-insensitive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlacklist, findBlacklistEntry } from '../../scan.mjs';

const SYSTEM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lists', 'reposting-services.md');
export const BLACKLIST_HEADER = `# Company Blacklist

Companies you never want to see. The Job Search Desk page adds a row when you skip a job with "Never show jobs from this company", and removes it when you unblock. You can also edit this table by hand.

| Company | Since | Scope | Reason |
|---------|-------|-------|--------|
`;

export function loadBlocklist(dataDir) {
  const read = f => (fs.existsSync(f) ? parseBlacklist(fs.readFileSync(f, 'utf8')) : new Map());
  return { system: read(SYSTEM), user: read(path.join(dataDir, 'data', 'blacklist.md')) };
}

/** The matching entry, tagged with where it came from, or null. */
export function blockedBy(lists, company, url) {
  const u = findBlacklistEntry(lists.user, company, url);
  if (u) return { ...u, system: false };
  const s = findBlacklistEntry(lists.system, company, url);
  return s ? { ...s, system: true } : null;
}

export function listBlocked(lists) {
  const rows = [];
  for (const e of lists.system.values()) rows.push({ company: e.company, since: e.since, reason: e.reason, system: true });
  for (const e of lists.user.values()) rows.push({ company: e.company, since: e.since, reason: e.reason, system: false });
  return rows;
}

const cell = s => String(s ?? '').replace(/[|\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();

export function addToBlacklist(dataDir, company, reason, since) {
  const f = path.join(dataDir, 'data', 'blacklist.md');
  let txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : BLACKLIST_HEADER;
  if (findBlacklistEntry(parseBlacklist(txt), company, '')) return false;
  if (!txt.endsWith('\n')) txt += '\n';
  txt += `| ${cell(company)} | ${since} | company | ${cell(reason) || 'Blocked from the job page'} |\n`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, txt);
  return true;
}

export function removeFromBlacklist(dataDir, company) {
  const f = path.join(dataDir, 'data', 'blacklist.md');
  if (!fs.existsSync(f)) return false;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const keep = lines.filter(l => {
    if (!/^\|/.test(l) || /^\|\s*-/.test(l) || /^\|\s*Company\s*\|/i.test(l)) return true;
    const m = parseBlacklist(`| Company | Since | Scope | Reason |\n|---|---|---|---|\n${l}\n`);
    return !findBlacklistEntry(m, company, '');
  });
  if (keep.length === lines.length) return false;
  fs.writeFileSync(f, keep.join('\n'));
  return true;
}
