# Changelog

Newest first. "update career tool" shows the entries newer than the copy's version, in these plain words.

## 0.13.8 (2026-10-13)
- Stats: Morning runs, under Latest run, shows each morning run of the last two weeks with how many jobs it sent to To review, found and scored. Run now isn't counted. Earlier days are filled in from your scores the first time it runs.

## 0.13.7 (2026-10-13)
- New skip reason: Duplicate. Like Job closed, it never counts against your scoring.

## 0.13.6 (2026-10-13)
- New skip reason: Job closed, for postings no longer taking applications. It shows under Why you skipped on Stats but never counts against your scoring or its weekly suggestions.

## 0.13.5 (2026-10-13)
- "Why this score" labels are a neutral grey instead of red.
- A job scored from its title only now says "Preliminary score. Paste job description."

## 0.13.4 (2026-10-13)
- After you paste a job description, its "Description saved" tag shows in green with a check mark.

## 0.13.3 (2026-10-12)
- The tour now shows the nightly sweep and the morning web search on Scan sources, and the status line's waiting message before the first morning run.

## 0.13.2 (2026-10-12)
- Setup leaves out 19 more countries by default, so remote jobs based abroad stay out of the nightly sweep.

## 0.13.1 (2026-10-12)
- Setup keeps the nightly sweep focused: a stricter title list for it, and a longer list of countries to leave out by default.

## 0.13.0 (2026-10-12)
- Every night, a free sweep of about 15,000 companies' public job boards (Greenhouse, Lever, Ashby) looks for your titles and locations, on top of the companies you listed. It uses no Claude usage and has its own switch on Scan sources. Copies made before this version need Erik to add it.
- Daily limits on Scan sources: set how many web searches, scored jobs and deep evaluations Claude does each morning, to use less of your plan or find more.

## 0.12.0 (2026-10-12)
- Every morning run searches the web for your titles across Greenhouse, Lever, Ashby, Workable and other job boards, so it finds jobs at companies you never listed. Setup writes the searches for you; a few run each morning, in turn (5 on Pro, 10 on Max 5x, 15 on Max 20x).
- Scan sources shows the web search next to Gmail alerts, with its own on and off switch.

## 0.11.15 (2026-10-12)
- Stats: a new Latest run section shows what the most recent run did: jobs listed on your job boards, new jobs found, how many were scored and how many went to To review, plus deep evaluations, requests and company websites.

## 0.11.14 (2026-10-12)
- Stats: the Applications tile is now Applications submitted.

## 0.11.13 (2026-10-12)
- Works from a regular Claude chat: setup runs in the same chat as the start prompt, and the page's copy buttons (update, tailor, master resume) copy a request that opens your private copy in any new chat.
- Stats: "Withdrew" reads "You withdrew".

## 0.11.12 (2026-10-12)
- Stats: the scoring accuracy tile reads "You acted on 9 of 21 qualified postings."

## 0.11.11 (2026-10-12)
- Stats: the three breakdowns under Closed jobs are separated by thin rules.

## 0.11.10 (2026-10-12)
- Stats: the second step of each funnel no longer repeats its percentage.

## 0.11.9 (2026-10-12)
- Updates come from a public template, so checking for a new version no longer needs any extra access.
- Setup: no GitHub invitation needed anymore, and the first steps say which Claude model to pick.

## 0.11.8 (2026-10-12)
- Before the first morning run, the status line says "Waiting for the first morning run" instead of counting it as a problem.
- Setup: answers are saved as you give them, so a pause loses at most one question; continue setup picks up where you stopped. Pro plans take the shorter path automatically.
- Setup: clearer steps for the daily task's settings (which private copies it uses, its connections, approval and model), more realistic times, and a prep list for the first session.

## 0.11.7 (2026-10-12)
- The page no longer shifts sideways when you switch between a short tab and a long one.

## 0.11.6 (2026-10-12)
- Run now moved down to the right end of the main tabs (Triage, Resumes, Scan sources, Stats).

## 0.11.5 (2026-10-12)
- All buttons share one color again. The next step for each job is still the rightmost button, now marked by a bold label instead of a tint.

## 0.11.4 (2026-10-12)
- Scan sources: the Add button shows up once you type something, so the field stands alone until then.

## 0.11.3 (2026-10-12)
- Scan sources has one field: typing finds a company, and a company that isn't there gets added with Add (or Enter), as a dream company, a job board, or a block.

## 0.11.2 (2026-10-12)
- Resumes: the master resume's two buttons sit on one line, and Copy update prompt explains what it does when you point at it.

## 0.11.1 (2026-10-12)
- Headings use the same serif as the page name.
- Your master resume shows on the Resumes tab, with a plain-text copy for application forms. When you update it in Claude, the page shows the new version.
- How many company websites the morning run looks up a day now follows your Claude plan (5 on Pro).
- The tour and setup mention Run now, company website links and the status line at the bottom of the page.

## 0.11.0 (2026-10-12)
- Company names link to the company's website. The morning run looks up a few new companies each day, and keeps a link only when the address carries the company's name.
- Links that open another site end with a small out-arrow.
- The selected stage on Triage is filled in clay, so it stands out.
- The status moved into the footer next to the version: a thumbs up when everything works, a warning sign when something needs a look.
- Clicking Job Search Desk at the top goes back to To review.
- Resumes: standard resumes come first. A tailored resume reads "Tailored for (job) at (company)", and the job part opens that job's card when it's on your list.
- Clickable tags share one hover: a slightly deeper tint. New labels are pastel yellow.
- No response jobs have Reopen like every closed job: it puts the job back where it went quiet, with a fresh 21 or 14 day window.

## 0.10.2 (2026-10-12)
- The next step for each job (Interested, Applied, Interviewing, Offer, Offer accepted, They replied) is always the rightmost button, in a soft clay color. Save and confirm buttons sit to the right of Cancel everywhere.

## 0.10.1 (2026-10-12)
- The version, your plan and the last run moved to a footer at the bottom of the page.
- Run now explains what it does when you point at it, before you click.
- A job scored from its title only shows one label that opens the paste box.
- Each job's stage (New, Interested, Applied, Skipped, No response and the rest) shows as a colored label with an icon.
- A job's buttons sit in the bottom right corner of its card.
- On the Resumes tab, "Show the job" opens the job a tailored resume was made for.

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
