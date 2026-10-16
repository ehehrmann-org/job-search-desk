# desk/

Job Search Desk additions on top of upstream career-ops. Upstream files stay untouched so updates merge cleanly.

| File | What it does |
|---|---|
| `lib/scoring.mjs` | Scorer: deal-breakers, bucket-weighted dimensions (3/2/1), threshold, dream companies, candidacy gaps, quote checks, extraction brief |
| `score.mjs` | CLI. `--check` validates `config/scoring.yml`, `--brief` prints the extraction brief for the daily task, otherwise scores extraction JSON |
| `test-scoring.mjs` | Scores `config/scoring-cases.yml` (real decisions) and reports agreement, e.g. "6 of 8" |
| `test/*.test.mjs` | Unit tests: `node --test desk/test/*.test.mjs` |
| `templates/scoring.example.yml` | Starting point for setup step 5 |
| `fetch-pending-jds.mjs` | Runs in the daily scan: saves each pending posting's description to `jds/<id>.md` |
| `probe-boards.mjs` | Runs after it in the daily scan: opens careers pages of companies the scan can't read and records the job board links on them (`data/board-probe.json`); the morning run's `page-sync.mjs pull` moves those companies to Job boards |
| `page-sync.mjs` | `pull` page clicks into the repo, `since` prints the time to read decisions from, `done` records a handled request, `push` new postings and the run status out as ArtifactData batch files, `ack` after a batch is written, `sites` company websites to look up, `resume-doc` one resume's fields for an update |
| `lib/page-docs.mjs` | Builds the page documents (contract in `DB.md`) |
| `lib/sites.mjs` | Company websites for the page (`data/sites.json`): from portals.yml, posting links, and the morning run's lookups, kept only when the address carries the company's name |
| `lib/env.mjs` | Shared paths (`ROOT`, `DATA`), entry-point check, safe ids, strict YAML reads |
| `lib/urls.mjs` | Clean posting links (alert tracking removed) and the "seen before" key |
| `lib/boards.mjs` | Which job board reader the scan would use for a company or link |
| `lib/blocklist.mjs` | Built-in and personal block lists (upstream's `data/blacklist.md` format) |
| `save.sh` | Commit and push to main, retrying when the scan saved at the same time |
| `../.claude/agents/` | `desk-extractor` (sonnet) and `desk-evaluator` (opus): read and write only |
| `page/` | The page: `style.css` + `body.html` + `icons.js` (Phosphor Icons, MIT, phosphoricons.com), assembled by `node desk/page/build.mjs` into `page/dist/job-search-desk.html` |
| `DB.md` | Page database contract: who writes which collection |
| `DAILY-TASK.md`, `daily.mjs` | The daily run's runbook and its deterministic steps |
| `SETUP.md`, `setup.mjs` | The 12-step setup runbook, checkpoints, checklist and step checks |
| `resume.mjs` | Resumes to PDF and plain text in one plain layout; refuses numbers not in the master |
| `CLAUDE-DESK.md` | What the user can say in Claude (start setup, help, change my scoring, tailoring, update career tool) |
| `update.mjs`, `CHANGELOG.md` | "update career tool": brings a friend's copy up to the template, never touching profile/ |
| `export-template.mjs` | Developer only (never shipped): builds the friend template and stops on any personal data |
| `suggest.mjs` | Sunday scoring suggestions from skips and picks; applies approved ones and rescores open jobs (no model calls) |
| `lists/`, `packs/` | Built-in block list of reposting services; ready-made source packs for setup step 7 |

All commands read the profile from `$CAREER_OPS_DATA_DIR` (default and always `profile`). The daily scan (`.github/workflows/daily-scan.yml`) runs at 3:13 and 9:13 UTC; the daily run is a scheduled Claude task at 6:27 AM the user's time.
