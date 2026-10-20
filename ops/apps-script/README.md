# Parseus AI — website forms backend (Google Apps Script)

This folder holds the private backend for the two forms on the Parseus AI website:

- **Consultation application** (ten complimentary 20‑minute conversations)
- **Roundtable registration**

Submissions are stored in a **private Google Sheet** in the parseus.ai Google Workspace account and confirmation emails are sent from that account. Nothing is stored on the website or in this repository.

> **This repository is public.** Never commit Sheet contents or links, Script Properties, the Turnstile secret, the booking link, meeting links or any submission data. Only the public `/exec` URL and the public Turnstile *site* key belong in the website config.

| File | Purpose |
|---|---|
| `Code.gs` | The Apps Script code (paste into the Apps Script editor) |
| `appsscript.json` | The Apps Script manifest (time zone, permissions, web app settings) |
| `test/harness.mjs` | Local automated tests (`node ops/apps-script/test/harness.mjs`) |

---

## What you need (credentials & configuration)

| Item | Where it lives | Required? |
|---|---|---|
| Google Workspace user on parseus.ai (e.g. the founder's account) | Owns the Sheet and the script; emails are sent from this account | Required |
| `NOTIFY_EMAIL` | Script Properties (default `info@parseus.ai`) | Set automatically by `setup()`; change if needed |
| `SENDER_NAME` | Script Properties (default `Parseus AI`) | Set automatically by `setup()` |
| `CONSULTATION_CAP` | Script Properties (default `10`) | Set automatically by `setup()` |
| `BOOKING_URL` | Script Properties only — **never on the website** | Required before sending booking links |
| `TURNSTILE_SECRET` | Script Properties only — **never on the website or in Git** | Optional (spam protection) |
| Web app `/exec` URL | Website file `assets/forms-config.js` → `endpoint` | Required for the forms to appear |
| Turnstile **site** key | Website file `assets/forms-config.js` → `turnstileSiteKey` | Only if using Turnstile |

**The forms stay hidden on the website until `endpoint` is set** in `assets/forms-config.js`. This means nothing breaks while you set this up.

---

## 1. Create the Sheet

1. Sign in to Google with your **parseus.ai** Workspace account.
2. Go to <https://sheets.new> to create a blank spreadsheet.
3. Name it something like **Parseus — Website submissions (private)**.
4. Do **not** share it with anyone outside the people who review applications. (See *Privacy* below.)

## 2. Add the script

1. In the Sheet, open **Extensions → Apps Script**. A new tab opens with the script editor.
2. Rename the project (top left, "Untitled project") to **Parseus forms**.
3. In the left sidebar, click the file **Code.gs**, delete everything in it, and paste the full contents of `ops/apps-script/Code.gs` from this repository. Click **Save** (disk icon or Ctrl+S).
4. Click the **gear icon (Project Settings)** in the left sidebar and tick **"Show 'appsscript.json' manifest file in editor"**.
5. Go back to the **Editor** (`< >` icon). Click **appsscript.json**, replace its contents with `ops/apps-script/appsscript.json`, and **Save**.

## 3. Run `setup()` once

1. In the editor toolbar, choose the function **`setup`** from the dropdown next to **Run**, then click **Run**.
2. Google asks for permission the first time:
   - Click **Review permissions** → choose your parseus.ai account.
   - If you see "Google hasn't verified this app", click **Advanced → Go to Parseus forms (unsafe)**. (It is your own script; this warning is normal for private scripts.)
   - Click **Allow**. The script asks to: manage this spreadsheet, send email as you, connect to Cloudflare (Turnstile check), manage its own triggers, and show menus/dialogs in the Sheet.
3. Return to the Sheet tab and reload it. You should now see:
   - Tabs **Consultations**, **Roundtable registrations**, **Events** (bold, frozen header rows; Status dropdowns; checkboxes).
   - One event row: **rt-01 — "From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?"**, Duration 60, **Capacity 25 (placeholder — change it to the real number)**, Registration open ✓, Start and Meeting link blank.
   - A **Parseus** menu in the menu bar.

`setup()` is safe to run again; it never deletes data and never adds a second seed event.

## 4. Set Script Properties

In the Apps Script editor: **gear icon (Project Settings) → Script Properties → Add script property**.

`setup()` already added `NOTIFY_EMAIL`, `SENDER_NAME`, `CONSULTATION_CAP` and an internal `SPREADSHEET_ID` (leave that one alone). Add or change:

| Property | Value |
|---|---|
| `NOTIFY_EMAIL` | Address that receives a notification for every new submission (default `info@parseus.ai`). Replies from applicants also go here. |
| `BOOKING_URL` | Your private Google Calendar appointment schedule link (see step 7). |
| `TURNSTILE_SECRET` | Cloudflare Turnstile **secret** key, only if you use Turnstile (step 6). |
| `CONSULTATION_CAP` | `10` unless you decide to offer a different number of conversations. |
| `SENDER_NAME` | `Parseus AI` |

Click **Save script properties**.

## 5. Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Description: `Website forms v1`.
4. **Execute as: Me** (your parseus.ai address).
5. **Who has access: Anyone** (this lets the public website post to it; it can only do what `Code.gs` allows).
6. Click **Deploy**, authorise again if asked, and copy the **Web app URL** — it ends in **`/exec`**.
7. Quick check: paste the URL into a browser. You should see `{"ok":true,"service":"parseus-forms"}`.
8. In the website repository, open `assets/forms-config.js` and paste the URL into `endpoint`, e.g.
   `endpoint: "https://script.google.com/macros/s/AKfy…/exec",`
   Commit and publish the website. The forms now appear.

The `/exec` URL is not a secret (anyone visiting the site can see it), but it only accepts the two form types and never returns stored data.

## 6. Optional: Cloudflare Turnstile (spam protection)

Turnstile is Cloudflare's free, privacy‑friendly alternative to CAPTCHAs. Without it the forms are still protected by a hidden honeypot field, a minimum fill time and a per‑email rate limit.

1. Sign in to the Cloudflare dashboard → **Turnstile → Add widget**.
2. Widget name `Parseus forms`; hostnames `parseus.ai` (and `www.parseus.ai` if used). Widget mode **Managed**.
3. Cloudflare shows a **Site key** and a **Secret key**.
4. **Site key** → website `assets/forms-config.js` → `turnstileSiteKey` (public, safe to commit).
5. **Secret key** → Apps Script **Script Properties** → `TURNSTILE_SECRET`. **Never** put the secret on the website or in Git.
6. Once `TURNSTILE_SECRET` is set, every submission must carry a valid Turnstile token; to turn Turnstile off again, delete the property *and* clear `turnstileSiteKey` on the website.

## 7. Private booking link (Google Calendar appointment schedule)

1. Open Google Calendar with your parseus.ai account → **Create → Appointment schedule**.
2. Title `Parseus AI — complimentary conversation`, duration **20 minutes**, set your availability, buffer time and a maximum bookings per day if you like.
3. Under booking form settings, keep the default fields (name, email); add Google Meet video conferencing.
4. Save, then click **Share → copy the booking page link**.
5. Paste it into Script Property **`BOOKING_URL`**.

**Never publish this link on the website.** It is only sent by email to applicants you select, so only ten people receive it. If it leaks, create a new appointment schedule and update `BOOKING_URL`.

---

## Day‑to‑day workflow

You do everything from the Sheet. New submissions appear as new rows and you get a notification email for each one.

### Consultation applications (tab **Consultations**)

1. **Review**: change Status from **New** to **Under review**; add thoughts in **Reviewer notes**.
2. **Decide**: set Status to **Selected** or **Not selected**. The Sheet will **refuse** a "Selected" that would exceed the cap of 10 places (the cell reverts and a message appears). **Parseus → Show consultation places used** shows how many are allocated.
3. **Send booking links**: **Parseus → Send booking links to Selected applicants**. It emails the private `BOOKING_URL` to every row with Status *Selected* and an empty *Booking link sent at*, asks you to confirm first, then fills *Booking link sent at*, *Decision date* and sets Status to *Booking link sent*. It never sends more than the cap in total and warns about anyone over it. It refuses if `BOOKING_URL` is not set.
4. When the applicant books, set Status **Scheduled** and fill **Conversation date**.
5. After the call set Status **Completed**, then **Parseus → Send consultation follow-ups (Completed)**. This sends one thank‑you email per row and sets Status *Follow-up sent*.
6. People not selected receive nothing automatically. If you wish, reply personally from the notification email.

### Roundtables (tabs **Events** and **Roundtable registrations**)

1. **Edit the event** in the **Events** tab: set the real **Capacity**, and when confirmed the **Start** (date and time, Vancouver time) and **Meeting link (private)**. To add another roundtable, add a row with a new Event ID (e.g. `rt-02`) and give the website the same ID.
2. Registrations arrive as **Registered** until capacity is reached, then **Waitlisted**. If Start is blank, the confirmation says the date and joining details will follow by email. If Start *and* Meeting link are already set, the confirmation includes them.
3. To close registration, untick **Registration open**. Registration also closes automatically once the Start time has passed.
4. **Send details**: once Start and Meeting link are set, **Parseus → Send event details to registrants** emails date/time + link to every *Registered* row without *Details sent at*.
5. **Cancellations**: set the person's Registration status to **Cancelled**, then **Parseus → Promote from waitlist**. It fills the freed places from the waitlist in the order people signed up and emails them.
6. **Reminders**: run **Parseus → Install reminder trigger** once. From then on, every hour the script sends a single reminder (with the joining link) to Registered people for any event starting within the next 24 hours. **Send due reminders now** does the same check immediately.
7. **After the event**: tick **Attended** for those who came, then **Parseus → Send roundtable follow-ups (Attended)**.

Every bulk action checks Google's daily email quota first (Workspace accounts allow about 1,500 recipients per day) and tells you if anything was held back.

---

## Testing

**Automated (developers):** with Node 24, from the repository root run

```
node ops/apps-script/test/harness.mjs
```

It runs Code.gs against mocked Google services and prints a PASS/FAIL summary.

**Live test (after deployment):**

1. Visit the `/exec` URL in a browser → `{"ok":true,"service":"parseus-forms"}`.
2. On the website, submit a consultation with your own email address. Fill the form at a normal pace (submissions faster than 3 seconds are silently ignored as bots). Check: a new row with Status *New*, a confirmation email to you, a notification to `NOTIFY_EMAIL`.
3. Submit a roundtable registration. Check the row and email.
4. Delete your test rows afterwards.

You can also test from a terminal (replace the URL):

```
curl -L -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"form":"roundtable","fields":{"eventId":"rt-01","name":"Test Person","role":"Tester","organization":"Test Org","email":"you@parseus.ai","consent":true},"meta":{"elapsedMs":10000,"page":"/test","turnstileToken":"","website":""}}' \
  "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```

(If Turnstile is enabled, terminal tests return `{"ok":false,"error":"spam"}` — that is expected.)

## Updating the code later (keep the same URL)

1. Paste the new `Code.gs` into the editor and **Save**.
2. **Deploy → Manage deployments** → select the existing web app deployment → **pencil (Edit)**.
3. Under **Version** choose **New version** → **Deploy**.

This keeps the same `/exec` URL, so the website does not need changing. (Choosing *New deployment* instead creates a **different** URL.) Menu changes appear after reloading the Sheet; changes that need new permissions will ask you to authorise again.

---

## Privacy notes

- Submission data lives **only** in this Google Sheet (and in the notification/confirmation emails). Nothing is stored on the website, in GitHub, or by Cloudflare beyond the Turnstile check.
- Keep the Sheet shared only with the people who review applications. Do not use "Anyone with the link".
- The Events tab contains private meeting links — treat it as confidential.
- The confirmation email asks applicants not to send confidential information.
- Anyone can ask to withdraw by replying to their confirmation email; delete their row when they do.
- **Suggested retention clean‑up** (e.g. once per quarter):
  - Consultations marked *Not selected*: delete 6 months after the decision date.
  - Completed consultations: delete or reduce to name/organisation 12 months after the conversation, unless you have an ongoing relationship.
  - Roundtable registrations: delete 6 months after the event, except people who answered **Yes** to *Future updates* (keep name + email only, and remove them on request).
- Rate‑limit counters are kept in Apps Script's cache for at most one hour and contain only a hash of the email address.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Forms don't appear on the website | `endpoint` in `assets/forms-config.js` is empty or the site hasn't been republished. |
| Browser test of `/exec` shows a Google sign‑in page or "access denied" | The deployment's *Who has access* isn't **Anyone**. If **Anyone** is not offered, a Workspace admin must allow it: Admin console → Apps → Google Workspace → Drive and Docs → Sharing settings → allow sharing outside the organisation. |
| Form shows a generic error; nothing in the Sheet | Open Apps Script → **Executions** (left sidebar) to see the error. Most often a tab or column header was renamed — headers must match exactly. Run `setup()` to recreate missing tabs. |
| `{"ok":false,"error":"spam"}` for every real visitor | `TURNSTILE_SECRET` is set but `turnstileSiteKey` on the website is missing or belongs to a different widget, or the site's hostname isn't listed on the Turnstile widget. |
| "This roundtable could not be found" | The website's event ID doesn't match the **Event ID** in the Events tab exactly. |
| Roundtable form says registration is closed | **Registration open** is unticked, or **Start** is in the past. |
| Code edits don't take effect on the website | You saved but didn't redeploy. Use **Manage deployments → Edit → New version**. |
| No **Parseus** menu | Reload the Sheet. If still missing, run `onOpen` once from the editor. |
| "Selected" keeps reverting | The cap of 10 is reached. Check **Show consultation places used**, or raise `CONSULTATION_CAP`. |
| Booking links menu says `BOOKING_URL is not set` | Add it in Script Properties (step 4). |
| Reminders not sent | Run **Install reminder trigger**; check the event has a future **Start** and a **Meeting link**; check Apps Script → **Triggers**. |
| Emails not arriving | Check spam folders; check Apps Script → Executions for quota errors; confirm `NOTIFY_EMAIL` is correct. |
| Someone legitimately submitted several times and got "rate limited" | Each email address can submit each form 3 times per hour. Ask them to wait an hour. |
