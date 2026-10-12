# Page database contract

The Job Search Desk page is one Claude artifact with four tabs (Triage, Resumes, Scan sources, Stats). Its database is the tracker. Two writers share it and never write the same document:

- **Page** (the user's clicks): `decisions`, `requests`, `source_switches`, `prefs`. Claude in an interactive session may also create a `requests` document (a job she pasted in chat), for a job she already applied to the matching `decisions/<same id>` document, and set `prefs/run_now` ("run my desk now"), all exactly as the page would.
- **Daily task** (cloud Claude, through `desk/page-sync.mjs` and the ArtifactData tool): everything else.

Task writes are creates only, so the task never needs a document version (ArtifactData refuses an unpinned write to an existing document). A changed score is a new `rescores` document, never an edit of `postings`. A resume is created once; changing one is the resume update step in desk/CLAUDE-DESK.md (read the document, then `update` pinned to its version).

## Task-written collections

| Path | When | Body |
|---|---|---|
| `postings/<id>` | once, when a posting is scored and reaches the bar (dream companies reach it at any score unless a deal-breaker hits), or was added by the user | `id, company, title, url, location, pay, source, found, posted, dream, score, threshold, status_hint (qualified, below_bar, dealbreaker, unscorable), ratings[{id,name,bucket,score,why}], checks[], suggested_resume, jd (saved, missing, gone), added_by_user, warning` |
| `rescores/<id>~<YYYYMMDDHHMMSS>` | when a posting already on the page is scored again (rubric change, dream company added) | `posting_id, at, score, status_hint, threshold, dealbreakers[], ratings[], checks[], jd?` (`jd: saved` once a pasted description replaced a title-only score); the page uses the newest per posting |
| `deep/<id>` | once, after a deep evaluation | `at, model, recommendation, resume{id, fits, note}, tailor_why, sections[[label, text]]` |
| `requests_done/<request id>` | once, when the task handled a page request | `at, result, posting_id?, replaces?` (`replaces`: the posting id an added job took over, which the page then hides) |
| `suggestions/<YYYY-Www>` | Sundays, when there is something to suggest | `week, at, items[{id, title, why, change}]` |
| `runs/<run id>` | every daily run (id = `YYYY-MM-DDTHHMM`) | `at, ok, problems[{what, fix, detail?, since}], last_good_run, version, plan, daily_cap, deep_cap, help_email, task_id (the daily task the Run now button starts), quick (a Run now run), update{to, notes[], needs_erik} (a newer version of the tool exists; null when none), scoring{threshold, dims[{id,name,bucket}]}, funnel{since, open_today, passed_filters, scored, qualified}, today{scored, qualified}` |
| `sources/<YYYY-MM-DD>-<hash>` | when the source list, its 30-day counts or the block list change | `at, switches_as_of (when the run read her switches; the page treats older switches as applied; absent in older documents, where at stands in), rows[{id, group (mail, dream, boards, search), name, desc, how, on, cost, found, qual, app}], gaps[{id, company, url, ats, note}], blocked[{company, since, reason, system, website}]` |
| `resumes/<id>` | once, when a resume is approved | `name, kind (master, default, tailored), for_posting, updated, asset_id, text` |

## Page-written collections

| Path | Body |
|---|---|
| `decisions/<posting id>` | `status (new, interested, applied, screen, hm, offer, accepted, skipped, rejected, withdrew; a declined offer is withdrew with lost_at offer), prev, reasons[], sent (resume id or "other"), outside, dates{interested, applied, screen, hm, offer, closed}, lost_at, at` |
| `requests/<request id>` | `kind`, `at`, and per kind: `add_job {text, applied}` · `add_description {posting, text}` (she pasted the description of a job scored from its title only; the next run saves it and rescores the job) · `add_source {text, dream, gap?}` · `dismiss_gap {gap}` · `block_company {company, reason, website?}` (website: `company` is a site address like jobright.ai; blocks every posting hosted there) · `unblock_company {company}` · `set_board {source, company, url}` · `switch_group {group: "search", on}` · `apply_suggestion` and `decline_suggestion {week, sid}` |
| `source_switches/<source id>` | `on, at` (`gmail`, or `co-<company slug>`) |
| `prefs/tour` | `done, at`: she finished or skipped the first-visit tour. Absent: the page starts the tour on her first visit. |
| `prefs/run_now` | `at, kind (quick), failed?`: she clicked Run now. Saved before the run starts; the run reads it in step 2 to pick its mode (within 20 minutes, and only by the first run that reads it). The buttons show "Running" until a newer `runs` document arrives (45 minutes at most). |

Request ids, posting ids and source ids are letters, digits, `_`, `-`, at most 64. A rescore id is the posting id plus `~` and a 14-digit timestamp (the database allows 200 characters per segment). The task ignores documents with any other id.

## Derived on the page, never stored

- **Tour sample data:** the first-visit tour shows built-in sample jobs, resumes, sources and stats in place of her data. Nothing from it is ever written; clicks during the tour change only the sample. Finishing or skipping writes `prefs/tour`, which is also her first write (the one-time permission question).

- **No response:** an application with no later stage 21 days after its applied date, or 14 days after the last interview stage, shows as Closed / No response, ended at that stage. A later click moves it back.
- **Switches:** a group switch and a single source switch apply in click order, newest wins; the task does the same.
- **Stats:** computed from `postings`, `rescores`, `decisions` and the latest `runs` document.

## Limits

25,000 documents per page and 256 KiB per document. Only postings that reach the bar are stored; everything scored is counted in `runs`. Every collection counts: at about 20 stored postings a day, one decision per posting she acts on, one run and one source list a day, a six-month search uses roughly 7,000 to 8,000 documents. `rescores` is the collection that grows on top of that: one document per open posting whose score or status changed, each time scoring or the dream list changes. The page reads all of `postings`, `decisions` and `rescores` on every open, so keep them in the low thousands.
