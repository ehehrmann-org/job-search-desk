# Setup runbook

You are setting up the Job Search Desk for one person. Read this whole file before saying anything, then follow it step by step. The person is capable but not technical: smart, busy, not a developer.

## How you talk during setup

- **Short.** Each message says what you need from her next and why, in one sentence. Don't explain what you did or how you solved something, don't summarize or recap finished work, no preamble, no pleasantries. Where a step below gives longer wording to say, say its gist in one sentence instead. The checklist (below) is the only progress report.
- **Plain terms only.** Say "your private copy" (never repo or repository), "the daily scan" (never GitHub Actions or workflow), "your job page" (never artifact), "Gmail connection" (never connector), "job boards" (never ATS). Never show file names, commands or code unless she asks.
- **One question at a time.** Use the multiple-choice question tool whenever the answers fit 2 to 4 options; she can always type her own. Accept "not sure" for any preference question and record it (step 4 says where).
- **Never enter a password, never create an account for her, never click Submit on her behalf.** Tell her exactly what to click and wait.
- **Checklist.** Show the progress checklist (`node desk/setup.mjs status`, shown as a plain list, not a code block) at the very start, after every finished step, and when she says "continue setup". Never mid-step.
- **Checkpoints.** A step is finished only when `node desk/setup.mjs done <n>` passes. If it lists problems, fix them with her, then run it again. After each finished step: `bash desk/save.sh "setup: step <n>"`. If it prints `save failed`, say so plainly and offer the message for Erik; the work stays in this session, so try the save again before the session ends.
- **Errors.** When anything fails, say in one or two plain sentences what happened and what happens next, then offer: "Want a message for Erik? I'll write it; you send it." The message: "Hi Erik, setup stopped at step <n> (<title>). What happened: <one line>. Error: <exact text, shortened>. Time: <now>. Tool version: <desk/VERSION>." Nothing about her jobs or profile. Typing "help" anytime gives the same message.
- **Continue setup.** On "continue setup" (or a fresh session): run `npm install --ignore-scripts --no-audit --no-fund` (quietly), then `status`, say where she left off, and start the next unfinished step from its beginning.
- **Short on time.** If she or Erik says the session has about an hour, take the fast path: skip step 5 point 6 (the preview), step 6 point 2 (extra suggestions) and step 8 point 2 (first jobs), and in step 7 propose at most 10 companies. Session 1 then takes about 75 minutes. Everything skipped happens on its own later (the morning run scores the first jobs) or in session 2.
- **Two sessions.** Session 1 (steps 1 to 8, about 95 minutes) ends with her live: her job page exists and the daily run starts the next morning. Session 2 (steps 9 to 12, about an hour, any day) adds job alert emails, achievements, resumes and a scoring check on her real jobs. Step 8 closes session 1.

Working folder: the root of her private copy. Every command runs there with `CAREER_OPS_DATA_DIR=profile`.

---

## Step 1. Your private copy (about 10 minutes, before this session exists)

This step happens in a normal Claude chat, from the start prompt Erik sends (desk/START-PROMPT.md). By the time you read this file, it is done.

## Step 2. Connect Claude to your copy (about 10 minutes)

Also done before this file is readable. First thing in this session:
```bash
npm install --ignore-scripts --no-audit --no-fund
node desk/setup.mjs init
node desk/setup.mjs done 1 && node desk/setup.mjs done 2
```
Then greet her, show the checklist, and start step 3.

## Step 3. Your Claude plan (about 3 minutes)

Ask which Claude plan she has: Pro, Max 5x, Max 20x, Not sure. Write `profile/config/desk.yml`:

| Plan | daily_cap | deep_cap |
|---|---|---|
| Pro | 10 | 1 |
| Max 5x | 25 | 2 |
| Max 20x | 50 | 3 |
| Not sure | 10 | 1 |

Also set `help_email` from `desk/HELP-CONTACT` if that file exists.
For Pro and Not sure, say once: setup is long, so Claude may pause for a usage limit partway through. Nothing is lost; she can come back later and type "continue setup". After the first week the cap can go up if usage allows.

## Step 4. Your profile (about 25 minutes)

**4a. The master resume.** Ask her to attach her latest resume (PDF or Word) and her LinkedIn profile as a PDF (on LinkedIn: her profile, More, Save to PDF). Read both. If she brought performance reviews or promotion announcements, read those too. Write `profile/cv.md`, merging everything into one master that holds every fact, in this shape:
```
# Full Name
**Location:** … | **Email:** … | **LinkedIn:** …
## Summary
## Experience
### Company, City, ST
**Title**
Mon YYYY – Mon YYYY
- bullet
## Education
## Skills
```
Where the two disagree (dates, titles, a role on one but not the other), ask her one conflict at a time. Then read back in 4 to 6 lines what you picked up: roles and years, the through-line, education. Ask if anything is missing.

If her resume is out of date (a recent employer or role is missing) or she has no resume at all, don't stop: build the master from her LinkedIn PDF and whatever else she brought. For each role with no description, ask two questions, one at a time: what she was responsible for, and how big it was (team, budget, volume, clients). Write what she says, in her words, as one or two bullets for that role; never add numbers she didn't give. Step 10 in session 2 fills in the rest. No LinkedIn PDF either: ask for her roles (employer, title, years) one at a time and do the same.

**4b. The interview.** One question at a time, in this order. Record each answer as you go.
1. **Target roles.** Ask what roles she wants next. Propose a title family from her own history: the titles she has held, their synonyms, and one level up (for example Creative Operations, Creative Production, Studio Operations, Creative Technology). She keeps, drops or adds. Write them to `profile.yml` `target_roles.primary` and to `portals.yml` `title_filter.positive` (short phrases a job title would contain).
2. **Best job and worst job.** The one open question: "Think of the best job you've had. What made it the best? And the worst one: what made it the worst?" Write both to `narrative.best_job` and `narrative.worst_job`. This drives step 5.
3. **Level.** Individual contributor, manager, director, VP or head of, C-level. One or two.
4. **Pay.** Her minimum base pay (walk-away) and the number that makes her say yes fast. Write both to `compensation`.
5. **Location.** Home city and time zone; remote, hybrid or office; most office days a week she'd accept; which areas are an easy commute and which are not. Write `profile.yml` `location` (`timezone` as a name like `America/Chicago`; step 8 schedules the daily run with it), and `portals.yml` `location_filter`: `always_allow: [Remote]`, `allow` with her city, nearby cities, her state name and abbreviation, `United States`, `USA`, and `block_hard` with countries she can't work in (default: Canada, Mexico, United Kingdom, UK, India, Philippines, Brazil, Germany, Poland, unless she says otherwise).
6. **Company size.** Smallest and largest she'd consider, or "any".
7. **Industries.** Ones she wants, ones she won't touch.
8. **Other no's.** Anything else that rules a job out (travel over 50%, weekend shifts, a commission-only pay plan). Plain sentences.
9. **Current employer.** Write `desk.yml` `current_employer` ("none" if not employed) and add a row to `profile/data/blacklist.md` (copy the header from `desk/lib/blocklist.mjs` `BLACKLIST_HEADER`) so its jobs never show.

Every "not sure" goes into `profile.yml` `not_sure` as a short label; step 12 settles them.

**4c. Summary.** Show one screen: target roles, level, pay, location, size, industries, no's, current employer. She confirms or corrects. Then `node desk/setup.mjs done 4`.

## Step 5. How jobs get scored (about 15 minutes)

1. **Deal-breakers.** Restate the ones from step 4 as a short list (pay floor, office days and areas, size limits, excluded industries, current employer, other no's). She confirms. Write them to `profile/config/scoring.yml` `dealbreakers` (see `desk/templates/scoring.example.yml` for the shape; `excluded_companies` must include the current employer).
2. **Dimensions.** Propose up to 7 things to rate every posting on, each with one line on why, drawn from her best and worst job and her answers. Seven is a stretch goal; propose fewer rather than pad. Good candidates: role fit (from the best job), level and scope, team and craft, company type, industry, pay, location, company size. Pay, location and company size are computed from facts (`fact: base_top`, `office_days`, `employees` with `bands`); the rest are rated by Claude against anchors.
3. **Buckets.** For each dimension, ask: Must have, Important, Nice to have, or drop it. Must counts 3 times, Important twice, Nice once.
4. **Anchors.** For each rated dimension, draft what a 5, a 3 and a 1 look like in her words. Show them together; she edits in plain words.
5. Write `scoring.yml` with `threshold: 4.0` and a first `history` line (`"<date> step 5: first version, approved"`), then `node desk/score.mjs --check` until it passes.
6. **Preview.** Find 2 live postings that match her titles (web search; prefer pages on the employer's own job board), extract them with `node desk/score.mjs --brief` as the instructions, score them with `node desk/score.mjs <file>`, and show each score with its "why this score" lines. If a line looks wrong to her, fix the anchor now.
7. `node desk/setup.mjs done 5`

## Step 6. Dream companies (about 10 minutes)

1. Ask for the companies she'd most like to work at: names or careers links, any number.
2. Suggest 3 to 5 more like the employers in her best job, each with one line on why. She accepts or declines each.
3. For each accepted company, while she watches: find its careers page and the job board behind it (web search; open the careers page; job links usually point to the board). Check it with `node desk/setup.mjs board <link>`. Readable: add to `portals.yml` `tracked_companies` as `{ name, careers_url: <board link>, website: <its home page, when seen>, enabled: true, dream: true }`. Not readable after a real look: add `{ name, careers_url: <careers page>, enabled: true, dream: true, scan_method: websearch, scan_query: "<name> careers <main title word>" }`, and tell her it gets a weekly web search instead of the daily scan.
4. Close with: "Dream companies are always checked and their jobs always reach you, even below your bar. Your deal-breakers still apply to them."
5. `node desk/setup.mjs done 6`.

## Step 7. Job sources (about 10 minutes)

1. Propose 15 to 30 companies (10 on the fast path) whose jobs she should see daily: employers like the ones she'd want (industry, size, city or remote), found with web search. Offer the ready-made pack in `desk/packs/` that fits her (`agencies.yml` for independent agencies) as one option she can take whole, in part, or skip.
2. Show them as a short list with one line each; she accepts all, picks, or adds sites she already watches.
3. Classify each once: a job board the scan can read (`setup.mjs board`), weekly web search (dream companies only), or alert only (LinkedIn, Indeed and similar: those come in through Gmail alerts in step 9). Add the readable ones to `portals.yml` `tracked_companies` with `enabled: true`.
4. Start the first scan, so her page can show real jobs before this session ends:
   ```bash
   bash desk/save.sh "setup: sources"
   git push -q -f origin HEAD:scan-now
   ```
   It takes a few minutes and runs while you do step 8. If the second command is refused, walk her through starting it by hand instead: her private copy on GitHub, Actions, daily-scan, Run workflow, Run workflow.
5. `node desk/setup.mjs done 7`

## Step 8. Go live (about 15 minutes)

1. **Her job page.** `node desk/page/build.mjs`, then publish `desk/page/dist/job-search-desk.html` with the Artifact tool: icon `briefcase`, capabilities `{"db": {}, "user": {}, "downloads": true, "assets": {}, "mcp": {"servers": [{"server": "Claude Code Remote", "tools": ["fire_trigger"]}]}}` (the last one lets the page's Run now button start her daily run). Save its link to `desk.yml` `page_url`.
2. **First jobs.** `bash desk/save.sh "setup: page"`. If the first scan has finished (`profile/jds/` has postings), score up to 10 now the same way the daily run does (desk/DAILY-TASK.md step 5 points 2 to 6, with `node desk/daily.mjs todo --cap 10`). If it hasn't finished, skip this: the first morning run scores them.
3. **First fill.** `node desk/page-sync.mjs push --no-run`, then for each batch file: ArtifactData `batch` with the file's `writes`, then `node desk/page-sync.mjs ack <file>`. Until the first morning run, the page's status button says the first run hasn't happened yet; that is expected, and the morning run replaces it.
4. **The tour.** Ask her to open the page. It starts a two-minute tour on sample jobs (they are built into the page and never saved); she clicks through and finishes with Finish. That click shows a one-time permission question; she allows it. Confirm with ArtifactData `list` on `prefs` (a `tour` document). If it's missing, she skipped the permission: ask her to open the status button, click "Take the tour again", and allow it at the end. Then set `desk.yml` `page_consent: true`. Offer to pin the page to her sidebar; pin it on a yes.
5. **The daily run.** The daily scan already runs on its own twice a night; nothing to set. Make sure `desk.yml` has `gmail_alerts: false` (step 9 turns it on). Create a cloud scheduled task (a routine, not a local or session task) named "Job Search Desk daily run", every day at 6:27 AM her time (`CRON_TZ=<profile.yml location.timezone> 27 6 * * *`), with the prompt in `desk/TASK-PROMPT.md` filled in with her REPO (`owner/name` of her private copy) and PAGE (the page link). Attach two repositories to it: her private copy, and the template named in `desk/TEMPLATE`. The template is private and a scheduled run can't add a repository by itself, so without it the run can never check for updates. Save its trigger id (it starts with `trig_`; a local or session task has no such id and can't be started from her page) to `desk.yml` `task_id`. The task itself only runs scripts, reads her page and starts the scoring helpers, so it runs on Sonnet: if the tool that creates it asks for a model, pick Sonnet. If it doesn't ask, the task takes this session's model, and point 6 corrects it. The scoring helpers keep their own models (desk/DAILY-TASK.md step 0.3).
6. **Task settings (she does this).** Walk her to the task's settings: remove every connection (Gmail gets added back in step 9), check that automatic approval is on, and check that the model is Sonnet (change it there if it isn't). Wait until she confirms all three.
7. Save, then `node desk/setup.mjs done 8`.
8. **Close the session.** Tell her, briefly:
   - She's live: new jobs arrive every morning around 6:45 on her job page. The tour is always one click away from the status button.
   - The first days will score rough. Every Skip with a reason and every Interested teaches it.
   - Session 2 (about an hour, any day) adds her job alert emails, her achievements, her resumes and a check of the scoring on her real jobs. To come back: open Claude, open a session on her private copy, type "continue setup". The prep list for it is in Erik's message.
   - "Change my scoring", "add a dream company" and "help" work anytime in Claude.

## Step 9. Gmail and job alerts (about 15 minutes)

1. **What the Gmail connection allows.** Say plainly: it lets Claude read her email. The Job Search Desk only searches for job alert emails and reads those; it never sends, replies, deletes or labels anything. Ask whether she wants it. If not: leave `desk.yml` `gmail_alerts: false`, tell her LinkedIn and Indeed jobs then reach her only when she adds them on her page, and go to point 9. She can turn it on later from Scan sources.
2. Ask which Gmail address gets her job alerts. If it is a work address, say no: use a personal one, because the work account belongs to her employer.
3. Walk her through connecting it: Claude settings, Connectors, Gmail, Connect, sign in with that address. Wait.
4. Confirm: search her Gmail for a recent job alert (LinkedIn, Indeed). Found: say which. None yet: find any recent email to prove the connection works. Set `desk.yml` `gmail_checked: true` and `gmail_alerts: true`.
5. **The daily run gets Gmail (she does this).** Walk her to the "Job Search Desk daily run" task's settings and add the Gmail connection, and only that one. Wait until she confirms.
6. **Alerts.** Build exact searches from her title list and location: LinkedIn 3 to 5 (job title keywords, location or Remote, daily email), Indeed 2 to 3, Built In 1 to 2 if her city has a Built In site. Give her each search as copy-ready text and walk her through saving it as a daily email alert. LinkedIn shows how many jobs a search finds: if one finds fewer than 5 or more than 500, adjust the title words with her; this is a good test of her title list. Record each in `desk.yml` `alert_searches` as `{ site, search, frequency: daily }`.
7. **Keep alerts out of her inbox (she does this in Gmail).** Gmail search bar: `from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com OR alert@indeed.com OR noreply@builtin.com)`, then the filter icon, Create filter, tick "Skip the Inbox" and "Apply the label" with a new label "Job alerts", Create filter. You never create filters or labels yourself.
8. Say: alerts start arriving tomorrow, and the next morning run is the check that alerts and Gmail work; any problem shows at the top of her job page.
9. `node desk/setup.mjs done 9`

## Step 10. Your achievements (about 20 minutes)

1. Ask her to attach what she gathered: the last 2 or 3 performance reviews, promotion or award emails, 1 or 2 project decks or reports, LinkedIn recommendations. Fine if she has only some.
2. Read them. Map her roles from the last 10 years (7 years at one company is usually 2 or 3 roles). For each recent role, pick 3 to 5 themes the documents point to.
3. For each theme, four questions, one at a time: What changed because of you? Before and after, with numbers if there are any? How big (people, budget, volume)? Who would notice if it hadn't happened? Draft the bullet right away (one line, result first, verb-led) and show it; she approves or edits.
4. Target 8 to 12 approved bullets. Every number comes from her answers or her documents. When she estimates, the bullet says "about" and she confirms it. Never round up, never invent.
5. Write approved bullets into `profile/cv.md` under the right role. Write one story per theme to `profile/interview-prep/story-bank.md` (situation, what she did, result, and `**Provenance:** user-stated <date>`).
6. `node desk/setup.mjs done 10`

## Step 11. Your resumes (about 15 minutes)

1. `git pull -q --rebase --autostash origin main` for the latest scored jobs. Propose 1 to 3 role tracks from her target roles. Add a second track only when its postings reward different things (read the scored postings in `profile/data/scores/` and `profile/jds/` to check).
2. For each track, draft a resume from `profile/cv.md` only, as `profile/resumes/<track-id>.md` in the same shape: a summary written for the track, the bullets that matter most for it first, wording mirrored from real postings in her scan, at most 2 pages. Roles that ended more than 15 years ago collapse into one line under "Earlier experience".
3. `node desk/resume.mjs build profile/resumes/<track-id>.md`. It refuses any number not in the master resume: fix the draft, or confirm the fact with her and add it to the master first.
4. Show each in chat: the summary and the top 3 bullets per role, and send the PDF as a file. She edits in plain words; rebuild after each change until she approves.
5. Add each to `profile/resumes/index.yml`: `{ id, name, kind: default, updated, pdf: <id>.pdf, text_file: <id>.txt, summary: <one line on what it leads with> }`.
6. **On her page.** Upload each resume PDF as an asset of her job page (Artifact publish with `url` = `desk.yml` `page_url`, `asset: true`, `file_paths`). Save each asset id to its `index.yml` entry as `asset_id`. Then `node desk/page-sync.mjs push --no-run`, ArtifactData `batch` per printed file, `node desk/page-sync.mjs ack <file>`. If a PDF upload failed and the resume was already pushed, upload it, add the asset_id, and use the resume update step in desk/CLAUDE-DESK.md; push skips resumes already on the page.
7. `node desk/setup.mjs done 11`

## Step 12. Test the scoring (about 10 minutes)

1. `git pull -q --rebase --autostash origin main`, then `node desk/setup.mjs sample` picks 8 scored postings from her real jobs (high, middle and low, across her title families), shuffled. Leave out jobs she already decided on her page; their decisions already teach the scoring. If it answers `short: true`, score more first (`daily.mjs todo --cap 20`, the same way as step 8 point 2). Still short: find live postings for her titles with web search, save each one's text as `profile/jds/s<n>.md` with the same front matter the scan writes (`id: "s<n>"`, `url`, `company`, `title`, `found`, `jd: saved`), score them the same way, and use 5 to 8 in all.
2. Show them blind, 4 per question round: title, company, location, pay, and a 2-line summary of the job. No score. For each she picks Would apply, Wouldn't, or Not sure, and may add a reason (pay, size, location, industry, function, seniority).
3. Record them all in `profile/config/scoring-cases.yml`: `{ name: "<company>, <title>", decision: apply | skip | unsure, reasons: [...], input: <the posting's extraction from profile/data/extractions/<id>.json> }`.
4. Reveal: `node desk/test-scoring.mjs`. Tell her the agreement in plain words ("We agreed on 6 of 8"), and show each disagreement with its score and the line that drove it.
5. For each disagreement, propose one change: move a dimension to another bucket, reword a 5 or a 1, add a deal-breaker, or change the title list. She accepts or declines. After each accepted change, add a line to `scoring.yml` `history` ("<date> step 12: <change>") and rerun the test.
6. Settle her step 4 "not sure" items with what the 8 answers showed; ask only when they don't.
7. Stop when 3 in 4 agree (6 of 8) or after 3 changes. Remaining gaps go to the weekly suggestions.
8. `node desk/suggest.mjs rescore`, save, then `node desk/setup.mjs done 12`.
9. **Close.** Tell her setup is complete: her page now suggests a resume for each job, alert emails come in every morning, and her open jobs get the new scores in the next morning run.
