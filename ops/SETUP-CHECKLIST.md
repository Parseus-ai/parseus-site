# Setup checklist: website forms

A short, step-by-step list for switching on the consultation application form and the roundtable registration form. The full reference, with more detail, is the [forms backend guide](apps-script/README.md).

**Labels used below**

- **Done by Claude Code**: already prepared in this repository, or Claude Code can do it when you ask.
- **Needs your Google account**: only you can do this, signed in to Google.
- **Required** / **Optional**: whether the forms can go live without it.
- **Final activation**: the step that makes the forms public.

**Keep secrets out of chats.** Never paste a password, the Turnstile *secret* key, or the private booking link into a chat, an email or the website. Secrets go in one place only: **Apps Script → Project Settings → Script Properties**. Two things are *not* secret and are fine to share with Claude Code: the web app address ending in `/exec`, and the Turnstile *site* key.

**Already done by Claude Code:** the form code (`ops/apps-script/Code.gs`), its settings file, automated tests, the email wording ([campaign messages](campaign-messages.md)), and the website forms, which stay hidden until step 10.

---

### 1. Create the Google Sheet
*Needs your Google account · Required*

- [ ] Decide which account will run the forms (see step 4). Sign in to Google with it.
- [ ] Create a new blank Google Sheet and name it **Parseus: website submissions (private)**.
- [ ] **File → Settings → Time zone**: choose Vancouver (Pacific Time), the same as the script.
- [ ] Share it only with people who review applications. Anyone who can edit the Sheet can see every applicant's details and the private settings.

Details: [README step 1](apps-script/README.md#1-create-the-sheet)

### 2. Add the Apps Script
*Needs your Google account · Required*

- [ ] In the Sheet: **Extensions → Apps Script**. Name the project **Parseus forms**.
- [ ] Replace the contents of **Code.gs** with the file `ops/apps-script/Code.gs` from this repository, and **Save**.
- [ ] In **Project Settings** (gear icon), tick "Show appsscript.json". Replace that file's contents with `ops/apps-script/appsscript.json`, and **Save**.

Details: [README step 2](apps-script/README.md#2-add-the-script)

### 3. Run setup
*Needs your Google account · Required*

- [ ] In the Apps Script editor, choose **setup** next to **Run**, and click **Run**.
- [ ] Approve the permissions. "Google hasn't verified this app" is normal for your own script: **Advanced → Go to Parseus forms**.
- [ ] Reload the Sheet. You should see three tabs (Consultations, Roundtable registrations, Events) and a **Parseus** menu.

Running setup again later is safe. It never deletes anything.

Details: [README step 3](apps-script/README.md#3-run-setup-once) and the settings list in [README step 4](apps-script/README.md#4-set-script-properties)

### 4. Configure deployment permissions
*Needs your Google account · Required*

- [ ] **Deploy → New deployment → Web app**.
- [ ] **Execute as: Me.** The forms run as this account: they write to your Sheet and send emails from this account. Visitors never get access to the account.
  - **Recommended account:** info@parseus.ai, if it is a real mailbox you can sign in to. Emails then come from info@parseus.ai and nothing depends on one person.
  - If info@parseus.ai is only a group or alias, use your own parseus.ai account. Emails then show your address with the name "Parseus AI", and replies go to info@parseus.ai.
  - Use the same account for steps 1 to 5.
- [ ] **Who has access: Anyone.** This lets website visitors send the form without signing in to Google. It does not let anyone see the Sheet, the settings or the code. If "Anyone" is not offered, the Workspace admin needs to allow it (see the README troubleshooting table).
- [ ] Click **Deploy** and copy the web app address (it ends in `/exec`). Open it in a browser: you should see `{"ok":true,"service":"parseus-forms"}`.
- [ ] Do **not** put this address on the website yet.

Details: [README step 5](apps-script/README.md#5-deploy-as-a-web-app)

### 5. Set up the private booking calendar
*Needs your Google account · Required before sending booking links*

- [ ] In Google Calendar (same account): **Create → Appointment schedule**.
- [ ] Title: **Parseus AI: complimentary AI strategy conversation**. Length: **20 minutes**.
- [ ] Set your available times, a **buffer** between meetings (for example 10 minutes), and a **maximum number of bookings per day**.
- [ ] Booking form: keep name and email. If offered, turn on email verification for people booking. Add **Google Meet**. Check the confirmation and reminder email options.
- [ ] **Keep it unlisted:** do not add the link to the website, your email signature, or any public page.
- [ ] Copy the booking page link and paste it in **Apps Script → Project Settings → Script Properties** as **BOOKING_URL**. Nowhere else.
- [ ] If the link ever leaks, make a new appointment schedule, replace BOOKING_URL, and delete the old schedule.

Details: [README step 7](apps-script/README.md#7-private-booking-link-google-calendar-appointment-schedule)

### 6. Enter a real roundtable date and capacity
*Needs your Google account · Required before announcing a date*

- [ ] In the Sheet's **Events** tab, row **rt-01**: change **Capacity** from the placeholder 25 to the real number of places.
- [ ] When the date is confirmed: create a Google Calendar event for the roundtable with **Google Meet**, and copy its Meet link.
- [ ] Enter **Start** (date and time) and paste the Meet link in **Meeting link (private)**.
- [ ] In Google Meet, turn on host controls so that people from outside parseus.ai must ask to join, and you admit them. (Everyone who registers gets the link, and links can be forwarded.)
- [ ] If people registered before the date was set: **Parseus → Send event details to registrants**.

Registration can stay open without a date: people are told the date and link will follow.

Details: [README roundtables workflow](apps-script/README.md#roundtables-tabs-events-and-roundtable-registrations)

### 7. Turn on Turnstile spam protection
*Needs your Cloudflare account · Required before Final activation*

Without this, anyone could use the forms to make parseus.ai send emails to addresses they type in, which can harm email delivery for the whole domain. The forms also have built-in limits, but Turnstile is the main protection.

- [ ] In the Cloudflare dashboard: **Turnstile → Add widget**. Name **Parseus forms**, hostnames **parseus.ai** and **www.parseus.ai**, mode **Managed**.
- [ ] Note where to find the **Site key** and **Secret key** in Cloudflare. You will use them in step 10, after testing.

Details: [README step 6](apps-script/README.md#6-cloudflare-turnstile-spam-protection)

### 8. Test the application form end to end
*Needs your Google account · Required · Claude Code can help*

Adding `?preview=forms` to a page only *shows* the forms; nothing is sent. That is not an end-to-end test. Test with the real backend on your own computer, before anything is public:

- [ ] Ask Claude Code: *"Put the /exec address into forms-config.js on my computer only, do not commit, and start the local preview."* (Claude Code runs `python -m http.server 8765` for you.) The /exec address is fine to share; it is not a secret.
- [ ] Open `http://localhost:8765/beyond-ai-headlines/conversations/` and apply with your own email. Take at least a few seconds (very fast submissions are ignored as bots).
- [ ] Check: a new row in **Consultations** with Status **New**; the "We received your application" email in your inbox; a notification at info@parseus.ai.
- [ ] Apply again with the same email: same reference shown, no new row, no second email.
- [ ] Set your test row to **Selected**, run **Parseus → Send booking links to Selected applicants**, and check the email and the booking link.
- [ ] On two more test rows, try **Not selected** and **Held for later round**, then **Parseus → Send decision notices**.
- [ ] Book a slot with the link and check that Google Calendar sends the confirmation.

Details: [README step 8](apps-script/README.md#8-test-before-activation)

### 9. Test registration and confirmation messages, including the waitlist
*Needs your Google account · Required*

- [ ] Open `http://localhost:8765/beyond-ai-headlines/roundtables/` and register with your own email. Check the row and the confirmation email.
- [ ] Set the event's **Capacity** to **1**. Register with a second address of yours: you should get the **waitlist** email.
- [ ] Mark the first registration **Cancelled** and run **Parseus → Promote from waitlist**: the second address should get "A place has opened".
- [ ] Set **Capacity** back to the real number.
- [ ] Run **Parseus → Check setup** and read the summary.
- [ ] Delete all test rows. Ask Claude Code to stop the local preview and undo the local forms-config.js change.

### 10. Activate the public forms
*Final activation · Needs your Google account and your approval*

Only after steps 8 and 9 worked:

- [ ] In **Script Properties**, add **TURNSTILE_SECRET** (the Cloudflare *secret* key; paste it there yourself, never in a chat) and change **REQUIRE_TURNSTILE** to **true**.
- [ ] Run **Parseus → Check setup**: it should say "No problems found".
- [ ] Run **Parseus → Install reminder trigger** (sends roundtable reminders automatically).
- [ ] Ask Claude Code to put the /exec address and the Turnstile **site** key into `assets/forms-config.js` and prepare a commit. Review it, then approve the push. The forms appear on parseus.ai once the site is published.
- [ ] On parseus.ai, submit one application and one registration with your own email and check the Sheet and emails. Delete those rows afterwards.
- [ ] If anything goes wrong, ask Claude Code to clear the endpoint and publish again: the forms hide and visitors see the email option instead.

Day-to-day use (reviewing, sending links, reminders, follow-ups, data clean-up) is described in the [README workflow section](apps-script/README.md#day-to-day-workflow).
