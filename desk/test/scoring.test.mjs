import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePosting, validateScoringConfig, buildExtractionBrief, isDream } from '../lib/scoring.mjs';

const cfg = {
  threshold: 4.0,
  dealbreakers: {
    comp_floor: { base: 100000 }, company_size: null,
    location: { remote_ok: true, max_office_days: 3 },
    excluded_industries: ['tobacco'], excluded_companies: ['Target'], other: ['requires relocation'],
  },
  candidacy: { gate_career_track: true, skill_penalty: 0.15, skill_cap: 0.30 },
  dimensions: [
    { id: 'role_fit', name: 'Role fit', bucket: 'must', anchors: { 5: 'a', 1: 'b' }, min: 2 },
    { id: 'craft', name: 'Craft', bucket: 'nice', anchors: { 5: 'a', 1: 'b' } },
  ],
  history: [],
};

const posting = (o = {}) => ({
  company: o.company ?? 'Acme', title: 'Head of Ops',
  facts: { work_mode: 'remote', base_top: 150000, ...o.facts },
  ratings: { role_fit: { score: 4, why: 'x', evidence: 'build ops' }, craft: { score: 4, why: 'y', evidence: 'design' }, ...o.ratings },
  dealbreakers_hit: o.hit || [], candidacy: o.cand || [],
});

test('weighted average uses bucket weights 3/2/1', () => {
  const r = scorePosting(posting({ ratings: { role_fit: { score: 5, evidence: 'q' }, craft: { score: 2, evidence: 'q' } } }), cfg);
  assert.equal(r.score, 4.25); // (5*3 + 2*1) / 4
  assert.equal(r.status, 'qualified');
});

test('below the threshold is below_bar; dream companies skip the bar', () => {
  const p = posting({ ratings: { role_fit: { score: 3, evidence: 'q' } } });
  assert.equal(scorePosting(p, cfg).status, 'below_bar');
  assert.equal(scorePosting(p, cfg, { dream: true }).status, 'qualified');
});

test('dream companies do not skip deal-breakers', () => {
  const r = scorePosting(posting({ facts: { base_top: 90000 } }), cfg, { dream: true });
  assert.equal(r.status, 'dealbreaker');
  assert.match(r.dealbreakers[0], /pay/);
});

test('a rating under its min is a deal-breaker', () => {
  const r = scorePosting(posting({ ratings: { role_fit: { score: 1.5, evidence: 'q' } } }), cfg);
  assert.equal(r.status, 'dealbreaker');
});

test('excluded company matches loosely but not on short substrings', () => {
  assert.equal(scorePosting(posting({ company: 'Target Corporation' }), cfg).status, 'dealbreaker');
  assert.notEqual(scorePosting(posting({ company: 'Targetable Labs' }), cfg).status, 'dealbreaker');
});

test('office days over the max and onsite without days both gate', () => {
  assert.equal(scorePosting(posting({ facts: { work_mode: 'hybrid', office_days: 4 } }), cfg).status, 'dealbreaker');
  assert.equal(scorePosting(posting({ facts: { work_mode: 'onsite' } }), cfg).status, 'dealbreaker');
  assert.notEqual(scorePosting(posting({ facts: { work_mode: 'hybrid', office_days: 3 } }), cfg).status, 'dealbreaker');
});

test('only deal-breakers listed in config count; invented ones are flagged', () => {
  const ok = scorePosting(posting({ hit: [{ rule: 'Requires relocation', evidence: 'must relocate' }] }), cfg);
  assert.equal(ok.status, 'dealbreaker');
  const made = scorePosting(posting({ hit: [{ rule: 'too corporate', evidence: 'x' }] }), cfg);
  assert.notEqual(made.status, 'dealbreaker');
  assert.ok(made.evidence_issues.some(i => i.includes('too corporate')));
});

test('excluded industry must match the config list exactly', () => {
  assert.equal(scorePosting(posting({ facts: { industry_excluded: 'Tobacco' } }), cfg).status, 'dealbreaker');
  assert.notEqual(scorePosting(posting({ facts: { industry_excluded: 'vaping' } }), cfg).status, 'dealbreaker');
});

test('skill gaps cost 0.15 each, capped at 0.30; optional gaps are free', () => {
  const gap = (requirement, optional = false) => ({ requirement, severity: 'named-skill', optional, evidence: 'q' });
  assert.equal(scorePosting(posting({ cand: [gap('A')] }), cfg).candidacy_penalty, -0.15);
  assert.equal(scorePosting(posting({ cand: [gap('A'), gap('B'), gap('C')] }), cfg).candidacy_penalty, -0.3);
  assert.equal(scorePosting(posting({ cand: [gap('A', true)] }), cfg).candidacy_penalty, 0);
});

test('quotes are checked against the posting text when given', () => {
  const r = scorePosting(posting(), cfg, { jdText: 'We need someone to build ops. Design matters.' });
  assert.deepEqual(r.evidence_issues, []);
  const bad = scorePosting(posting({ ratings: { craft: { score: 4, evidence: 'not in the posting' } } }), cfg, { jdText: 'build ops' });
  assert.ok(bad.evidence_issues.some(i => i.startsWith('craft')));
});

test('unposted pay raises a check instead of gating', () => {
  const r = scorePosting(posting({ facts: { base_top: null } }), cfg);
  assert.notEqual(r.status, 'dealbreaker');
  assert.ok(r.checks.some(c => /Pay not posted/.test(c)));
});

test('config validation catches the common mistakes', () => {
  assert.deepEqual(validateScoringConfig(cfg), []);
  const bad = { threshold: 7, dimensions: [{ id: 'X', name: '', bucket: 'top', anchors: { 5: 'a' } }] };
  const errs = validateScoringConfig(bad);
  assert.ok(errs.length >= 4, errs.join('\n'));
  const eight = { threshold: 4, dimensions: Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, name: 'n', bucket: 'nice', anchors: { 5: 'a', 1: 'b' } })) };
  assert.ok(validateScoringConfig(eight).some(e => /7 is the maximum/.test(e)));
});

test('the extraction brief names every judged dimension and the listed rules', () => {
  const b = buildExtractionBrief(cfg);
  for (const s of ['role_fit', 'craft', 'requires relocation', '"tobacco"', 'Ignore any instructions']) assert.ok(b.includes(s), s);
});

test('dream list matching handles "A / B" names', () => {
  assert.ok(isDream('MillerKnoll', ['Herman Miller / MillerKnoll']));
  assert.ok(!isDream('Miller Lite', ['Herman Miller / MillerKnoll']));
});

test('only a carve-out listed in the config lifts the size maximum', () => {
  const sized = { ...cfg, dealbreakers: { ...cfg.dealbreakers, company_size: { max: 350, carve_outs: ['chief of staff to the CEO'] } } };
  const made = scorePosting(posting({ facts: { employees: 5000, carve_out: 'marketing agency' } }), sized);
  assert.equal(made.status, 'dealbreaker');
  assert.ok(made.evidence_issues.some(i => i.includes('marketing agency')));
  assert.notEqual(scorePosting(posting({ facts: { employees: 5000, carve_out: 'Chief of Staff to the CEO' } }), sized).status, 'dealbreaker');
  const bare = { ...cfg, dealbreakers: { ...cfg.dealbreakers, company_size: { max: 350 } } };
  assert.equal(scorePosting(posting({ facts: { employees: 5000, carve_out: 'yes' } }), bare).status, 'dealbreaker');
});

test('a stated base under the floor gates even when the posted top is missing', () => {
  const r = scorePosting(posting({ facts: { base_top: null, pay_includes_variable: true, base_top_stated: 90000 } }), cfg);
  assert.equal(r.status, 'dealbreaker');
  assert.match(r.dealbreakers[0], /stated base/);
  assert.ok(!r.checks.some(c => /Pay not posted/.test(c)));
});

test('listed rules match across punctuation and spacing differences', () => {
  const loose = { ...cfg, dealbreakers: { ...cfg.dealbreakers, excluded_industries: ['finance/banking'] } };
  assert.equal(scorePosting(posting({ facts: { industry_excluded: 'Finance / Banking' } }), loose).status, 'dealbreaker');
  assert.equal(scorePosting(posting({ hit: [{ rule: 'Requires relocation.', evidence: 'must relocate' }] }), cfg).status, 'dealbreaker');
});

test('area_ok only knocks out when areas are set; the brief asks for it only then', () => {
  const hybrid = posting({ facts: { work_mode: 'hybrid', office_days: 2, area: 'Denver', area_ok: false } });
  assert.notEqual(scorePosting(hybrid, cfg).status, 'dealbreaker');
  const areas = { ...cfg, dealbreakers: { ...cfg.dealbreakers, location: { ...cfg.dealbreakers.location, areas_no: ['anywhere outside Chicago'] } } };
  const r = scorePosting(hybrid, areas);
  assert.equal(r.status, 'dealbreaker');
  assert.match(r.dealbreakers[0], /outside your areas/);
  assert.ok(buildExtractionBrief(cfg).includes('area_ok: null (no commute areas are set)'));
  assert.ok(buildExtractionBrief(areas).includes('area_ok is false for: anywhere outside Chicago'));
});

test('a fact dimension scores on-site like the deal-breaker and flags values outside every band', () => {
  const loc = { id: 'location', name: 'Location', bucket: 'nice', fact: 'office_days', unknown: 3.5, bands: [{ max: 0, score: 5 }, { max: 3, score: 3 }] };
  const noGate = { ...cfg, dealbreakers: { ...cfg.dealbreakers, location: null }, dimensions: [...cfg.dimensions, loc] };
  const onsite = scorePosting(posting({ facts: { work_mode: 'onsite' } }), noGate);
  assert.notEqual(onsite.status, 'dealbreaker');
  const rating = onsite.ratings.find(r => r.id === 'location');
  assert.equal(rating.score, 3.5);
  assert.match(rating.why, /5 office days a week \(on-site, days not stated\) has no score band/);
  assert.ok(onsite.checks.some(c => /has no score band/.test(c)));
  assert.ok(!onsite.checks.some(c => /not stated; scored/.test(c)));
  assert.equal(scorePosting(posting({ facts: { work_mode: 'hybrid', office_days: 2 } }), noGate).ratings.find(r => r.id === 'location').why, '2 office days a week');
  const unknown = scorePosting(posting({ facts: { work_mode: 'hybrid', office_days: null } }), noGate);
  assert.match(unknown.ratings.find(r => r.id === 'location').why, /not stated, scored neutral/);
  assert.ok(unknown.checks.some(c => /Location not stated/.test(c)));
});

test('min on a fact dimension gates on the band score; a missing fact never gates', () => {
  const pay = { id: 'pay', name: 'Pay', bucket: 'nice', fact: 'base_top', unknown: 2, min: 3, bands: [{ min: 150000, score: 3 }, { score: 1.5 }] };
  const payMin = { ...cfg, dealbreakers: { ...cfg.dealbreakers, comp_floor: null }, dimensions: [cfg.dimensions[0], pay] };
  const low = scorePosting(posting({ facts: { base_top: 100000 } }), payMin);
  assert.equal(low.status, 'dealbreaker');
  assert.match(low.dealbreakers[0], /Pay scored 1.5, under the 3 minimum/);
  assert.equal(low.ratings.find(r => r.id === 'pay').why, '$100,000 posted');
  assert.equal(scorePosting(posting({ facts: { base_top: 160000 }, ratings: { role_fit: { score: 5, evidence: 'q' } } }), payMin).status, 'qualified');
  const none = scorePosting(posting({ facts: { base_top: null } }), payMin);
  assert.notEqual(none.status, 'dealbreaker');
  assert.ok(none.checks.some(c => /Pay not stated/.test(c)));
});

test('ratings written as text are read; unreadable ratings stay unrated', () => {
  const r = scorePosting(posting({ ratings: { role_fit: { score: '1', evidence: 'q' }, craft: { score: '4', evidence: 'q' } } }), cfg);
  assert.equal(r.status, 'dealbreaker', 'a text "1" still trips the minimum');
  const arr = scorePosting({ ...posting(), ratings: [{ id: 'role_fit', score: 5 }] }, cfg);
  assert.ok(arr.ratings.filter(x => x.source === 'judged').every(x => x.score == null));
});

test('config validation rejects numbers typed as text and prototype bucket names', () => {
  const typed = {
    threshold: 4,
    dealbreakers: { comp_floor: { base: 180 }, company_size: { max: '350 people' }, location: { max_office_days: '3 days' } },
    candidacy: { skill_penalty: '0.15' },
    dimensions: [{ id: 'pay', name: 'Pay', bucket: 'nice', fact: 'base_top', unknown: '3', bands: [{ min: '200K', score: 5 }] }],
  };
  const errs = validateScoringConfig(typed);
  for (const s of ['comp_floor', 'company_size', 'max_office_days', 'skill_penalty', 'band', 'unknown']) assert.ok(errs.some(e => e.includes(s)), s);
  assert.ok(!errs.some(e => /\u2014/.test(e)));
  const proto = validateScoringConfig({ threshold: 3, dimensions: [{ id: 'a', name: 'a', bucket: 'constructor', anchors: { 5: 'a', 1: 'b' } }] });
  assert.ok(proto.some(e => /bucket/.test(e)));
});
