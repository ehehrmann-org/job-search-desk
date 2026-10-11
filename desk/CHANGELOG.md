# Changelog

Newest first. "update career tool" shows the entries newer than the copy's version, in these plain words.

## 0.3.0 (2026-10-11)
- Your job page keeps what you're typing or picking when new data arrives, and undoes a click that didn't save instead of showing it as saved.
- "They replied" on a job with no response moves it back to where it went quiet with a fresh date; Reopen no longer sends applications straight back to Closed.
- Closed shows 50 jobs at a time. Stats leaves out blocked companies and uses the newest scores.
- Scan sources shows what recent runs did with your requests, for example a job board link that couldn't be read.
- Jobs you add that the scan already found are taken over instead of waiting a day. LinkedIn and Indeed jobs are looked up on the employer's own job board.
- Alert emails no longer add the same job twice under different tracking links.
- The daily scan runs twice a night at fixed times and retries saving its results; saves from the daily run and from Claude retry too.
- Scoring is steadier: pay written as text is read correctly, one bad posting no longer stops the others, and postings that can't be read are marked instead of retried forever.
- Updates never touch the daily scan's own settings; if those change, Claude offers a message for Erik.

## 0.2.0 (2026-10-11)
- Weekly scoring suggestions: every Sunday, up to 3 changes based on what you skipped and what you went for, with Approve and Not now on your job page. Approved changes apply the next morning and your open jobs are rescored.
- Closed jobs: the filter buttons are gone; each job still shows how it closed. Stats has a new Closed jobs section: how they closed, why you skipped, and where applications ended.
- A status button at the top of your job page shows whether everything works and, if not, what to do and a message for Erik.
- Scan sources has one tab per kind of source, with search and a Quiet list.

## 0.1.0 (2026-10-11)
- First version: daily scan, scoring on your own dimensions, your job page with Triage, Resumes, Scan sources and Stats, Gmail job alerts, deep evaluations, blocked companies, and setup.
