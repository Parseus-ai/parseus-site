/* Parseus AI form settings. Public file: never put secrets here.
 *
 * endpoint          The Google Apps Script web app URL (ends in /exec).
 *                   While empty, application and registration forms stay hidden
 *                   and visitors see the email alternative instead.
 *                   Setup guide: ops/apps-script/README.md
 * turnstileSiteKey  Optional Cloudflare Turnstile SITE key (public by design).
 *                   The matching SECRET key belongs only in Apps Script
 *                   Script Properties (TURNSTILE_SECRET).
 */
window.PARSEUS_FORMS = {
  endpoint: "",
  turnstileSiteKey: "",
  timeoutMs: 20000
};
