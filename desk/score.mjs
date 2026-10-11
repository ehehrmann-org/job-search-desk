#!/usr/bin/env node
/**
 * score.mjs: score extracted postings against config/scoring.yml.
 *
 *   node desk/score.mjs extraction.json      one object or an array; or pipe JSON on stdin
 *   node desk/score.mjs --brief              print the extraction brief the daily task uses
 *   node desk/score.mjs --check              validate scoring.yml and exit
 *   add --record to save each verdict to data/scores/<id>.json for the page
 *
 * Reads config from $CAREER_OPS_DATA_DIR/config/scoring.yml and dream companies
 * from $CAREER_OPS_DATA_DIR/portals.yml (tracked_companies entries with dream: true).
 * An extraction may carry jd_text, or jd_file (a path under the data folder) so
 * every quote is checked against the saved posting.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { loadScoringConfig, scorePosting, buildExtractionBrief, loadDreamCompanies, isDream, cleanFacts } from './lib/scoring.mjs';
import { readFrontMatter } from './lib/frontmatter.mjs';
import { DATA, safeId } from './lib/env.mjs';

const CONFIG = path.join(DATA, 'config', 'scoring.yml');
const args = process.argv.slice(2);

let cfg;
try { cfg = loadScoringConfig(CONFIG); }
catch (e) { console.error(e.message); process.exit(2); }

if (args.includes('--check')) {
  console.log(`scoring.yml OK: ${cfg.dimensions.length} dimensions, threshold ${cfg.threshold}`);
  process.exit(0);
}
if (args.includes('--brief')) {
  let resumes = [];
  try { resumes = (yaml.load(fs.readFileSync(path.join(DATA, 'resumes', 'index.yml'), 'utf8')) || {}).resumes || []; } catch {}
  console.log(buildExtractionBrief(cfg, resumes.filter(r => r && r.kind !== 'master')));
  process.exit(0);
}

const file = args.find(a => !a.startsWith('--'));
const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const input = JSON.parse(raw);
const dreams = loadDreamCompanies(path.join(DATA, 'portals.yml'));

const results = (Array.isArray(input) ? input : [input]).map(x => {
  let jdText = x.jd_text;
  if (jdText == null && x.jd_file) {
    const p = path.resolve(DATA, x.jd_file);
    if (p.startsWith(DATA + path.sep) && fs.existsSync(p)) {
      const { meta, body } = readFrontMatter(p);
      jdText = meta.jd === 'missing' || !body.trim() ? null : body;
    }
  }
  return scorePosting(x, cfg, { dream: isDream(x.company, dreams), jdText });
});

// --record: keep each verdict in data/scores/<id>.json for page-sync (one file per posting, so
// concurrent runs never conflict in git). The extraction's facts ride along for the pay label.
if (args.includes('--record')) {
  const dir = path.join(DATA, 'data', 'scores');
  fs.mkdirSync(dir, { recursive: true });
  const list = Array.isArray(input) ? input : [input];
  results.forEach((r, i) => {
    const x = list[i];
    if (!safeId(r.id)) { console.error(`not recorded: posting has no usable id (${r.company} / ${r.title})`); return; }
    fs.writeFileSync(path.join(dir, `${r.id}.json`), JSON.stringify({
      verdict: r, facts: cleanFacts(x.facts), company: x.company || null, title: x.title || null,
      suggested_resume: x.suggested_resume || null, scored_at: new Date().toISOString(),
    }, null, 2) + '\n');
  });
}

console.log(JSON.stringify(Array.isArray(input) ? results : results[0], null, 2));
