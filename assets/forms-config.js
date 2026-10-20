/* Parseus AI form settings. Public file: never put secrets or private links here.
 *
 * endpoint          The Google Apps Script web app URL (ends in /exec).
 *                   While empty, the forms stay hidden and visitors see the
 *                   email alternative. Setup: ops/SETUP-CHECKLIST.md
 * turnstileSiteKey  Optional Cloudflare Turnstile SITE key (public by design).
 *                   The SECRET key goes only in Apps Script Script Properties.
 *
 * consultation.open    false = show "Applications are currently closed".
 * consultation.period  Optional public text about the current round, e.g. the
 *                      dates you are accepting applications. Leave "" for none.
 *                      Only enter dates you have decided.
 *
 * roundtable          What the roundtable page SAYS. The private Google Sheet
 *                     (Events tab) decides what the backend DOES. Update both
 *                     together (see ops/SETUP-CHECKLIST.md).
 *   status   "interest"  date not confirmed: "Register your interest" (no place reserved)
 *            "open"      date confirmed: "Register" (places confirmed by email)
 *            "closed"    registration closed
 *   dateText / timeZone  Shown on the page once confirmed, e.g. "Thursday, 12 November 2026, 9:00 to 10:00 AM" / "Pacific Time (Vancouver)".
 */
window.PARSEUS_FORMS = {
  endpoint: "",
  turnstileSiteKey: "",
  timeoutMs: 20000,
  consultation: {
    open: true,
    period: ""
  },
  roundtable: {
    eventId: "rt-01",
    title: "From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?",
    status: "interest",
    dateText: "",
    timeZone: ""
  }
};
