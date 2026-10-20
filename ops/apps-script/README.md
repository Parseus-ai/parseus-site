# Parseus AI: website forms backend (Google Apps Script)

This folder holds the private backend for the two forms on the Parseus AI website:

- **Consultation application** (ten complimentary 20-minute AI strategy conversations)
- **Roundtable registration**

Submissions are stored in a **private Google Sheet** in the parseus.ai Google Workspace account, and emails are sent from the Google account that deploys the script. Nothing is stored on the website or in this repository.

> **This repository is public.** Never commit Sheet contents or links, Script Properties, the Turnstile secret, the booking link, meeting links or any submission data. Only the public `/exec` URL and the public Turnstile *site* key belong in the website config.

For a short, non-technical version of the setup, see **[ops/SETUP-CHECKLIST.md](../SETUP-CHECKLIST.md)**. The email wording is in **[ops/campaign-messages.md](../campaign-messages.md)**.

| File | Purpose |
|---|---|
| `Code.gs` | The Apps Script code (paste into the Apps Script editor) |
| `appsscript.json` | The Apps Script manifest (time zone, permissions, web app settings) |
| `test/harness.mjs` | Local automated tests (`node ops/apps-script/test/harness.mjs`) |

---

## What you need (credentials and configuration)

| Item | Where it lives | Required? |
|---|---|---|
| Google Workspace user on parseus.ai (see [step 5](#5-deploy-as-a-web-app) for which one) | Owns the Sheet and the script; emails are sent from this account | Required |
| Web app `/exec` URL | Website file `assets/forms-config.js` → `endpoint` | Required for the forms to appear |
| `BOOKING_URL` | Script Properties only, **never on the website** | Required before sending booking links |
| `TURNSTILE_SECRET` | Script Properties only, **never on the website or in Git** | Required before public activation |
| Turnstile **site** key | Website file `assets/forms-config.js` → `turnstileSiteKey` (public by design) | Required before public activation |
| Other settings | Script Properties (defaults are added by `setup()`) | See [step 4](#4-set-script-properties) |

**The forms stay hidden on the website until `endpoint` is set** in `assets/forms-config.js`. Nothing breaks while you set this up.

---

## 1. Create the Sheet

1. Sign in to Google with the parseus.ai account that will own the forms (see [step 5](#5-deploy-as-a-web-app)).
2. Go to <https://sheets.new> to create a blank spreadsheet.
3. Name it something like **Parseus: website submissions (private)**.
4. **File → Settings → Time zone**: choose the same time zone as the script (`America/Vancouver`, set in `appsscript.json`). Event start times you type in the Sheet are read in the Sheet's time zone.
5. Do **not** share it with anyone outside the people who review applications. Anyone with **edit** access can also open the script, see the Script Properties (including the booking link and Turnstile secret) and change the code. (See *Privacy* below.)

## 2. Add the script

1. In the Sheet, open **Extensions → Apps Script**. A new tab opens with the script editor.
2. Rename the project (top left, "Untitled project") to **Parseus forms**.
3. In the left sidebar, click the file **Code.gs**, delete everything in it, and paste the full contents of `ops/apps-script/Code.gs` from this repository. Click **Save** (disk icon or Ctrl+S).
4. Click the **gear icon (Project Settings)** in the left sidebar and tick **"Show 'appsscript.json' manifest file in editor"**.
5. Go back to the **Editor** (`< >` icon). Click **appsscript.json**, replace its contents with `ops/apps-script/appsscript.json`, and **Save**.

## 3. Run `setup()` once

1. In the editor toolbar, choose the function **`setup`** from the dropdown next to **Run**, then click **Run**.
2. Google asks for permission the first time:
   - Click **Review permissions** and choose the parseus.ai account.
   - If you see "Google hasn't verified this app", click **Advanced → Go to Parseus forms (unsafe)**. (It is your own script; this warning is normal for private scripts.)
   - Click **Allow**. The script asks to: manage spreadsheets, send email as you, connect to an external service (Cloudflare Turnstile), manage its own triggers, and show menus and dialogs in the Sheet.
3. Return to the Sheet tab and reload it. You should now see:
   - Tabs **Consultations**, **Roundtable registrations**, **Events** (bold, frozen header rows; Status dropdowns; checkboxes).
   - One event row: **rt-01**, "From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?", Duration 60, **Capacity 25 (a placeholder: change it to the real number)**, Registration open ticked, Start and Meeting link blank.
   - A **Parseus** menu in the menu bar.

`setup()` is safe to run again. It never deletes or moves data and never adds a second seed event. When the code is updated and needs new columns, running it again **adds the missing columns at the end** of each tab, so existing Sheets keep working.

## 4. Set Script Properties

In the Apps Script editor: **gear icon (Project Settings) → Script Properties**. These are the only place secrets go.

`setup()` already added the settings marked "default" below, plus an internal `SPREADSHEET_ID` (leave that one alone).

| Property | Value |
|---|---|
| `NOTIFY_EMAIL` | One address that receives a notification for every new submission (default `info@parseus.ai`). Replies from applicants also go here. For several people, use a Google Group address. |
| `BOOKING_URL` | Your private Google Calendar appointment schedule link ([step 7](#7-private-booking-link-google-calendar-appointment-schedule)). Must start with `https://`. |
| `TURNSTILE_SECRET` | Cloudflare Turnstile **secret** key ([step 6](#6-cloudflare-turnstile-spam-protection)). |
| `REQUIRE_TURNSTILE` | Default `false`. Set to `true` at activation. When `true`, the forms refuse every submission if `TURNSTILE_SECRET` is missing (so an accidentally deleted secret cannot silently switch spam protection off). |
| `TURNSTILE_HOSTNAMES` | Optional, e.g. `parseus.ai,www.parseus.ai`. If set, Turnstile tokens issued for any other website are refused. |
| `CONSULTATION_CAP` | Default `10`. The number of complimentary conversations. Emails use this number. |
| `SENDER_NAME` | Default `Parseus AI`. The "From" display name. |
| `MAX_SUBMISSIONS_PER_10_MIN` | Default `20`. Global limit for both forms together, whatever email address is used. |
| `MAX_SUBMISSIONS_PER_DAY` | Default `100` (rolling 24 hours, at most 500). |
| `DUPLICATE_WINDOW_DAYS` | Default `30`. A second consultation application from the same email address within this many days is answered normally but not stored again and gets no second email. `0` turns this off. |
| `PRIVACY_NOTICE_VERSION` | Default `October 2026` (the "Last updated" date on the website's privacy page). Stored with every submission. Update it when the privacy notice changes. |
| `RETENTION_NOT_SELECTED_MONTHS`, `RETENTION_COMPLETED_MONTHS`, `RETENTION_ROUNDTABLE_MONTHS` | Defaults `6`, `12`, `6`. Used by **Parseus → Apply data retention**. |

Click **Save script properties**.

## 5. Deploy as a web app

**Which account?** The script runs, stores data and sends email **as the account that deploys it** ("Execute as: Me").

- **Recommended:** if `info@parseus.ai` is a real Workspace user (a mailbox you can sign in to), create the Sheet, the script and the deployment while signed in as `info@parseus.ai`. Emails then come from info@parseus.ai, and nothing depends on one person's account.
- If `info@parseus.ai` is a group or an alias (you cannot sign in to it), use the founder's parseus.ai account. Emails then come from the founder's address with the display name "Parseus AI", and replies go to `NOTIFY_EMAIL` (info@parseus.ai).
- Do not use a personal (non-Workspace) Google account: lower email limits, and the data would sit outside the business account.

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Description: `Website forms v1`.
4. **Execute as: Me** (the account above). Visitors never see or use your account; the script acts on your behalf only in the ways `Code.gs` allows.
5. **Who has access: Anyone**. This lets the public website post to it without a Google sign-in. It does not give anyone access to the Sheet or the code.
6. Click **Deploy**, authorise again if asked, and copy the **Web app URL**. It ends in **`/exec`**.
7. Quick check: paste the URL into a browser. You should see `{"ok":true,"service":"parseus-forms"}`.
8. **Do not put the URL on the public website yet.** Test first ([step 8](#8-test-before-activation)), then activate ([step 9](#9-activate-the-public-forms)).

The `/exec` URL is not a secret once the site is live (anyone visiting can see it), but it only accepts the two form types and never returns stored data.

## 6. Cloudflare Turnstile (spam protection)

Required before the forms go public. Turnstile is Cloudflare's privacy-friendly alternative to CAPTCHAs. Without it, a script can submit the forms with any email address, which would make your account send confirmation emails to people who never asked for them. The honeypot field, minimum fill time and per-email limit only stop simple bots.

1. Sign in to the Cloudflare dashboard → **Turnstile → Add widget**.
2. Widget name `Parseus forms`; hostnames `parseus.ai` and `www.parseus.ai`. Widget mode **Managed**.
3. Cloudflare shows a **Site key** and a **Secret key**. You can see them again in the Cloudflare dashboard at any time, so there is no need to copy them anywhere yet.
4. **At activation** ([step 9](#9-activate-the-public-forms)), not before testing:
   - **Secret key** → Apps Script **Script Properties** → `TURNSTILE_SECRET`. Never put it on the website, in Git, or in a chat.
   - Optional: Script Property `TURNSTILE_HOSTNAMES` = `parseus.ai,www.parseus.ai`.
   - Set `REQUIRE_TURNSTILE` to `true`.
   - **Site key** → website `assets/forms-config.js` → `turnstileSiteKey` (public, safe to commit).

Why at activation: as soon as `TURNSTILE_SECRET` is set, every submission must carry a valid Turnstile token for the right form, and the local test in step 8 runs without one. Turnstile tokens are checked by Cloudflare and can only be used once.

## 7. Private booking link (Google Calendar appointment schedule)

1. Open Google Calendar with the deploying account → **Create → Appointment schedule**.
2. Title `Parseus AI: complimentary AI strategy conversation`, duration **20 minutes**. Set your availability, a **buffer** between appointments (for example 10 minutes), a **maximum bookings per day**, and the booking window.
3. Booking form: keep the default fields (name, email). If your plan offers email verification for bookers, turn it on. Add Google Meet video conferencing. Check the confirmation and reminder email settings.
4. Save, then **Share → copy the booking page link**.
5. Paste it into Script Property **`BOOKING_URL`**. It must not go anywhere else.

**Never publish this link on the website, in Git or in a chat.** It is only sent by email to the applicants you select. If it leaks, create a new appointment schedule, update `BOOKING_URL`, and delete the old schedule.

## 8. Test before activation

`?preview=forms` on the website only shows the forms; it sends nothing, so it is **not** an end-to-end test. To test the real backend without making the forms public:

1. Make sure `TURNSTILE_SECRET` is not set yet and `REQUIRE_TURNSTILE` is `false`, and leave `turnstileSiteKey` empty in your local copy.
2. In a **local copy** of the website, put the `/exec` URL into `endpoint` in `assets/forms-config.js`. **Do not commit or push this change.**
3. From the repository folder, run `python -m http.server 8765` and open `http://localhost:8765/beyond-ai-headlines/conversations/`.
4. Submit an application with your own email address, at a normal pace (faster than 3 seconds is silently ignored as a bot). Check: a new row with Status *New*, *Consent given at* and *Privacy notice version* filled in; message 1 in your inbox; a notification at `NOTIFY_EMAIL`.
5. Submit the same email again: the page shows the same reference, no new row, no new email.
6. In the Sheet, set your row to **Selected** and run **Parseus → Send booking links**; check the email and that *Booking link sent at* is filled. Try **Not selected** and **Held for later round** on other test rows with **Send decision notices**.
7. Open `http://localhost:8765/beyond-ai-headlines/roundtables/`, register, and check the row and message 7a or 7b. Set the event's Capacity to `1` and register with a second address to see the waitlist message (9). Mark the first one **Cancelled** and run **Promote from waitlist** (9b). Set Capacity back afterwards.
8. Run **Parseus → Check setup**.
9. Delete your test rows, and undo the local `forms-config.js` change (for example `git checkout assets/forms-config.js`).

## 9. Activate the public forms

1. In Script Properties, add `TURNSTILE_SECRET` (and optionally `TURNSTILE_HOSTNAMES`), and set `REQUIRE_TURNSTILE` to `true` ([step 6](#6-cloudflare-turnstile-spam-protection)). Run **Parseus → Check setup**: it should report no problems.
2. Put the `/exec` URL into `endpoint` and the Turnstile **site** key into `turnstileSiteKey` in `assets/forms-config.js`, commit, and publish the website (with the founder's approval).
3. On parseus.ai, submit one real application and one registration with your own address. Check the rows and emails. If anything fails, clear `endpoint` and publish again: the forms hide and visitors see the email alternative.
4. Install the reminder trigger (**Parseus → Install reminder trigger**) if you have not already.

---

## Day-to-day workflow

You do everything from the Sheet. New submissions appear as new rows and you get a notification email for each one. The notification contains exactly what the person typed: do not open links in it unless you trust the sender.

Every menu action that sends email shows how many people will be emailed and asks for confirmation. It records the send time in the row **before** sending, so a double click, a second person running the same menu, or a retry can never email the same person twice. If an email fails, the row is put back as it was and **Last email error** explains; run the menu again later. One run sends at most 50 emails; run it again for the rest.

### Consultation applications (tab **Consultations**)

1. **Review**: change Status from **New** to **Under review**; add thoughts in **Reviewer notes**.
2. **Decide**: set Status to **Selected**, **Not selected** or **Held for later round**. The Sheet refuses a "Selected" that would exceed the cap (the cell reverts and a message appears). Pasting several cells at once, or editing from another tool, cannot be checked this way; you get a warning instead, and the booking-link menu still never sends more links than the cap. **Parseus → Show consultation places used** shows how many are allocated. "Held for later round" does not use a place.
3. **Send booking links**: **Parseus → Send booking links to Selected applicants** (message 3). It emails `BOOKING_URL` to rows with Status *Selected* and an empty *Booking link sent at*, then fills *Booking link sent at*, *Decision date*, *Decision sent at* and sets Status *Booking link sent*. It re-checks the cap at the moment of sending and refuses if `BOOKING_URL` is not set.
4. **Send decision notices**: **Parseus → Send decision notices (Not selected / Held)** emails message 4 or 4b to rows without *Decision sent at*. If a held applicant is later selected, the booking-link menu works as usual.
5. When the applicant books (Google Calendar emails you), set Status **Scheduled** and fill **Conversation date**.
6. After the call set Status **Completed**, then **Parseus → Send consultation follow-ups (Completed)** (message 6). Status becomes *Follow-up sent*.

### Roundtables (tabs **Events** and **Roundtable registrations**)

1. **Edit the event** in the **Events** tab: set the real **Capacity**, and when confirmed the **Start** (date and time) and **Meeting link (private)**. To add another roundtable, add a row with a new Event ID (e.g. `rt-02`) and give the website the same ID.
2. Registrations arrive as **Registered** until capacity is reached, then **Waitlisted**. A repeat registration with the same email for the same event is not stored again.
3. To close registration, untick **Registration open**. Registration also closes automatically once the Start time has passed.
4. **Send details**: once Start and Meeting link are set, **Parseus → Send event details to registrants** (message 7c).
5. **Cancellations**: set the person's Registration status to **Cancelled**, then **Parseus → Promote from waitlist** (message 9b). Places are filled in the order people signed up.
6. **Reminders**: run **Parseus → Install reminder trigger** once. Every hour the script sends a single reminder (message 8) to Registered people for any event starting within the next 24 hours. **Send due reminders now** does the same immediately.
7. **After the event**: tick **Attended** for those who came, then **Parseus → Send roundtable follow-ups (Attended)** (message 10).

Anyone who registers receives the meeting link, and links can be forwarded. In Google Meet, use host controls so that people outside your organisation must ask to join and you admit them.

---

## Abuse protection (what the code does)

- **Turnstile** (when configured): every submission needs a fresh, single-use token for the matching form.
- **Global limit**: at most `MAX_SUBMISSIONS_PER_10_MIN` / `MAX_SUBMISSIONS_PER_DAY` stored submissions across both forms. Beyond that, visitors see a generic error, nothing is stored and **no emails are sent**, and `NOTIFY_EMAIL` gets one alert (at most every 6 hours).
- **Per email address**: at most 3 submissions per form per hour; repeat consultation applications within `DUPLICATE_WINDOW_DAYS` and repeat registrations for the same event are not stored again and get no new email.
- **Honeypot and minimum fill time** for simple bots.
- **Automatic emails never repeat the free text** someone typed (challenge, outcome, question, organization, role). The name is used in the greeting only if it looks like a plain personal name; otherwise the email says "Hello,".
- **Input cleaning**: invisible and control characters are removed; name, role and organization are single-line; email addresses must be a single plain address; text that a spreadsheet could treat as a formula is stored as plain text.
- **Errors** never reveal details to visitors. Logs contain no email addresses or submitted text. Internal failures send one alert to `NOTIFY_EMAIL` (at most every 6 hours).

---

## Privacy and data retention

- Submission data lives **only** in this Google Sheet (and in the notification and confirmation emails). Nothing is stored on the website, in GitHub, or by Cloudflare beyond the Turnstile check.
- Each row records **Consent given at** and **Privacy notice version**.
- Keep the Sheet shared only with the people who review applications, and never "Anyone with the link". Everyone with edit access can see all personal data, the Script Properties and the code.
- The Events tab contains private meeting links: treat it as confidential.
- Anyone can ask to withdraw by replying to their email; delete their row when they do (or clear their personal details).
- **Retention clean-up** (for example once per quarter): **Parseus → Apply data retention (anonymise old rows)**. It first shows how many rows are affected and asks YES or NO. Personal details are replaced with `[removed]`; status, dates, area and stage are kept so place counts stay correct.
  - Consultations marked *Not selected*: `RETENTION_NOT_SELECTED_MONTHS` (6) after the decision date.
  - *Completed* / *Follow-up sent*: `RETENTION_COMPLETED_MONTHS` (12) after the conversation date.
  - *New*, *Under review*, *Held for later round*: `RETENTION_COMPLETED_MONTHS` (12) after submission.
  - *Selected*, *Booking link sent*, *Scheduled* are never touched (update their Status first).
  - Roundtable registrations: `RETENTION_ROUNDTABLE_MONTHS` (6) after the event. People who answered **Yes** to *Future updates* keep name and email only (remove them on request).
  - Copies in email inboxes are not affected; delete old notification emails separately.
- Rate-limit counters are kept in Apps Script's cache for at most one hour and contain only a hash of the email address. The global limit stores only timestamps.

---

## Testing (developers)

With Node 24, from the repository root run

```
node ops/apps-script/test/harness.mjs
```

It runs Code.gs against mocked Google services and prints a PASS/FAIL summary. It also checks that `ops/campaign-messages.md` matches the emails in `Code.gs` word for word. These tests do **not** exercise real Google infrastructure; see [step 8](#8-test-before-activation) for the end-to-end test.

## Updating the code later (keep the same URL)

1. Paste the new `Code.gs` into the editor and **Save**.
2. Run **`setup`** once (adds any new columns and settings; safe to repeat).
3. **Deploy → Manage deployments** → select the existing web app deployment → **pencil (Edit)**.
4. Under **Version** choose **New version** → **Deploy**.

This keeps the same `/exec` URL, so the website does not need changing. (Choosing *New deployment* instead creates a **different** URL.) Menu changes appear after reloading the Sheet; changes that need new permissions will ask you to authorise again.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Forms don't appear on the website | `endpoint` in `assets/forms-config.js` is empty or the site hasn't been republished. |
| Browser test of `/exec` shows a Google sign-in page or "access denied" | The deployment's *Who has access* isn't **Anyone**. If **Anyone** is not offered, a Workspace admin must allow it: Admin console → Apps → Google Workspace → Drive and Docs → Sharing settings → allow sharing outside the organisation. |
| Form shows "Something went wrong on our side"; nothing in the Sheet | Check `NOTIFY_EMAIL` for an alert. Open Apps Script → **Executions** to see the error. Most often a tab or column header was renamed: run `setup()` again. It can also be the global limit (alert "submission-limit") or `REQUIRE_TURNSTILE` without `TURNSTILE_SECRET` (alert "turnstile-missing"). |
| Form says "We couldn't reach our server" | The browser got no usable answer, for example a Google error or quota page instead of the form response. Try again later; check Executions. |
| `{"ok":false,"error":"spam"}` for every real visitor | `turnstileSiteKey` on the website is missing or belongs to a different widget, the site's hostname isn't listed on the widget (or in `TURNSTILE_HOSTNAMES`). |
| "This roundtable could not be found" | The website's event ID doesn't match the **Event ID** in the Events tab exactly. |
| Roundtable form says registration is closed | **Registration open** is unticked, or **Start** is in the past. |
| Code edits don't take effect on the website | You saved but didn't redeploy. Use **Manage deployments → Edit → New version**. |
| No **Parseus** menu | Reload the Sheet. If still missing, run `onOpen` once from the editor. |
| "Selected" keeps reverting | The cap is reached. Check **Show consultation places used**, or raise `CONSULTATION_CAP`. |
| Booking links menu says `BOOKING_URL is not set` | Add it in Script Properties ([step 4](#4-set-script-properties)). |
| A row shows **Last email error** | That email was not sent and the row was not marked as sent. Run the same menu again. |
| A menu says another action is running | Someone else (or the hourly reminder) is sending. Wait a moment and try again. |
| Reminders not sent | Run **Install reminder trigger**; check the event has a future **Start** and a **Meeting link**; check Apps Script → **Triggers**. |
| Emails not arriving | Check spam folders; check Apps Script → Executions for quota errors; confirm `NOTIFY_EMAIL` is a single valid address. |
| Someone legitimately submitted several times and got "rate limited" | Each email address can submit each form 3 times per hour. Ask them to wait an hour or to email info@parseus.ai. |
| An applicant needs to change their application | Repeat applications within `DUPLICATE_WINDOW_DAYS` are not stored. Ask them to email info@parseus.ai and edit the row. |
