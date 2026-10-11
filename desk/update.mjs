#!/usr/bin/env node
/**
 * update.mjs: "update career tool". Brings a friend's private copy up to the latest template.
 *
 *   node desk/update.mjs check     JSON: current and new version, changelog since, files that change
 *   node desk/update.mjs apply     copies the new system files in, removes ones the template dropped
 *
 * Never touches profile/ (her data and settings). Keeps her daily scan time: the cron
 * line in .github/workflows/daily-scan.yml survives the update. The template is cloned
 * read-only into .work/template (owner/name from desk/TEMPLATE).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORK = path.join(ROOT, '.work', 'template');
const read = (p, d = '') => { try { return fs.readFileSync(p, 'utf8'); } catch { return d; } };
const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
const WORKFLOW = '.github/workflows/daily-scan.yml';

function fetchTemplate() {
  const tpl = read(path.join(ROOT, 'desk', 'TEMPLATE')).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(tpl)) throw new Error('desk/TEMPLATE is missing; this copy does not know where updates come from');
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(WORK), { recursive: true });
  execFileSync('git', ['clone', '--depth', '1', '--quiet', process.env.DESK_TEMPLATE_URL || `https://github.com/${tpl}.git`, WORK], { stdio: ['ignore', 'ignore', 'pipe'] });
  return tpl;
}

function plan() {
  const tpl = fetchTemplate();
  const mine = read(path.join(ROOT, 'desk', 'VERSION')).trim();
  const theirs = read(path.join(WORK, 'desk', 'VERSION')).trim();
  const newManifest = lines(read(path.join(WORK, 'desk', 'MANIFEST')));
  const oldManifest = lines(read(path.join(ROOT, 'desk', 'MANIFEST')));
  if (!newManifest.length) throw new Error('the template has no desk/MANIFEST');
  const shipped = newManifest.filter(f => fs.existsSync(path.join(WORK, f)));
  const changed = shipped.filter(f => !f.startsWith('profile/') && read(path.join(ROOT, f), null) !== read(path.join(WORK, f), null));
  const removed = oldManifest.filter(f => !f.startsWith('profile/') && !shipped.includes(f) && !newManifest.includes(f) && fs.existsSync(path.join(ROOT, f)));
  // Changelog entries newer than this copy's version.
  const log = read(path.join(WORK, 'desk', 'CHANGELOG.md'));
  const sections = log.split(/^## /m).slice(1).map(s => ({ version: s.split(/\s/)[0], text: s.split('\n').slice(1).join('\n').trim() }));
  const since = sections.filter(s => s.version !== mine && cmp(s.version, mine) > 0);
  return { template: tpl, current: mine, latest: theirs, up_to_date: changed.length === 0 && removed.length === 0, changelog: since, changed, removed };
}

function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function apply() {
  const p = plan();
  if (p.up_to_date) { console.log(JSON.stringify({ applied: false, note: 'already up to date', version: p.current })); return; }
  const keepCron = (read(path.join(ROOT, WORKFLOW)).match(/^\s*- cron: .*$/m) || [])[0];
  const missing = p.changed.filter(f => !fs.existsSync(path.join(WORK, f)));
  if (missing.length) throw new Error(`the template is incomplete (${missing.slice(0, 3).join(', ')}); nothing was changed`);
  for (const f of p.changed) {
    const dst = path.join(ROOT, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(WORK, f), dst);
  }
  for (const f of p.removed) fs.rmSync(path.join(ROOT, f), { force: true });
  if (keepCron && p.changed.includes(WORKFLOW)) {
    const wf = read(path.join(ROOT, WORKFLOW)).replace(/^\s*- cron: .*$/m, keepCron);
    fs.writeFileSync(path.join(ROOT, WORKFLOW), wf);
  }
  console.log(JSON.stringify({ applied: true, from: p.current, to: p.latest, changed: p.changed.length, removed: p.removed.length }));
}

const cmd = process.argv[2];
try {
  if (cmd === 'check') console.log(JSON.stringify(plan(), null, 2));
  else if (cmd === 'apply') apply();
  else { console.error('usage: update.mjs check | apply'); process.exit(2); }
} catch (e) { console.error(`update: ${e.message}`); process.exit(1); }
