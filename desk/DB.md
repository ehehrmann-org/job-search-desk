# Page database contract

The Job Search Desk page is one Claude artifact with four tabs (Triage, Resumes, Scan sources, Stats). Its database is the tracker. Two writers share it and never write the same document:

- **Page** (the user's clicks): `decisions`, `requests`, `source_switches`.
- **Daily task** (cloud Claude, through `desk/page-sync.mjs` and the ArtifactData tool): everything else.

Task writes are creates only, so the task never needs a document version (ArtifactData refuses an unpinned write to an existing document). The exceptions are rescoring after a rubric change and resume updates, where the task reads versions first.

## Task-written collections

| Path | When | Body |
|---|---|---|
| `postings/<id>` | once, when a posting is scored and reaches the bar (or is a dream company, or was added by the user) | `id, company, title, url, location, pay, source, found, posted, dream, score, threshold, status_hint, ratings[{id,name,bucket,score,why}], checks[], suggested_resume, jd, added_by_user` |
| `deep/<id>` | once, after a deep evaluation | `at, model, recommendation, resume{id, fits, note}, tailor_why, sections[[label, text]]` |
| `requests_done/<request id>` | once, when the task handled a page request | `at, result, posting_id?` |
| `runs/<run id>` | every run (id = `YYYY-MM-DDTHHMM`) | `at, ok, problems[{what, fix, since}], last_good_run, version, plan, daily_cap, help_email, scoring{threshold, dims[{id,name,bucket}]}, funnel{open_today, passed_filters, scored, qualified, since}, today{new, scored, qualified}` |
| `sources/<snapshot id>` | when the source list, its 30-day counts or the block list change | `at, rows[{id, group, name, desc, how, on, cost, found, qual, app}], gaps[{id, company, url, ats, note}], blocked[{company, since, reason, system}]` |
| `resumes/<id>` | when a resume is approved or changed | `name, kind (master, default, tailored), for_posting, updated, asset_id, text` |

## Page-written collections

| Path | Body |
|---|---|
| `decisions/<posting id>` | `status (new, interested, applied, screen, hm, offer, skipped, rejected, withdrew), prev, reasons[], sent (resume id or "other"), outside, dates{interested, applied, screen, hm, offer, closed}, lost_at, at` |
| `requests/<request id>` | `kind (add_job, add_source, dismiss_gap, block_company, unblock_company, set_board, switch_group), text, company, reason, source, url, group, on, applied, sent, at` |
| `source_switches/<source id>` | `on, at` |

## Derived on the page, never stored

- **No response:** an application with no later stage 21 days after its applied date, or 14 days after the last interview stage, shows as Closed / No response, ended at that stage. A later click moves it back.
- **Stats:** computed from `postings`, `decisions` and the latest `runs` document.

## Limits

25,000 documents per page and 256 KiB per document. Only postings that reach the bar are stored; everything scored is counted in `runs`. At about 20 stored postings a day, a six-month search uses under 5,000 documents.
