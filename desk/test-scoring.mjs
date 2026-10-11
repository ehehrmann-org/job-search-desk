#!/usr/bin/env node
/**
 * test-scoring.mjs: check the scorer against real decisions.
 *
 *   node desk/test-scoring.mjs
 *
 * Reads $CAREER_OPS_DATA_DIR/config/scoring-cases.yml. Each case is an
 * extraction plus the user's real decision. Setup step 12 (Test the scoring)
 * writes these; later skips and applications can be added the same way.
 *
 *   - name: Snif, Chief of Staff
 *     decision: apply            # apply | skip | unsure
 *     expect:                    # optional, tighter than the decision
 *       status: qualified        # qualified | below_bar | dealbreaker
 *       score_min: 4.0
 *       score_max: 4.6
 *       dealbreaker_contains: pay
 *       penalty: -0.15
 *     input: { ...extraction... }
 *
 * Without expect, apply must come out qualified and skip must not.
 * unsure cases are scored and listed but never fail.
 * Exit code 1 when any case disagrees, so a rubric change that breaks a real
 * decision does not ship.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, scorePosting, loadDreamCompanies, isDream } from './lib/scoring.mjs';
import { DATA } from './lib/env.mjs';

const cfg = loadScoringConfig(path.join(DATA, 'config', 'scoring.yml'));
const casesFile = path.join(DATA, 'config', 'scoring-cases.yml');
if (!fs.existsSync(casesFile)) { console.log('No scoring-cases.yml yet. Setup step 12 creates it.'); process.exit(0); }
const cases = (yaml.load(fs.readFileSync(casesFile, 'utf8')) || []).filter(c => c && c.input && typeof c.input === 'object');
const dreams = loadDreamCompanies(path.join(DATA, 'portals.yml'));

let agree = 0, counted = 0;
for (const c of cases) {
  const r = scorePosting(c.input, cfg, { dream: isDream(c.input.company, dreams) });
  const e = c.expect || {};
  const fails = [];
  if (e.status && r.status !== e.status) fails.push(`status ${r.status}, expected ${e.status}`);
  if (!e.status && c.decision === 'apply' && r.status !== 'qualified') fails.push(`${r.status}, but you applied`);
  if (!e.status && c.decision === 'skip' && r.status === 'qualified') fails.push('qualified, but you skipped');
  if (e.score_min != null && !(r.score >= e.score_min)) fails.push(`score ${r.score} < ${e.score_min}`);
  if (e.score_max != null && !(r.score <= e.score_max)) fails.push(`score ${r.score} > ${e.score_max}`);
  if (e.dealbreaker_contains && !r.dealbreakers.some(d => d.toLowerCase().includes(e.dealbreaker_contains.toLowerCase())))
    fails.push(`no deal-breaker mentioning "${e.dealbreaker_contains}" (got: ${r.dealbreakers.join('; ') || 'none'})`);
  if (e.penalty != null && r.candidacy_penalty !== e.penalty) fails.push(`penalty ${r.candidacy_penalty}, expected ${e.penalty}`);

  const unsure = c.decision === 'unsure';
  if (!unsure) { counted++; if (!fails.length) agree++; }
  const tag = unsure ? 'NOTE' : fails.length ? 'FAIL' : 'PASS';
  const shown = r.status === 'dealbreaker' ? `deal-breaker: ${r.dealbreakers[0]}` : `${r.score} ${r.status}`;
  console.log(`${tag}  ${c.name}  → ${shown}${fails.length ? `\n      ${fails.join('\n      ')}` : ''}`);
}
console.log(`\n${agree} of ${counted} agree with your decisions (threshold ${cfg.threshold}).`);
if (agree < counted) process.exitCode = 1;
