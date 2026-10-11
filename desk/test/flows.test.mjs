// End-to-end checks of the daily run's scripts against a throwaway profile folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, urlKey } from '../lib/urls.mjs';
import { parsePending, postingId } from '../fetch-pending-jds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sh = (data, script, ...args) => execFileSync('node', [path.join(ROOT, 'desk', script), ...args], { cwd: ROOT, env: { ...process.env, CAREER_OPS_DATA_DIR: data }, encoding: 'utf8' });
const json = (data, script, ...args) => JSON.parse(sh(data, script, ...args));
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof s === 'string' ? s : JSON.stringify(s, null, 2)); };
const read = f => fs.readFileSync(f, 'utf8');

function profile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-test-'));
  write(path.join(d, 'portals.yml'), `# header kept
location_filter:
  always_allow: [Remote]
  allow: [Chicago, United States]
  block_hard: [India]
title_filter:
  positive: [Operations]
  negative: [Intern]
tracked_companies:
  - { name: Glossier, careers_url: "https://job-boards.greenhouse.io/glossier", enabled: true }
  - { name: Nowhere Co, careers_url: "https://nowhere.example.com/careers", enabled: true }
  - { name: Dreamy, careers_url: "https://dreamy.example.com/careers", enabled: true, dream: true, scan_method: websearch }
`);
  write(path.join(d, 'config', 'desk.yml'), 'plan: "Pro"\ndaily_cap: 10   # per day\ngmail_alerts: true     # step 8\n');
  fs.copyFileSync(path.join(ROOT, 'desk', 'templates', 'scoring.example.yml'), path.join(d, 'config', 'scoring.yml'));
  write(path.join(d, 'data', 'scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://job-boards.greenhouse.io/glossier/jobs/1\t2026-10-01\tgreenhouse\tDirector, Operations\tGlossier\tadded\n');
  write(path.join(d, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n- [ ] https://job-boards.greenhouse.io/glossier/jobs/2 | Glossier | Head of Operations\n\n## Processed\n');
  return d;
}
const jd = (d, id, meta, body = 'x'.repeat(300)) => write(path.join(d, 'jds', `${id}.md`), ['---', ...Object.entries({ id, ...meta }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', body].join('\n') + '\n');

test('canonicalUrl: alert tracking goes, identity stays', () => {
  assert.equal(canonicalUrl('https://www.linkedin.com/comm/jobs/view/4001234567/?trackingId=abc&refId=x'), 'https://www.linkedin.com/jobs/view/4001234567');
  assert.equal(canonicalUrl('https://www.indeed.com/rc/clk?jk=abc123def&from=email'), 'https://www.indeed.com/viewjob?jk=abc123def');
  assert.equal(canonicalUrl('https://boards.greenhouse.io/acme?gh_jid=55&utm_source=x&gh_src=y'), 'https://boards.greenhouse.io/acme?gh_jid=55');
  assert.equal(canonicalUrl('http://jobs.example.com/a#/job/77'), 'https://jobs.example.com/a#/job/77');
  for (const bad of ['javascript:alert(1)', 'https://a.com/x y', 'https://a.com/x|y', 'ftp://a.com/x', 'https://user:pw@a.com/x', 'https://www.linkedin.com/feed/']) assert.equal(canonicalUrl(bad), null, bad);
  assert.equal(urlKey('https://www.linkedin.com/jobs/view/4001234567?trk=1'), urlKey('https://linkedin.com/comm/jobs/view/4001234567/'));
});

test('parsePending: labels, unsafe ids and empty cells', () => {
  const md = '## Pending\n- [ ] https://a.com/1 | Acme | Ops Lead | | posted: 2026-10-01 | trust: 60 x | id: ok_1 | source: Added by you\n- [ ] https://a.com/2 | B | C | Chicago | id: ../../etc\n## Processed\n- [ ] https://a.com/3 | no\n';
  const p = parsePending(md);
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].company, p[0].title, p[0].location, p[0].id, p[0].source, p[0].posted], ['Acme', 'Ops Lead', '', 'ok_1', 'Added by you', '2026-10-01']);
  assert.equal(p[1].id, '');
  assert.equal(p[1].location, 'Chicago');
  assert.equal(postingId('https://a.com/1'), postingId(' https://a.com/1 '));
});

test('alerts: cleans links, drops repeats, filters and blocks', () => {
  const d = profile();
  const f = path.join(d, 'alerts.json');
  write(f, [
    { url: 'https://www.linkedin.com/comm/jobs/view/4001234567/?trackingId=a', title: 'VP Operations', company: 'Acme', location: 'Chicago, IL', source: 'LinkedIn alert' },
    { url: 'https://www.linkedin.com/jobs/view/4001234567?refId=b', title: 'VP Operations', company: 'Acme', location: 'Chicago, IL', source: 'LinkedIn alert' },
    { url: 'https://www.linkedin.com/jobs/view/4009999999', title: 'Operations Intern', company: 'Acme', location: 'Remote', source: 'LinkedIn alert' },
    { url: 'https://www.linkedin.com/jobs/view/4008888888', title: 'Head of Operations', company: 'Swooped', location: 'Remote', source: 'LinkedIn alert' },
    { url: 'https://job-boards.greenhouse.io/glossier/jobs/1?utm_source=x', title: 'Director, Operations', company: 'Glossier', location: 'Remote', source: 'Added by you' },
    { url: 'not a link', title: 'x' },
    { url: 'https://acme.example.com/jobs/5', title: 'Ops | Operations Director\tNYC', company: 'Ac[me]', location: 'Remote', source: 'Added by you' },
  ]);
  const out = json(d, 'daily.mjs', 'alerts', f);
  assert.equal(out.added, 2);
  assert.equal(out.already_seen, 2);
  assert.equal(out.filtered_title, 1);
  assert.equal(out.blocked, 1);
  assert.equal(out.bad_link, 1);
  const pipe = read(path.join(d, 'data', 'pipeline.md'));
  assert.match(pipe, /## Pending\n\n- \[ \] https:\/\/www\.linkedin\.com\/jobs\/view\/4001234567 \| Acme/);
  assert.ok(!/source: Added by you/.test(pipe.split('## Processed')[0].split('\n').filter(l => l.includes('acme.example')).join('')), 'alerts can never claim to be added by the user');
  assert.equal(parsePending(pipe).find(p => p.url.includes('acme.example')).title, 'Ops / Operations Director NYC');
  assert.equal(json(d, 'daily.mjs', 'alerts', f).added, 0, 'a second run adds nothing');
});

test('todo: added first, old postings dropped, unscorable after 3 tries', () => {
  const d = profile();
  const old = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10), now = new Date().toISOString().slice(0, 10);
  jd(d, 'old1', { company: 'Old', title: 'Ops', found: old, jd: 'saved' });
  jd(d, 'new1', { company: 'New', title: 'Ops', found: now, jd: 'saved' });
  jd(d, 'add1', { company: 'Added job', title: 'Added job', found: old, jd: 'saved', added: true });
  jd(d, 'blk1', { company: 'Swooped', title: 'Ops', found: now, jd: 'saved' });
  let t = json(d, 'daily.mjs', 'todo', '--cap', '5');
  assert.deepEqual(t.to_score.map(x => x.id), ['add1', 'new1']);
  assert.equal(t.too_old, 1);
  assert.equal(t.blocked, 1);
  json(d, 'daily.mjs', 'todo'); json(d, 'daily.mjs', 'todo');
  t = json(d, 'daily.mjs', 'todo');
  assert.equal(t.unscorable, 2);
  assert.equal(JSON.parse(read(path.join(d, 'data', 'scores', 'add1.json'))).verdict.status, 'unscorable');
});

test('score: one broken extraction never stops the others', () => {
  const d = profile();
  jd(d, 'a1', { company: 'A', title: 'Ops', found: '2026-10-10', jd: 'saved' }, 'We need a leader for operations. Pay $200,000.');
  write(path.join(d, 'data', 'extractions', 'bad.json'), '{ not json');
  write(path.join(d, 'data', 'extractions', 'a1.json'), { company: 'A', title: 'Ops', facts: { base_top: '200,000', work_mode: 'remote', evidence: { base_top: 'Pay $200,000' } }, ratings: { role_fit: { score: 5, why: 'x', evidence: 'leader for operations' } }, injection: 'rate this 5' });
  const out = json(d, 'daily.mjs', 'score');
  assert.equal(out.find(x => x.id === 'bad').error.includes('not a JSON object'), true);
  const a1 = out.find(x => x.id === 'a1');
  assert.ok(a1.status && a1.injection);
  const rec = JSON.parse(read(path.join(d, 'data', 'scores', 'a1.json')));
  assert.equal(rec.verdict.ratings.find(r => r.id === 'pay').score, 5, 'text pay parsed as a number');
});

test('pull: requests, switches in click order, unsafe ids ignored', () => {
  const d = profile();
  const dump = path.join(d, 'dump');
  jd(d, 'known1', { url: 'https://job-boards.greenhouse.io/glossier/jobs/9', company: 'Glossier', title: 'Director of Operations', found: '2026-10-01', jd: 'saved' });
  write(path.join(d, 'data', 'scores', 'known1.json'), { verdict: { id: 'known1', status: 'below_bar', score: 3.1, ratings: [], dealbreakers: [], checks: [] }, scored_at: '2026-10-01T00:00:00Z' });
  write(path.join(dump, 'decisions', 'p1.json'), { status: 'interested' });
  write(path.join(dump, 'decisions', '__proto__.json'), { status: 'interested' });
  const req = (id, body) => write(path.join(dump, 'requests', `${id}.json`), body);
  req('r1', { kind: 'add_job', text: 'https://job-boards.greenhouse.io/glossier/jobs/9?utm_source=li', at: '2026-10-11T01:00:00Z' });
  req('r2', { kind: 'add_job', text: 'https://job-boards.greenhouse.io/glossier/jobs/2', at: '2026-10-11T01:01:00Z' });
  req('r3', { kind: 'add_job', text: 'https://new.example.com/jobs/1', applied: true, at: '2026-10-11T01:02:00Z' });
  req('r4', { kind: 'add_job', text: 'Director of Operations at Acme. ' + 'Lots of text. '.repeat(30), at: '2026-10-11T01:03:00Z' });
  req('r5', { kind: 'block_company', company: 'Evil | Corp\nInc', reason: 'x', at: '2026-10-11T01:04:00Z' });
  req('r6', { kind: 'switch_group', group: 'search', on: false, at: '2026-10-11T02:00:00Z' });
  req('r7', { kind: 'make_coffee', at: '2026-10-11T01:05:00Z' });
  req('r8', { kind: 'apply_suggestion', week: '../../x', sid: 'y', at: '2026-10-11T01:06:00Z' });
  write(path.join(dump, 'requests', '..%2Fbad.json'), { kind: 'add_job', text: 'https://x.com' });
  write(path.join(dump, 'source_switches', 'co-nowhere-co.json'), { on: true, at: '2026-10-11T01:30:00Z' });   // older than the group switch: group wins
  write(path.join(dump, 'source_switches', 'gmail.json'), { on: false, at: '2026-10-11T01:31:00Z' });
  const out = json(d, 'page-sync.mjs', 'pull', dump);
  assert.equal(out.decisions, 1);
  assert.equal(Object.getPrototypeOf(JSON.parse(read(path.join(d, 'data', 'page', 'decisions.json')))), Object.prototype);
  const done = id => JSON.parse(read(path.join(d, 'data', 'page', 'done', `${id}.json`)));
  // r1: already saved and scored by the scan: taken over under r1, score copied, old one hidden on the page
  assert.equal(done('r1').replaces, 'known1');
  assert.equal(JSON.parse(read(path.join(d, 'data', 'scores', 'r1.json'))).verdict.id, 'r1');
  assert.match(read(path.join(d, 'jds', 'r1.md')), /added: true/);
  // r2: on the Pending list already: a new line on top carries r2, the old line is left alone and loses to it
  const pend = parsePending(read(path.join(d, 'data', 'pipeline.md')));
  assert.equal(pend.find(p => p.url.endsWith('/jobs/2')).id, 'r2');
  assert.equal(pend.filter(p => p.url.endsWith('/jobs/2')).length, 2);
  // r3: new link queued, flagged as missed by the scan
  assert.ok(out.jobs_queued.find(j => j.id === 'r3').missed_by_scan);
  assert.match(read(path.join(d, 'data', 'pipeline.md')), /new\.example\.com\/jobs\/1 \| Added job \| Added job \| \| id: r3/);
  // r4: pasted text saved for scoring today
  assert.match(read(path.join(d, 'jds', 'r4.md')), /Director of Operations at Acme/);
  // r5: one table row, no injected cells
  assert.match(read(path.join(d, 'data', 'blacklist.md')), /^\| Evil Corp Inc \| 2026-10-11 \| company \| x \|$/m);
  assert.equal(read(path.join(d, 'data', 'blacklist.md')).split('\n').filter(l => /Evil/.test(l)).length, 1);
  // r6 after the single switch: Nowhere Co (no readable board) ends up off; Glossier (readable) untouched
  const portals = read(path.join(d, 'portals.yml'));
  assert.match(portals, /^# header kept/);
  assert.match(portals, /name: Nowhere Co\n\s+careers_url: \S+\n\s+enabled: false/);
  assert.match(read(path.join(d, 'config', 'desk.yml')), /^gmail_alerts: false\s+# step 8$/m);
  assert.match(done('r7').result, /isn't one/);
  assert.match(done('r8').result, /Couldn't apply/);
  assert.ok(!fs.existsSync(path.join(d, 'data', 'page', 'done', '..%2Fbad.json')));
  // A dump without a decisions folder leaves the saved decisions alone
  fs.rmSync(path.join(dump, 'decisions'), { recursive: true });
  json(d, 'page-sync.mjs', 'pull', dump);
  assert.ok(read(path.join(d, 'data', 'page', 'decisions.json')).includes('p1'));
});

test('run mode: a recent Run now or Update now click picks the mode once; anything else is the normal run', async () => {
  const { runMode } = await import('../page-sync.mjs');
  const now = Date.parse('2026-10-12T11:30:00Z'), ago = m => new Date(now - m * 60000).toISOString();
  assert.equal(runMode({ at: ago(2), kind: 'quick' }, null, now), 'quick');
  assert.equal(runMode({ at: ago(2) }, ago(600), now), 'quick');
  assert.equal(runMode({ at: ago(2), kind: 'update' }, ago(600), now), 'update');
  assert.equal(runMode({ at: ago(2), kind: 'quick' }, ago(1), now), 'normal');
  assert.equal(runMode({ at: ago(30), kind: 'quick' }, null, now), 'normal');
  assert.equal(runMode({ at: ago(2), kind: 'delete everything' }, null, now), 'normal');
  assert.equal(runMode({ at: ago(2), kind: 'quick', failed: true }, null, now), 'normal');
  assert.equal(runMode(null, null, now), 'normal');
});

test('push and ack: batches, --no-run, problems, nothing sent twice', () => {
  const d = profile();
  jd(d, 'q1', { url: 'https://job-boards.greenhouse.io/glossier/jobs/3', company: 'Glossier', title: 'VP Ops', found: '2026-10-10', jd: 'saved' });
  write(path.join(d, 'data', 'scores', 'q1.json'), { verdict: { id: 'q1', status: 'qualified', score: 4.4, threshold: 4, ratings: [], dealbreakers: [], checks: [] }, facts: { base_top: 200000 }, company: 'Glossier', scored_at: new Date().toISOString(), injection: 'x' });
  write(path.join(d, 'probs.txt'), 'A thing broke.|Do this.|detail one\nA thing broke.|Do this.|detail two\n');
  let out = json(d, 'page-sync.mjs', 'push', '--problems-file', path.join(d, 'probs.txt'));
  assert.equal(out.problems.filter(p => p === 'A thing broke.').length, 1);
  const batch = JSON.parse(read(out.batches[0]));
  const posting = JSON.parse(read(batch.writes.find(w => w.collection === 'postings').file_path));
  assert.ok(posting.warning);
  assert.ok(batch.writes.some(w => w.collection === 'runs'));
  sh(d, 'page-sync.mjs', 'ack', out.batches[0]);
  out = json(d, 'page-sync.mjs', 'push', '--no-run');
  assert.equal(out.writes, 0);
  assert.throws(() => sh(d, 'page-sync.mjs', 'ack', path.join(d, 'probs.txt')), /outbox/);
  // A quick run (Run now) carries the task id and the quick flag; a malformed task id is left out
  fs.appendFileSync(path.join(d, 'config', 'desk.yml'), '\ntask_id: trig_01AbC\ndeep_cap: 2\n');
  out = json(d, 'page-sync.mjs', 'push', '--quick');
  let run = JSON.parse(read(JSON.parse(read(out.batches[0])).writes.find(w => w.collection === 'runs').file_path));
  assert.deepEqual([run.task_id, run.quick, run.deep_cap], ['trig_01AbC', true, 2]);
  fs.writeFileSync(path.join(d, 'config', 'desk.yml'), read(path.join(d, 'config', 'desk.yml')).replace('trig_01AbC', 'bad id'));
  out = json(d, 'page-sync.mjs', 'push');
  run = JSON.parse(read(JSON.parse(read(out.batches[0])).writes.find(w => w.collection === 'runs').file_path));
  assert.deepEqual([run.task_id, run.quick, run.update], [null, false, null]);
  // A newer template version from `update.mjs check` shows on the page; the same or an older one doesn't
  const chk = (latest, current) => { write(path.join(d, 'upd.json'), { current, latest, changelog: [{ version: latest, text: '- Run now button.\n- Faster pages.' }], needs_erik: [] }); out = json(d, 'page-sync.mjs', 'push', '--update-file', path.join(d, 'upd.json')); return JSON.parse(read(JSON.parse(read(out.batches[0])).writes.find(w => w.collection === 'runs').file_path)).update; };
  assert.deepEqual(chk('0.8.0', '0.7.0'), { to: '0.8.0', notes: ['Run now button.', 'Faster pages.'], needs_erik: false });
  assert.equal(chk('0.7.0', '0.7.0'), null);
  assert.equal(chk('0.6.9', '0.7.0'), null);
});

test('relink: the employer link takes over the posting id; login-only added links are unscorable', () => {
  const d = profile();
  write(path.join(d, 'a.json'), [{ url: 'https://www.linkedin.com/jobs/view/4001234567', title: 'Head of Operations', company: 'Acme', location: 'Remote', source: 'LinkedIn alert' }]);
  sh(d, 'daily.mjs', 'alerts', path.join(d, 'a.json'));
  const out = json(d, 'daily.mjs', 'relink', 'https://www.linkedin.com/jobs/view/4001234567', 'https://job-boards.greenhouse.io/acme/jobs/77?utm_source=x');
  assert.equal(out.id, postingId('https://www.linkedin.com/jobs/view/4001234567'));
  const pend = parsePending(read(path.join(d, 'data', 'pipeline.md')));
  assert.equal(pend[0].url, 'https://job-boards.greenhouse.io/acme/jobs/77');
  assert.deepEqual([pend[0].id, pend[0].company, pend[0].source], [out.id, 'Acme', 'LinkedIn alert']);
  jd(d, 'rx', { url: 'https://www.linkedin.com/jobs/view/4005555555', company: 'Added job', title: 'Added job', found: new Date().toISOString().slice(0, 10), jd: 'missing', added: true }, '');
  const t = json(d, 'daily.mjs', 'todo');
  assert.equal(t.to_score.length, 0);
  assert.equal(JSON.parse(read(path.join(d, 'data', 'scores', 'rx.json'))).verdict.status, 'unscorable');
});

test('block list: websites block by address, unblock removes them', async () => {
  const { addToBlacklist, removeFromBlacklist, loadBlocklist, blockedBy, websiteOf } = await import('../lib/blocklist.mjs');
  const d = profile();
  assert.equal(websiteOf('https://www.Jobright.ai/jobs/1'), 'jobright.ai');
  assert.equal(websiteOf('Acme Corp'), null);
  assert.equal(addToBlacklist(d, 'jobright.ai', 'x', '2026-10-11', 'domain'), true);
  assert.equal(addToBlacklist(d, 'jobright.ai', 'x', '2026-10-11', 'domain'), false);
  const lists = loadBlocklist(d);
  assert.ok(blockedBy(lists, 'Anyone', 'https://app.jobright.ai/jobs/9'));
  assert.equal(blockedBy(lists, 'Anyone', 'https://notjobright.ai/x'), null);
  assert.equal(removeFromBlacklist(d, 'jobright.ai'), true);
  assert.equal(blockedBy(loadBlocklist(d), 'Anyone', 'https://app.jobright.ai/jobs/9'), null);
});
