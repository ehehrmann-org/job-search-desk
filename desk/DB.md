# Page database contract

The Job Search Desk page is one Claude artifact with four tabs (Triage, Resumes, Scan sources, Stats). Its database is the tracker. Two writers share it and never write the same document:

- **Page** (the user's clicks): `decisions`, `requests`, `source_switches`, `prefs`. Claude in an interactive session may also create a `requests` document (a job she pasted in chat), exactly as the page would.
- **Daily task** (cloud Claude, through `desk/page-sync.mjs` and the ArtifactData tool): everything else.

Task writes are creates only, so the task never needs a document version (ArtifactData refuses an unpinned write to an existing document). A changed score is a new `rescores` document, never an edit of `postings`. A resume is created once; changing one is an interactive step that reads the version first.

## Task-written collections

| Path | When | Body |
|---|---|---|
| `postings/<id>` | once, when a posting is scored and reaches the bar (or is a dream company, or was added by the user) | `id, company, title, url, location, pay, source, found, posted, dream, score, threshold, status_hint (qualified, below_bar, dealbreaker, unscorable), ratings[{id,name,bucket,score,why}], checks[], suggested_resume, jd (saved, missing), added_by_user, warning` |
| `rescores/<id>~<YYYYMMDDHHMMSS>` | when a posting already on the page is scored again (rubric change, dream company added) | `posting_id, at, score, status_hint, threshold, dealbreakers[], ratings[], checks[]`; the page uses the newest per posting |
| `deep/<id>` | once, after a deep evaluation | `at, model, recommendation, resume{id, fits, note}, tailor_why, sections[[label, text]]` |
| `requests_done/<request id>` | once, when the task handled a page request | `at, result, posting_id?, replaces?` (`replaces`: the posting id an added job took over, which the page then hides) |
| `suggestions/<YYYY-Www>` | Sundays, when there is something to suggest | `week, at, items[{id, title, why, change}]` |
| `runs/<run id>` | every daily run (id = `YYYY-MM-DDTHHMM`) | `at, ok, problems[{what, fix, detail?, since}], last_good_run, version, plan, daily_cap, deep_cap, help_email, task_id (the daily task the Run now button starts), quick (a Run now run), scoring{threshold, dims[{id,name,bucket}]}, funnel{since, open_today, passed_filters, scored, qualified}, today{scored, qualified}` |
| `sources/<YYYY-MM-DD>-<hash>` | when the source list, its 30-day counts or the block list change | `at, rows[{id, group (mail, dream, boards, search), name, desc, how, on, cost, found, qual, app}], gaps[{id, company, url, ats, note}], blocked[{company, since, reason, system}]` |
| `resumes/<id>` | once, when a resume is approved | `name, kind (master, default, tailored), for_posting, updated, asset_id, text` |

## Page-written collections

| Path | Body |
|---|---|
| `decisions/<posting id>` | `status (new, interested, applied, screen, hm, offer, skipped, rejected, withdrew), prev, reasons[], sent (resume id or "other"), outside, dates{interested, applied, screen, hm, offer, closed}, lost_at, at` |
| `requests/<request id>` | `kind`, `at`, and per kind: `add_job {text, applied}` · `add_source {text, dream, gap?}` · `dismiss_gap {gap}` · `block_company {company, reason, website?}` (website: `company` is a site address like jobright.ai; blocks every posting hosted there) · `unblock_company {company}` · `set_board {source, company, url}` · `switch_group {group: "search", on}` · `apply_suggestion` and `decline_suggestion {week, sid}` |
| `source_switches/<source id>` | `on, at` (`gmail`, or `co-<company slug>`) |
| `prefs/tour` | `done, at`: she finished or skipped the first-visit tour. Absent: the page starts the tour on her first visit. |
| `prefs/run_now` | `at`: she clicked Run now. The button shows "Running" until a newer `runs` document arrives (45 minutes at most). |

Request ids, posting ids and source ids are letters, digits, `_`, `-` (and `~` in rescores), at most 64. The task ignores documents with any other id.

## Derived on the page, never stored

- **Tour sample data:** the first-visit tour shows built-in sample jobs, resumes, sources and stats in place of her data. Nothing from it is ever written; clicks during the tour change only the sample. Finishing or skipping writes `prefs/tour`, which is also her first write (the one-time permission question).

- **No response:** an application with no later stage 21 days after its applied date, or 14 days after the last interview stage, shows as Closed / No response, ended at that stage. A later click moves it back.
- **Switches:** a group switch and a single source switch apply in click order, newest wins; the task does the same.
- **Stats:** computed from `postings`, `rescores`, `decisions` and the latest `runs` document.

## Limits

25,000 documents per page and 256 KiB per document. Only postings that reach the bar are stored; everything scored is counted in `runs`. At about 20 stored postings a day plus one run and one source list, a six-month search uses under 6,000 documents.
