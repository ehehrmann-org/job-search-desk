import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, isoWeek } from '../suggest.mjs';

const cfg = {
  threshold: 3.5,
  dealbreakers: { comp_floor: { base: 150000 }, company_size: { max: 1000 }, location: { max_office_days: 3 }, excluded_industries: [], excluded_companies: [], other: [] },
  candidacy: {}, history: [],
  dimensions: [{ id: 'level', name: 'Level', bucket: 'important', anchors: { 5: 'a', 1: 'b' } }],
};
const rec = (id, score, status, decision, facts = {}, levelScore = 3) => ({
  id, recent: true, facts,
  verdict: { id, score, status, dream: false, ratings: [{ id: 'level', score: levelScore }] },
  decision,
});
const skip = (...reasons) => ({ status: 'skipped', reasons, dates: { closed: '2026-10-10' } });
const applied = { status: 'applied', dates: { applied: '2026-10-10' } };

test('raises the bar halfway between the best skip and the lowest pick', () => {
  const recs = [rec('a', 4.6, 'qualified', applied), rec('b', 4.4, 'qualified', applied),
    ...[3.6, 3.7, 3.8, 3.9, 4.0, 3.6].map((sc, i) => rec('s' + i, sc, 'qualified', skip('Wrong function')))];
  const s = analyze(cfg, recs).find(x => x.id === 'threshold-up');
  assert.ok(s);
  assert.equal(s.patch.value, 4.2); // (4.0 + 4.4) / 2
});

test('no suggestion without 3 decisions behind it', () => {
  const recs = [rec('a', 4.6, 'qualified', applied), rec('s1', 3.6, 'qualified', skip('Pay too low'), { base_top: 140000 })];
  assert.equal(analyze(cfg, recs).length, 0);
});

test('pay floor stays under every job she acted on', () => {
  const recs = [rec('a', 4.6, 'qualified', applied, { base_top: 180000 }),
    ...[150000, 160000, 165000].map((t, i) => rec('p' + i, 3.8, 'qualified', skip('Pay too low'), { base_top: t }))];
  const s = analyze(cfg, recs).find(x => x.id === 'pay-floor');
  assert.equal(s.patch.value.base, 170000);
  const conflict = [rec('a', 4.6, 'qualified', applied, { base_top: 160000 }), ...recs.slice(1)];
  assert.ok(!analyze(cfg, conflict).some(x => x.id === 'pay-floor'));
});

test('a dimension rated high on jobs skipped for that reason moves up a bucket', () => {
  const recs = [1, 2, 3].map(i => rec('l' + i, 3.8, 'qualified', skip('Wrong seniority'), {}, 5));
  const s = analyze(cfg, recs).find(x => x.id === 'bucket-level');
  assert.equal(s.patch.value, 'must');
});

test('iso week', () => {
  assert.equal(isoWeek(new Date('2026-10-11T12:00:00')), '2026-W41');
  assert.equal(isoWeek(new Date('2026-01-01T12:00:00')), '2026-W01');
});
