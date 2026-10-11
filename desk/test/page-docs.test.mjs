import test from 'node:test';
import assert from 'node:assert/strict';
import { payLabel, sourceName, postingDoc, belongsOnPage, runId, sourcesDoc, slug } from '../lib/page-docs.mjs';
import { parsePending } from '../fetch-pending-jds.mjs';

test('pay label', () => {
  assert.equal(payLabel({ base_bottom: 185000, base_top: 210000 }), '$185K–210K');
  assert.equal(payLabel({ base_top: 175000 }), '$175K');
  assert.equal(payLabel({ base_bottom: 100000, base_top: 180000, pay_includes_variable: true }), '$100K–180K incl. bonus');
  assert.equal(payLabel({}), 'Pay not listed');
});

test('source names', () => {
  assert.equal(sourceName('https://job-boards.greenhouse.io/x/jobs/1'), 'Greenhouse');
  assert.equal(sourceName('https://acme.wd1.myworkdayjobs.com/x'), 'Workday');
  assert.equal(sourceName('https://careers.acme.com/1'), 'careers.acme.com');
  assert.equal(sourceName('https://jobs.lever.co/a', 'Added by you'), 'Added by you');
});

test('posting doc prefers real names over placeholders and keeps only page fields', () => {
  const rec = { verdict: { id: 'r1', status: 'below_bar', score: 3.1, threshold: 4, dream: false, ratings: [{ id: 'a', name: 'A', bucket: 'must', score: 3, why: 'w', weight: 3, source: 'judged' }], checks: [] },
    facts: { base_top: 150000 }, company: 'Acme', title: 'Head of Ops', scored_at: '2026-10-11T10:00:00Z' };
  const jd = { company: 'Added job', title: 'Added job', url: 'https://jobs.lever.co/acme/1', source: 'Added by you', added: true };
  const d = postingDoc(rec, jd);
  assert.equal(d.company, 'Acme'); assert.equal(d.title, 'Head of Ops');
  assert.deepEqual(Object.keys(d.ratings[0]), ['id', 'name', 'bucket', 'score', 'why']);
  assert.ok(d.added_by_user);
  assert.ok(belongsOnPage(rec, jd), 'added jobs show even below the bar');
  assert.ok(!belongsOnPage(rec, {}));
});

test('run ids and source snapshots are stable', () => {
  assert.equal(runId(new Date('2026-10-11T11:27:09Z')), '2026-10-11T1127');
  const a = sourcesDoc([{ id: 'x' }], [], '2026-10-11T11:00:00Z'), b = sourcesDoc([{ id: 'x' }], [], '2026-10-12T11:00:00Z');
  assert.equal(a.hash, b.hash);
  assert.equal(slug('Herman Miller / MillerKnoll'), 'herman-miller-millerknoll');
});

test('pipeline lines carry id and source labels', () => {
  const md = '## Pending\n\n- [ ] https://jobs.lever.co/a/1 | Added job | Added job | | id: rabc | source: Added by you\n- [ ] https://x.io/2 | Acme | COO | Remote | posted: 2026-10-01\n\n## Processed\n- [x] https://y.io/3 | B | C\n';
  const p = parsePending(md);
  assert.equal(p.length, 2);
  assert.equal(p[0].id, 'rabc'); assert.equal(p[0].source, 'Added by you');
  assert.equal(p[1].location, 'Remote'); assert.equal(p[1].posted, '2026-10-01'); assert.equal(p[1].id, '');
});
