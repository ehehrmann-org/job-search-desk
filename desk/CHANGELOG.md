# Changelog

Newest first. "update career tool" shows the entries newer than the copy's version, in these plain words.

## 0.10.0 (2026-10-12)
- Your job page now uses the Claude app's colors and fonts, in light and dark.
- An offer can be closed as Offer accepted or Offer declined; both move it to Closed.
- The version number sits small next to the page's name and says when an update is available. The update notice is shorter, with what's new one click away, and no longer cuts sentences off.
- A job scored from its title only has a "Paste the description" button: paste the description and the next run (or Run now) rescores it.
- Jobs are sorted by score on every stage, highest first.
- The Resumes tab lines up its columns, and saving a PDF no longer leaves a "Saved" note behind.
## 0.9.2 (2026-10-12)
- Setup connects your daily run to Erik's copy of the tool, so your job page can tell you when an update exists.

## 0.9.1 (2026-10-12)
- Setup's start message walks you through accepting Erik's invitation before you make your private copy.
- "update career tool" asks for access to Erik's copy of the tool first, so updates can be fetched.

## 0.9.0 (2026-10-12)
A review release: fixes across the job page, the daily run, scoring, setup and saving. Nothing new to learn.
- On phones, the Stats tab, the stage buttons and the three outcome buttons on Applied and Interviewing cards no longer run off the screen; small tag buttons and links are easier to tap; tapping a field on an iPhone no longer zooms the page; the page shows its content before its fonts arrive.
- Easier to read and to use with a keyboard or a screen reader: darker small gray text and Dream company label, a visible Off switch, visible focus on tabs and stage buttons, arrow keys between tabs, Escape closes the status popup, and saves and errors are announced and stay on screen long enough to read.
- If the page is shared with you as view-only, its buttons are off and a click that can't be saved says so. Error messages after a failed save match what actually went wrong.
- The page says "today" only for a run that finished on today's date; the To review list says Not connected when the page can't reach your data; a link that opens the page on a certain tab no longer overrides the tab you used last; the tour's sources step always shows the Job boards view.
- A source you switch on or off while a run is in progress stays the way you set it. A job you added yourself from a blocked company shows in To review. Stats no longer shows more scored jobs than jobs that passed the filters. When your list of companies is too long for the page, the status button says so.
- Run now no longer uses up a waiting job's scoring tries, no longer turns the next morning run into a quick run, and still looks up a job you added right before clicking it. If starting it fails in a way that may still have started it, the page shows Running and says so instead of marking it failed.
- The daily run saves your results to your private copy before it updates the page, and the page tells you when that save failed, that day or the next morning. The run finds its instructions whether it starts inside your private copy or has to fetch it.
- Saving works on a Mac again (a save could stop partway without saying anything), tells you when it could not store your changes instead of reporting that it saved, and still works when a file outside your profile was changed by hand.
- A scoring suggestion you approved is no longer undone by the next morning run. Problem messages for Erik name only a posting id, never a company, job title or link, and a settings file with a typo reports only the file name and the line.
- Scoring: a company over your size limit is only let through for an exception you listed, never one Claude made up; a posting that states its base pay is checked against your minimum even when the full range is missing; a minimum on a pay, size or location dimension now counts; rules match your settings even when spacing or punctuation differs; a number typed as text in your settings (like 200K) shows an error instead of quietly turning a rule off; jobs are no longer skipped for being outside your areas when you set none; an on-site job with no office days stated is rated like a 5-day job; a score that came back incomplete or written as text is read correctly or scored again the next day instead of getting a wrong score.
- Weekly suggestions: a company-size limit is only proposed against jobs you marked Interested or Applied, an office-days limit never goes below a job you applied to, a job you marked Interested and later skipped counts as a skip only, lowering your bar needs three applications under it, and a damaged score file no longer stops the suggestions.
- A job taken down before the scan could read it no longer reaches your page; a job the scan already saved is not added twice when an alert sends the same link with a tracking tag; relinking a LinkedIn or Indeed job to the employer's own posting works even after the scan tried the link; the morning run skips alert emails it already read the day before; the nightly scan summary no longer reads a normal night as a failure.
- A job marked Interested whose posting text couldn't be read gets a short note with what to do instead of an evaluation made up from the title. A job you tell Claude you already applied to lands under Applied with the day you applied. A resume that changed after it reached your page can be updated there. After an update, saving keeps working when your page has its own title.
- Setup: go-live no longer stops when it saves your page link and fetches the first scan results; right after setup your page says the first morning run hasn't happened yet instead of showing a scan problem; setup checks that your daily run is a cloud task the Run now button can start (and runs it on Sonnet to use less of your plan), that your deep evaluation cap matches your plan, and that your current employer is on your block list; the ready-made agency pack names Seer Interactive and Laundry Service correctly and drops three companies whose job boards could not be read; employer headings in your master resume use a comma instead of a dash; the resume check now catches a wrong count like 2,050.
- Checking for updates reports a problem instead of waiting for a login that never comes when the update source cannot be reached.

## 0.8.3 (2026-10-11)
- The update notice's button copies "update career tool" for you to paste into Claude, which shows what's new and asks before changing anything. (Updates can't install themselves unattended.)

## 0.8.2 (2026-10-11)
- Run now starts only the short run you asked for, not a full morning run first.
- Claude keeps setup and chat replies to one sentence: what it needs from you and why.

## 0.8.1 (2026-10-11)
- The status popup explains what Run now does, and "Last run" says when it was a Run now.

## 0.8.0 (2026-10-11)
- Your job page tells you when a new version of the career tool exists, with what's new.
- Your job page can keep a name of your choosing in the browser tab across updates.

## 0.7.0 (2026-10-11)
- A Run now button on your job page: it reads your clicks, writes the deep evaluations for jobs you marked Interested and updates the page in about 10 minutes, so you can go from review to applying in one sitting. The job scan still runs each morning. Typing "run my desk now" in Claude does the same.
- Jobs with a deal-breaker show a dash instead of 0.0, and their score breakdown names the deal-breaker.
- Updating the career tool now refreshes your job page too.

## 0.6.0 (2026-10-11)
- Setup goes live at the end of the first session: your job page and the daily run start right after you pick your job sources. The second session adds job alert emails, your achievements, your resumes and a check of the scoring on your real jobs.
- A shorter first session (about 75 minutes) when time is tight.
- No up-to-date resume? Setup builds your master resume from your LinkedIn profile and a few questions per role.

## 0.5.1 (2026-10-11)
- Small icons on buttons and labels; the suggested resume shows as a document icon with its name.
- Interviewing, Rejected and Withdrew sit on one line; the "Closes as No response" countdown moved under the job's details.
- The tour highlights exactly what each step explains.

## 0.5.0 (2026-10-11)
- New jobs have one main button, Interested; Applied appears once a job is in Interested. Applied jobs move on with Interviewing, Rejected or Withdrew.
- "+ Add a source" asks what you're adding: a dream company, a job board, or a company or website to block. Blocked websites (like jobright.ai) stop every posting hosted there.
- The status details open as a popup with a close button, and "Take the tour again" is a button.
- The tour covers all five stages with sample jobs, with clearer wording and arrows on Next and Back.
- Switches on Scan sources sit at the right edge on phones; buttons never break across lines.

## 0.4.1 (2026-10-11)
- The tour's explanation boxes never cover the part of the page they explain, on phones too; the page scrolls to make room.

## 0.4.0 (2026-10-11)
- A two-minute tour the first time you open your job page, on sample jobs you can click without changing anything. The sample jobs disappear when it ends. Take it again any time from the status button.
- The job page fits phone screens without sideways scrolling.

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
