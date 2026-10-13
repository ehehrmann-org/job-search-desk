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

test('jobs skipped as Job closed do not raise the bar', () => {
  const recs = [rec('a', 4.6, 'qualified', applied), rec('b', 4.4, 'qualified', applied),
    ...[3.6, 3.7, 3.8, 3.9, 4.0, 3.6].map((sc, i) => rec('s' + i, sc, 'qualified', skip('Job closed')))];
  assert.ok(!analyze(cfg, recs).some(x => x.id === 'threshold-up'));
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

test('size skips only read as too big against a job she went for', () => {
  const noActed = [20, 30, 40].map((n, i) => rec('z' + i, 3.8, 'qualified', skip('Company too big or small'), { employees: n }));
  assert.ok(!analyze(cfg, noActed).some(x => x.id.startsWith('size')));
  const withActed = [rec('a', 4.6, 'qualified', applied, { employees: 200 }),
    ...[300, 400, 500].map((n, i) => rec('z' + i, 3.8, 'qualified', skip('Company too big or small'), { employees: n }))];
  const s = analyze(cfg, withActed).find(x => x.id === 'size-max');
  assert.equal(s.patch.value.max, 299);
});

test('a job she marked interested and then skipped counts as a skip only', () => {
  const flipped = { status: 'skipped', reasons: ['Wrong function'], dates: { interested: '2026-10-01', closed: '2026-10-10' } };
  const recs = [rec('a', 4.6, 'qualified', applied), rec('f', 4.0, 'qualified', flipped),
    ...[3.6, 3.7, 3.8, 3.9, 4.0, 3.6].map((sc, i) => rec('s' + i, sc, 'qualified', skip('Wrong function')))];
  const s = analyze(cfg, recs).find(x => x.id === 'threshold-up');
  assert.ok(s);
  assert.ok(s.why.includes('skipped 7 of the last 8'), s.why);
  assert.ok(s.why.includes('scored 4.6 or higher'), s.why);
});

test('office-day skips only count above the days she accepted', () => {
  const loose = { ...cfg, dealbreakers: { ...cfg.dealbreakers, location: { max_office_days: 5 } } };
  const went = rec('a', 4.6, 'qualified', applied, { office_days: 3 });
  const same = [went, ...[3, 3, 4].map((d, i) => rec('o' + i, 3.8, 'qualified', skip('Location'), { office_days: d }))];
  assert.ok(!analyze(loose, same).some(x => x.id === 'office-days'));
  const more = [went, ...[4, 4, 5].map((d, i) => rec('o' + i, 3.8, 'qualified', skip('Location'), { office_days: d }))];
  const s = analyze(loose, more).find(x => x.id === 'office-days');
  assert.equal(s.patch.value.max_office_days, 3);
  assert.ok(s.why.includes('asked for 3 or fewer'), s.why);
});

test('lowering the bar needs 3 applications under it', () => {
  const two = [rec('b1', 3.0, 'below_bar', applied), rec('b2', 3.1, 'below_bar', applied)];
  assert.ok(!analyze(cfg, two).some(x => x.id === 'threshold-down'));
  const three = [...two, rec('b3', 3.2, 'below_bar', applied)];
  const s = analyze(cfg, three).find(x => x.id === 'threshold-down');
  assert.equal(s.patch.value, 3.0);
});
