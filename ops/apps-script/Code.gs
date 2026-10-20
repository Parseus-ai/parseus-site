/**
 * Parseus AI: website forms backend (Google Apps Script, V8).
 *
 * Bound to a private Google Sheet. Receives the consultation application and
 * roundtable registration forms from the static website, stores them in the
 * Sheet, and sends plain-text emails. A "Parseus" menu in the Sheet drives the
 * day-to-day review workflow.
 *
 * No secrets live in this file. Configuration is read from Script Properties
 * (Apps Script editor > Project Settings > Script properties):
 *   NOTIFY_EMAIL                  where new-submission notifications go (default info@parseus.ai)
 *   BOOKING_URL                   private appointment-schedule link (never on the website)
 *   TURNSTILE_SECRET              Cloudflare Turnstile secret key
 *   REQUIRE_TURNSTILE             "true" = refuse all submissions unless TURNSTILE_SECRET is set
 *   TURNSTILE_HOSTNAMES           optional comma list, e.g. "parseus.ai,www.parseus.ai"
 *   CONSULTATION_CAP              number of complimentary conversations (default 10)
 *   SENDER_NAME                   "From" display name (default "Parseus AI")
 *   MAX_SUBMISSIONS_PER_10_MIN    global limit on stored submissions (default 20)
 *   MAX_SUBMISSIONS_PER_DAY       global limit on stored submissions per rolling 24 h (default 100)
 *   DUPLICATE_WINDOW_DAYS         repeat consultation applications from one email are not stored (default 30)
 *   PRIVACY_NOTICE_VERSION        recorded with each submission (default "October 2026")
 *   RETENTION_NOT_SELECTED_MONTHS / RETENTION_COMPLETED_MONTHS / RETENTION_ROUNDTABLE_MONTHS
 *                                 used by the "Apply data retention" menu (defaults 6 / 12 / 6)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHEETS = {
  consult: 'Consultations',
  reg: 'Roundtable registrations',
  events: 'Events',
};

// New columns are only ever appended at the end, so existing Sheets keep working;
// setup() adds any that are missing.
const HEADERS = {
  consult: ['Submitted at', 'Ref', 'Name', 'Role', 'Organization', 'Email', 'Area',
    'Challenge', 'Desired outcome', 'Stage', 'Status', 'Reviewer notes', 'Decision date',
    'Booking link sent at', 'Conversation date', 'Follow-up sent at',
    'Decision sent at', 'Consent given at', 'Privacy notice version', 'Last email error', 'Anonymised at'],
  reg: ['Submitted at', 'Ref', 'Event ID', 'Name', 'Role', 'Organization', 'Email',
    'Question', 'Future updates', 'Registration status', 'Details sent at',
    'Reminder sent at', 'Attended', 'Follow-up sent at',
    'Consent given at', 'Privacy notice version', 'Last email error', 'Anonymised at'],
  events: ['Event ID', 'Title', 'Start', 'Duration (min)', 'Capacity',
    'Registration open', 'Meeting link (private)', 'Notes'],
};

const DATE_COLUMNS = {
  consult: ['Submitted at', 'Decision date', 'Booking link sent at', 'Conversation date',
    'Follow-up sent at', 'Decision sent at', 'Consent given at', 'Anonymised at'],
  reg: ['Submitted at', 'Details sent at', 'Reminder sent at', 'Follow-up sent at',
    'Consent given at', 'Anonymised at'],
  events: ['Start'],
};

const CONSULT_STATUSES = ['New', 'Under review', 'Selected', 'Not selected', 'Held for later round',
  'Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
// Statuses that use up one of the complimentary conversation places.
const CAP_STATUSES = ['Selected', 'Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
// Statuses meaning the booking link has already gone out.
const SENT_STATUSES = ['Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
// Statuses that receive a "decision" notice (template 4 / 4b).
const DECISION_STATUSES = ['Not selected', 'Held for later round'];
// Rows in these statuses are never touched by the retention clean-up.
const ACTIVE_STATUSES = ['Selected', 'Booking link sent', 'Scheduled'];
const REG_STATUSES = ['Registered', 'Waitlisted', 'Cancelled'];

const AREAS = ['Enterprise AI and agentic AI', 'Physical AI and robotics',
  'Manufacturing and industrial automation', 'Intelligent systems and computer vision',
  'Enterprise architecture and operating models', 'Strategy, implementation and scaling', 'Other'];
const STAGES = ['Exploring ideas', 'Defining a use case', 'Planning a pilot',
  'Pilot underway', 'Scaling to production', 'Operating in production'];

const SIGNATURE = 'Parseus AI · Beyond AI Headlines';
const SIGNATURE_EMAIL = 'info@parseus.ai';
const SERIES = 'Beyond AI Headlines';
const REMOVED = '[removed]';

const MIN_ELAPSED_MS = 3000;       // faster than this = bot
const RATE_LIMIT = 3;              // max submissions per email, per form, per hour
const RATE_WINDOW_S = 3600;
const MAX_BODY_CHARS = 20000;
const LOCK_WAIT_MS = 15000;
const MAX_BATCH = 50;              // emails per menu run (keeps well inside the 6-minute limit)
const TIME_BUDGET_MS = 4.5 * 60 * 1000;
const ALERT_INTERVAL_MS = 6 * 3600 * 1000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$/;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || String(v).trim() === '') ? fallback : String(v).trim();
}

function intProp_(key, fallback, min, max) {
  const n = parseInt(prop_(key, String(fallback)), 10);
  if (isNaN(n) || n < min) return fallback;
  return Math.min(n, max);
}

function config_() {
  return {
    notifyEmail: prop_('NOTIFY_EMAIL', 'info@parseus.ai'),
    bookingUrl: prop_('BOOKING_URL', ''),
    turnstileSecret: prop_('TURNSTILE_SECRET', ''),
    requireTurnstile: prop_('REQUIRE_TURNSTILE', 'false').toLowerCase() === 'true',
    turnstileHosts: prop_('TURNSTILE_HOSTNAMES', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    cap: intProp_('CONSULTATION_CAP', 10, 0, 1000),
    senderName: prop_('SENDER_NAME', 'Parseus AI').replace(/[\r\n"<>]/g, ' ').slice(0, 60),
    maxPer10Min: intProp_('MAX_SUBMISSIONS_PER_10_MIN', 20, 1, 500),
    maxPerDay: intProp_('MAX_SUBMISSIONS_PER_DAY', 100, 1, 500),
    duplicateDays: intProp_('DUPLICATE_WINDOW_DAYS', 30, 0, 3650),
    noticeVersion: prop_('PRIVACY_NOTICE_VERSION', 'October 2026').slice(0, 60),
  };
}

// The bound spreadsheet; falls back to the ID saved by setup().
function ss_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = prop_('SPREADSHEET_ID', '');
  if (!id) throw new Error('Spreadsheet not found. Run setup() from the bound Sheet.');
  return SpreadsheetApp.openById(id);
}

function sheet_(key) {
  const sh = ss_().getSheetByName(SHEETS[key]);
  if (!sh) throw new Error('Missing tab: ' + SHEETS[key] + '. Run setup().');
  return sh;
}

// ---------------------------------------------------------------------------
// Logging (never log applicant data)
// ---------------------------------------------------------------------------

function redact_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, '[email]')
    .slice(0, 500);
}

function errText_(err) {
  return redact_(err && err.stack ? err.stack : err);
}

/** Emails the owner about an operational problem, at most once per 6 hours per kind. Never throws. */
function alertOwner_(kind, message) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'ALERT_AT_' + kind;
    const last = parseInt(props.getProperty(key) || '0', 10) || 0;
    if (Date.now() - last < ALERT_INTERVAL_MS) return;
    props.setProperty(key, String(Date.now()));
    if (MailApp.getRemainingDailyQuota() < 1) return;
    const cfg = config_();
    send_(cfg.notifyEmail, 'Parseus forms: action needed (' + kind + ')',
      message + '\n\nThis alert is sent at most once every 6 hours. Details: Apps Script editor > Executions.', cfg);
  } catch (err) {
    console.error('alertOwner_ failed: ' + errText_(err));
  }
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

/** Health check. Returns no data and ignores all parameters. */
function doGet() {
  return json_({ ok: true, service: 'parseus-forms' });
}

/** Form submissions. Never leaks internal errors to the caller. */
function doPost(e) {
  try {
    const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BODY_CHARS) return json_({ ok: false, error: 'bad_request' });

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return json_({ ok: false, error: 'bad_request' });
    }
    if (!isObj_(payload) || !isObj_(payload.fields) || !isObj_(payload.meta)) {
      return json_({ ok: false, error: 'bad_request' });
    }
    const form = payload.form;
    if (form !== 'consultation' && form !== 'roundtable') return json_({ ok: false, error: 'bad_request' });
    const meta = payload.meta;
    if (typeof meta.elapsedMs !== 'number' || !isFinite(meta.elapsedMs)) {
      return json_({ ok: false, error: 'bad_request' });
    }

    // Bots: honeypot filled or submitted implausibly fast. Pretend success, store nothing.
    const honeypot = meta.website;
    if ((honeypot !== undefined && honeypot !== null && String(honeypot).trim() !== '') ||
        meta.elapsedMs < MIN_ELAPSED_MS) {
      return json_({ ok: true, status: 'received', ref: makeRef_(form === 'consultation' ? 'C' : 'R') });
    }

    return form === 'consultation'
      ? handleConsultation_(payload.fields, meta, form)
      : handleRoundtable_(payload.fields, meta, form);
  } catch (err) {
    console.error('doPost failed: ' + errText_(err));
    alertOwner_('form-error', 'A website form submission failed with an internal error, so the visitor saw an error message. ' +
      'Common causes: a tab or column header in the Sheet was renamed or deleted (run setup() again), or a Google quota was reached.');
    return json_({ ok: false, error: 'server' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isObj_(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function makeRef_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

/** Turnstile, then the "must Turnstile be configured?" guard. Returns an error code or null. */
function checkHuman_(meta, form, cfg) {
  if (!cfg.turnstileSecret) {
    if (cfg.requireTurnstile) {
      alertOwner_('turnstile-missing', 'REQUIRE_TURNSTILE is "true" but TURNSTILE_SECRET is not set, so every website submission is being refused. ' +
        'Add TURNSTILE_SECRET in Script Properties (or set REQUIRE_TURNSTILE to false while testing).');
      return 'unavailable';
    }
    return null;
  }
  return verifyTurnstile_(meta, form, cfg);
}

// ---------------------------------------------------------------------------
// Consultation applications
// ---------------------------------------------------------------------------

function handleConsultation_(fields, meta, form) {
  const v = validateConsultation_(fields);
  if (v.errors) return json_({ ok: false, error: 'validation', fields: v.errors });

  const cfg = config_();
  const human = checkHuman_(meta, form, cfg);
  if (human) return json_({ ok: false, error: human });

  const email = v.data.email;
  let ref;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Could not obtain lock');
  try {
    if (isRateLimited_('consultation', email)) return json_({ ok: false, error: 'rate_limited' });
    const sh = sheet_('consult');
    const t = readTable_(sh);

    // Repeat application from the same email within the window: answer exactly as
    // for a new one, but store nothing and send nothing (stops repeat emails to one inbox).
    const existing = findRecentConsultation_(t, email, cfg.duplicateDays);
    if (existing) {
      recordSubmission_('consultation', email);
      return json_({ ok: true, status: 'received', ref: existing });
    }

    if (!takeGlobalSlot_(cfg)) return json_({ ok: false, error: 'busy' });

    ref = makeRef_('C');
    const now = new Date();
    sh.appendRow(buildRow_(t, {
      'Submitted at': now,
      'Ref': ref,
      'Name': v.data.name,
      'Role': v.data.role,
      'Organization': v.data.organization,
      'Email': email,
      'Area': v.data.area,
      'Challenge': v.data.challenge,
      'Desired outcome': v.data.outcome,
      'Stage': v.data.stage,
      'Status': 'New',
      'Consent given at': now,
      'Privacy notice version': cfg.noticeVersion,
    }));
    applyRowValidation_(t, 'consult', sh.getLastRow());
    recordSubmission_('consultation', email);
  } finally {
    lock.releaseLock();
  }

  // Emails are best-effort: the submission is already safely stored.
  const msg = consultReceivedEmail_(v.data.name, ref, cfg);
  safeSend_(email, msg.subject, msg.body, cfg);
  safeSend_(cfg.notifyEmail, 'New consultation application ' + ref + ': ' + v.data.organization.slice(0, 80),
    notifyBody_('consultation application', ref, [
      ['Name', v.data.name], ['Role', v.data.role], ['Organization', v.data.organization],
      ['Email', email], ['Area', v.data.area], ['Stage', v.data.stage],
      ['Challenge', v.data.challenge], ['Desired outcome', v.data.outcome],
      ['Page', cleanText_(strOrEmpty_(meta.page), false).slice(0, 200)],
    ]), cfg);

  return json_({ ok: true, status: 'received', ref: ref });
}

function validateConsultation_(f) {
  const errors = {};
  const data = {};
  data.name = textField_(f, 'name', 2, 120, true, errors);
  data.role = textField_(f, 'role', 2, 120, true, errors);
  data.organization = textField_(f, 'organization', 2, 160, true, errors);
  data.email = emailField_(f, errors);
  data.area = enumField_(f, 'area', AREAS, errors);
  data.challenge = textField_(f, 'challenge', 30, 2000, true, errors, true);
  data.outcome = textField_(f, 'outcome', 10, 1000, true, errors, true);
  data.stage = enumField_(f, 'stage', STAGES, errors);
  if (f.consent !== true) errors.consent = 'Please confirm your consent so we can process your application.';
  return Object.keys(errors).length ? { errors: errors } : { data: data };
}

/** Ref of a non-anonymised application from this email within the last `days` days, or null. */
function findRecentConsultation_(t, email, days) {
  if (!days) return null;
  const cutoff = Date.now() - days * 86400000;
  const cE = t.idx['Email'], cT = t.idx['Submitted at'], cR = t.idx['Ref'];
  const target = email.toLowerCase();
  for (let i = t.rows.length - 1; i >= 0; i--) {
    const r = t.rows[i];
    if (isAnon_(t, r)) continue;
    if (unsafe_(r[cE]).trim().toLowerCase() !== target) continue;
    if (toTime_(r[cT]) >= cutoff) return String(r[cR] || '') || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Roundtable registrations
// ---------------------------------------------------------------------------

function handleRoundtable_(fields, meta, form) {
  const v = validateRoundtable_(fields);
  if (v.errors) return json_({ ok: false, error: 'validation', fields: v.errors });

  const event = getEvent_(v.data.eventId);
  if (!event) {
    return json_({ ok: false, error: 'validation', fields: { eventId: 'This roundtable could not be found. Please refresh the page and try again.' } });
  }
  if (!isEventOpen_(event)) return json_({ ok: false, error: 'closed' });

  const cfg = config_();
  const human = checkHuman_(meta, form, cfg);
  if (human) return json_({ ok: false, error: human });

  const email = v.data.email;
  let status, ref;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Could not obtain lock');
  try {
    if (isRateLimited_('roundtable', email)) return json_({ ok: false, error: 'rate_limited' });

    const sh = sheet_('reg');
    const t = readTable_(sh);
    const cEvent = t.idx['Event ID'], cEmail = t.idx['Email'], cStatus = t.idx['Registration status'], cRef = t.idx['Ref'];

    // Duplicate (same email + event, not cancelled): return the existing status, send nothing.
    let registered = 0;
    for (const row of t.rows) {
      if (String(row[cEvent]) !== event.id) continue;
      const st = String(row[cStatus]);
      if (st === 'Cancelled') continue;
      if (!isAnon_(t, row) && unsafe_(row[cEmail]).trim().toLowerCase() === email.toLowerCase()) {
        recordSubmission_('roundtable', email);
        return json_({ ok: true, status: st === 'Waitlisted' ? 'waitlisted' : 'registered', ref: String(row[cRef]) });
      }
      if (st === 'Registered') registered++;
    }

    if (!takeGlobalSlot_(cfg)) return json_({ ok: false, error: 'busy' });

    status = registered < event.capacity ? 'Registered' : 'Waitlisted';
    ref = makeRef_('R');
    const now = new Date();
    sh.appendRow(buildRow_(t, {
      'Submitted at': now,
      'Ref': ref,
      'Event ID': event.id,
      'Name': v.data.name,
      'Role': v.data.role,
      'Organization': v.data.organization,
      'Email': email,
      'Question': v.data.question,
      'Future updates': v.data.updates ? 'Yes' : 'No',
      'Registration status': status,
      // The confirmation itself carries the joining link when Start and link are both set.
      'Details sent at': status === 'Registered' && event.start && event.link ? now : '',
      'Attended': false,
      'Consent given at': now,
      'Privacy notice version': cfg.noticeVersion,
    }));
    applyRowValidation_(t, 'reg', sh.getLastRow());
    recordSubmission_('roundtable', email);
  } finally {
    lock.releaseLock();
  }

  const msg = status === 'Registered'
    ? registeredEmail_(v.data.name, event, ref)
    : waitlistedEmail_(v.data.name, event, ref);
  safeSend_(email, msg.subject, msg.body, cfg);
  safeSend_(cfg.notifyEmail, 'Roundtable registration ' + ref + ' (' + status + '): ' + event.id,
    notifyBody_('roundtable registration', ref, [
      ['Event', event.id + ': ' + event.title], ['Status', status],
      ['Name', v.data.name], ['Role', v.data.role], ['Organization', v.data.organization],
      ['Email', email], ['Question', v.data.question || '(none)'],
      ['Future updates', v.data.updates ? 'Yes' : 'No'],
      ['Page', cleanText_(strOrEmpty_(meta.page), false).slice(0, 200)],
    ]), cfg);

  return json_({ ok: true, status: status === 'Registered' ? 'registered' : 'waitlisted', ref: ref });
}

function validateRoundtable_(f) {
  const errors = {};
  const data = {};
  data.eventId = textField_(f, 'eventId', 1, 60, true, errors);
  data.name = textField_(f, 'name', 2, 120, true, errors);
  data.role = textField_(f, 'role', 2, 120, true, errors);
  data.organization = textField_(f, 'organization', 2, 160, true, errors);
  data.email = emailField_(f, errors);
  data.question = textField_(f, 'question', 0, 1000, false, errors, true);
  if (f.updates !== undefined && f.updates !== null && typeof f.updates !== 'boolean') {
    errors.updates = 'Please choose yes or no.';
  }
  data.updates = f.updates === true;
  if (f.consent !== true) errors.consent = 'Please confirm your consent so we can process your registration.';
  return Object.keys(errors).length ? { errors: errors } : { data: data };
}

// Events tab lookup. Blank capacity = no limit.
function readEvents_() {
  const t = readTable_(sheet_('events'));
  return t.rows.filter(r => String(r[t.idx['Event ID']]).trim() !== '').map(r => {
    const cap = parseInt(r[t.idx['Capacity']], 10);
    const open = r[t.idx['Registration open']];
    const start = r[t.idx['Start']];
    return {
      id: String(r[t.idx['Event ID']]).trim(),
      title: String(r[t.idx['Title']] || '').trim(),
      start: isDate_(start) && !isNaN(start.getTime()) ? start : null,
      duration: parseInt(r[t.idx['Duration (min)']], 10) || null,
      capacity: isNaN(cap) ? Infinity : cap,
      open: open === true || String(open).toUpperCase() === 'TRUE',
      link: String(r[t.idx['Meeting link (private)']] || '').trim(),
    };
  });
}

function getEvent_(id) {
  return readEvents_().find(ev => ev.id === id) || null;
}

// Open = checkbox ticked and the event has not already started.
function isEventOpen_(ev) {
  if (!ev.open) return false;
  if (ev.start && ev.start.getTime() <= Date.now()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const LABELS = {
  name: 'name', role: 'role', organization: 'organization', email: 'email',
  challenge: 'challenge', outcome: 'desired outcome', question: 'question', eventId: 'roundtable',
};

// Invisible / direction-changing characters that can disguise text.
const INVISIBLE_RE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Normalises user text: Unicode NFC, no control or invisible characters.
 * Single-line fields also collapse all whitespace (including newlines) to one space.
 */
function cleanText_(raw, multiline) {
  let v = String(raw);
  try { v = v.normalize('NFC'); } catch (err) { /* keep as is */ }
  v = v.replace(/\r\n?/g, '\n').replace(INVISIBLE_RE, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, ' ');
  if (multiline) {
    v = v.replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    v = v.replace(/\s+/g, ' ');
  }
  return v.trim();
}

function textField_(f, key, min, max, required, errors, multiline) {
  const raw = f[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors[key] = 'Please enter your ' + LABELS[key] + '.';
    return '';
  }
  if (typeof raw !== 'string') {
    errors[key] = 'Please enter your ' + LABELS[key] + ' as text.';
    return '';
  }
  if (raw.length > max * 4) {
    errors[key] = 'Please keep this to ' + max + ' characters or fewer.';
    return '';
  }
  const v = cleanText_(raw, !!multiline);
  if (!v) {
    if (required) errors[key] = 'Please enter your ' + LABELS[key] + '.';
    return '';
  }
  if (v.length < min) errors[key] = 'Please enter at least ' + min + ' characters.';
  else if (v.length > max) errors[key] = 'Please keep this to ' + max + ' characters or fewer.';
  return v;
}

// One plain ASCII address only: no display names, lists, comments or invisible characters.
function emailField_(f, errors) {
  const raw = f.email;
  if (typeof raw !== 'string' || !raw.trim()) {
    errors.email = 'Please enter your email address.';
    return '';
  }
  const v = raw.trim();
  if (v.length > 254 || !EMAIL_RE.test(v) || v.split('@')[0].length > 64) {
    errors.email = 'Please enter a valid email address.';
  }
  return v;
}

function enumField_(f, key, allowed, errors) {
  const raw = typeof f[key] === 'string' ? f[key].trim() : '';
  if (!raw) {
    errors[key] = 'Please choose an option.';
    return '';
  }
  if (allowed.indexOf(raw) === -1) errors[key] = 'Please choose one of the listed options.';
  return raw;
}

function strOrEmpty_(v) {
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// Spam and abuse protection
// ---------------------------------------------------------------------------

// Returns null when OK, otherwise 'spam'.
function verifyTurnstile_(meta, form, cfg) {
  const token = typeof meta.turnstileToken === 'string' ? meta.turnstileToken.trim() : '';
  if (!token || token.length > 2048) return 'spam';
  const res = UrlFetchApp.fetch(TURNSTILE_VERIFY_URL, {
    method: 'post',
    payload: { secret: cfg.turnstileSecret, response: token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return 'spam';
  let body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (err) {
    return 'spam';
  }
  if (!body || body.success !== true) return 'spam';
  // The website renders the widget with action = form name.
  if (typeof body.action === 'string' && body.action && body.action !== form) return 'spam';
  if (cfg.turnstileHosts.length && cfg.turnstileHosts.indexOf(String(body.hostname || '').toLowerCase()) === -1) return 'spam';
  return null;
}

function rateKey_(form, email) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email.trim().toLowerCase());
  return 'rl:' + form + ':' + Utilities.base64EncodeWebSafe(digest);
}

function recentSubmissions_(key) {
  const cached = CacheService.getScriptCache().get(key);
  let list = [];
  try {
    list = cached ? JSON.parse(cached) : [];
  } catch (err) {
    list = [];
  }
  const cutoff = Date.now() - RATE_WINDOW_S * 1000;
  return Array.isArray(list) ? list.filter(ts => typeof ts === 'number' && ts > cutoff) : [];
}

function isRateLimited_(form, email) {
  return recentSubmissions_(rateKey_(form, email)).length >= RATE_LIMIT;
}

function recordSubmission_(form, email) {
  const key = rateKey_(form, email);
  const list = recentSubmissions_(key);
  list.push(Date.now());
  CacheService.getScriptCache().put(key, JSON.stringify(list), RATE_WINDOW_S);
}

/**
 * Global limit on stored submissions (both forms together), independent of the
 * email address used. Each stored submission sends two emails, so this caps how
 * many messages anonymous visitors can cause the account to send. Must be called
 * while holding the script lock. Returns false when the limit is reached.
 */
function takeGlobalSlot_(cfg) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let list = [];
  try { list = JSON.parse(props.getProperty('THROTTLE_LOG') || '[]'); } catch (err) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.filter(ts => typeof ts === 'number' && ts > now - 86400000);
  const last10 = list.filter(ts => ts > now - 600000).length;
  if (last10 >= cfg.maxPer10Min || list.length >= cfg.maxPerDay) {
    alertOwner_('submission-limit', 'The website forms reached the global submission limit (' + cfg.maxPer10Min +
      ' per 10 minutes / ' + cfg.maxPerDay + ' per 24 hours). New submissions are being refused with a generic error, ' +
      'and no emails are sent for them. This may be a spam attack. Check the latest rows in the Sheet. ' +
      'Limits are set by MAX_SUBMISSIONS_PER_10_MIN and MAX_SUBMISSIONS_PER_DAY in Script Properties.');
    return false;
  }
  list.push(now);
  props.setProperty('THROTTLE_LOG', JSON.stringify(list));
  return true;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function readTable_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i; });
  return { sheet: sh, headers: headers, idx: idx, rows: values.slice(1) };
}

function col_(t, name) {
  if (!(name in t.idx)) throw new Error('Missing column "' + name + '" in ' + t.sheet.getName());
  return t.idx[name] + 1;
}

// Build a row array in header order, sanitising user text.
function buildRow_(t, obj) {
  return t.headers.map(h => (h in obj ? safe_(obj[h]) : ''));
}

// Formula-injection guard: text starting with = + - @ (or tab/CR) is stored as literal text.
function safe_(v) {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function unsafe_(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function isBlank_(v) {
  return v === '' || v === null || v === undefined;
}

function cell_(t, rowIndex, name) {
  return name in t.idx ? t.rows[rowIndex][t.idx[name]] : '';
}

function isAnon_(t, row) {
  return 'Anonymised at' in t.idx && !isBlank_(row[t.idx['Anonymised at']]);
}

function setCell_(t, rowIndex, name, value) {
  // rowIndex is the 0-based index into t.rows; sheet row = rowIndex + 2.
  t.sheet.getRange(rowIndex + 2, col_(t, name)).setValue(value);
  t.rows[rowIndex][t.idx[name]] = value;
}

// Like setCell_, but silently skips columns an older Sheet does not have yet.
function setCellIf_(t, rowIndex, name, value) {
  if (name in t.idx) setCell_(t, rowIndex, name, value);
}

// Dropdowns / checkboxes on a freshly appended row (in case it is past the pre-formatted range).
// Cosmetic only: a failure here must not turn an already stored submission into an error.
function applyRowValidation_(t, key, row) {
  try {
    applyRowValidationUnsafe_(t, key, row);
  } catch (err) {
    console.warn('Row validation skipped: ' + errText_(err));
  }
}

function applyRowValidationUnsafe_(t, key, row) {
  if (key === 'consult') {
    t.sheet.getRange(row, col_(t, 'Status')).setDataValidation(listRule_(CONSULT_STATUSES));
  } else if (key === 'reg') {
    t.sheet.getRange(row, col_(t, 'Registration status')).setDataValidation(listRule_(REG_STATUSES));
    t.sheet.getRange(row, col_(t, 'Attended')).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

function listRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
}

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

function send_(to, subject, body, cfg) {
  if (!EMAIL_RE.test(String(to))) throw new Error('Invalid recipient');
  MailApp.sendEmail(to, String(subject).replace(/[\r\n\t]+/g, ' ').slice(0, 200), body,
    { name: cfg.senderName, replyTo: cfg.notifyEmail });
}

// Best-effort send for transactional emails: never fails the request.
function safeSend_(to, subject, body, cfg) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      console.warn('Mail quota exhausted; an email was not sent.');
      alertOwner_('mail-quota', 'The daily email quota is used up. Confirmation emails are not being sent until it resets.');
      return false;
    }
    send_(to, subject, body, cfg);
    return true;
  } catch (err) {
    console.error('Email failed: ' + errText_(err && err.message ? err.message : err));
    return false;
  }
}

function formatWhen_(date, durationMin) {
  const tz = Session.getScriptTimeZone();
  let s = Utilities.formatDate(date, tz, "EEEE, MMMM d, yyyy 'at' h:mm a z");
  if (durationMin) s += ' (' + durationMin + ' minutes)';
  return s;
}

/**
 * Greeting line. The name is used only when it looks like a plain personal name,
 * so the automatic emails cannot be used to deliver someone else's text or links.
 */
function hello_(name) {
  const n = cleanText_(unsafe_(name || ''), false);
  const plain = /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u.test(n) &&
    n.length <= 40 && n.split(' ').length <= 5 &&
    !/[\p{L}\p{N}]\.[\p{L}]{2,}/u.test(n) && !/^www\b/i.test(n);
  return plain ? 'Hello ' + n + ',' : 'Hello,';
}

function sign_() {
  return '\n\nWarm regards,\n' + SIGNATURE + '\n' + SIGNATURE_EMAIL;
}

function capWords_(n) {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  return n >= 0 && n < w.length ? w[n] : String(n);
}

function refText_(ref) {
  return ref ? ' (' + ref + ')' : '';
}

function rtTitle_(ev) {
  return ev && ev.title ? 'the ' + SERIES + ' roundtable "' + ev.title + '"' : 'the ' + SERIES + ' roundtable';
}

function rtSubjectTitle_(ev) {
  return ev && ev.title ? ev.title : SERIES + ' roundtable';
}

// "When / Joining link" block shared by confirmation and promotion emails.
function whenBlock_(ev) {
  if (!ev || !ev.start) {
    return 'The date and joining details have not been confirmed yet. We will email them to you as soon as they are set.\n\n';
  }
  let s = 'When: ' + formatWhen_(ev.start, ev.duration) + '\n';
  if (ev.link) {
    s += 'Joining link: ' + ev.link + '\n\nPlease keep this link to yourself, as it is for registered participants only.\n\n';
  } else {
    s += 'Joining link: we will email it to you before the session.\n\n';
  }
  return s;
}

const ROUNDTABLE_INVITE = 'You are warmly invited to join one of our monthly ' + SERIES +
  ' roundtables, where we discuss how organizations move AI from promising ideas to real-world impact. Details and registration are on parseus.ai.';

// Template 1: application received (automatic).
function consultReceivedEmail_(name, ref, cfg) {
  return {
    subject: 'We received your application' + refText_(ref),
    body: hello_(name) + '\n\n' +
      'Thank you for applying for a complimentary AI strategy conversation through ' + SERIES + ': From Innovation to Real-World Impact. ' +
      'We have received your application. Your reference is ' + ref + '.\n\n' +
      'What happens next:\n' +
      '1. Review: we read every application individually.\n' +
      '2. Selection: we are offering ' + capWords_(cfg.cap) + ' complimentary 20-minute conversations, and we select the applications where a short conversation is most likely to help.\n' +
      '3. Private scheduling: if your application is selected, we will email you a private scheduling link to book a time.\n\n' +
      'This email confirms that we received your application. It does not mean that your application has been selected. ' +
      'We will let you know by email once a decision has been made.\n\n' +
      'Please do not send confidential or commercially sensitive information by email or through our forms. A general description of your challenge is enough.\n\n' +
      'If you would like to withdraw your application, or if you did not submit it, simply reply to this email and we will remove your details.' +
      sign_(),
  };
}

// Templates 2 + 3 combined: selected, with the private booking link (menu).
function bookingEmail_(name, ref, url, cfg) {
  return {
    subject: 'Your complimentary AI strategy conversation with Parseus AI',
    body: hello_(name) + '\n\n' +
      'Thank you for your application' + refText_(ref) + '. We are pleased to let you know that it has been selected for one of our ' +
      capWords_(cfg.cap) + ' complimentary 20-minute AI strategy conversations.\n\n' +
      'Please choose a time that suits you using this private scheduling link:\n' + url + '\n\n' +
      'When you book, Google Calendar will send you a confirmation with the date, time and video call details. ' +
      'Your conversation is scheduled once you have received that confirmation.\n\n' +
      'This link is intended for you only, so please do not share or forward it.\n\n' +
      'Ahead of the conversation, please do not send confidential or commercially sensitive information. A general description of your challenge is enough.\n\n' +
      'If you are no longer able to take part, simply reply to this email so we can offer the place to someone else.' +
      sign_(),
  };
}

// Template 4: not selected (menu).
function notSelectedEmail_(name, ref, cfg) {
  return {
    subject: 'Your ' + SERIES + ' application' + refText_(ref),
    body: hello_(name) + '\n\n' +
      'Thank you for applying for a complimentary AI strategy conversation, and for the time you took to describe your challenge.\n\n' +
      'We are able to offer only ' + capWords_(cfg.cap) + ' conversations in this round, and we are not able to offer you a place this time. ' +
      'This is not a judgement on the value of your work.\n\n' +
      ROUNDTABLE_INVITE + '\n\n' +
      'If you have any questions, simply reply to this email.' +
      sign_(),
  };
}

// Template 4b: held for a later round (menu).
function heldEmail_(name, ref) {
  return {
    subject: 'An update on your ' + SERIES + ' application' + refText_(ref),
    body: hello_(name) + '\n\n' +
      'Thank you for applying for a complimentary AI strategy conversation, and for the time you took to describe your challenge.\n\n' +
      'We are not able to offer you a place in the current round. We would like to keep your application on file in case we open further conversations. ' +
      'We cannot promise that we will, but if we do, we will review your application again and contact you by email.\n\n' +
      'If you would prefer that we do not keep your application, simply reply to this email and we will delete it.\n\n' +
      'In the meantime, ' + ROUNDTABLE_INVITE.charAt(0).toLowerCase() + ROUNDTABLE_INVITE.slice(1) +
      sign_(),
  };
}

// Template 6: post-consultation follow-up (menu).
function consultFollowUpEmail_(name) {
  return {
    subject: 'Thank you for speaking with Parseus AI',
    body: hello_(name) + '\n\n' +
      'Thank you for taking the time to speak with us. We enjoyed learning about your work and hope the conversation was useful.\n\n' +
      'If we agreed on any next steps, we will follow up on them with you directly. If you would like to continue the discussion in the meantime, simply reply to this email.\n\n' +
      ROUNDTABLE_INVITE +
      sign_(),
  };
}

// Template 7a / 7b: roundtable registration confirmed (automatic).
function registeredEmail_(name, ev, ref) {
  return {
    subject: 'Your roundtable registration is confirmed' + refText_(ref),
    body: hello_(name) + '\n\n' +
      'Thank you for registering for ' + rtTitle_(ev) + '. Your place is confirmed. Your reference is ' + ref + '.\n\n' +
      whenBlock_(ev) +
      'If your plans change, simply reply to this email and we will offer your place to someone on the waitlist. ' +
      'If you did not register, reply and we will remove your details.' +
      sign_(),
  };
}

// Template 7c: joining details sent later (menu).
function detailsEmail_(name, ev) {
  return {
    subject: 'Joining details: ' + rtSubjectTitle_(ev),
    body: hello_(name) + '\n\n' +
      'Here are the details for ' + rtTitle_(ev) + '.\n\n' +
      'When: ' + formatWhen_(ev.start, ev.duration) + '\n' +
      'Joining link: ' + ev.link + '\n\n' +
      'Please keep this link to yourself, as it is for registered participants only. ' +
      'If you can no longer attend, simply reply to this email so we can offer your place to someone on the waitlist.' +
      sign_(),
  };
}

// Template 8: roundtable reminder (hourly trigger or menu).
function reminderEmail_(name, ev) {
  return {
    subject: 'Reminder: ' + rtSubjectTitle_(ev),
    body: hello_(name) + '\n\n' +
      'A reminder that ' + rtTitle_(ev) + ' takes place soon.\n\n' +
      'When: ' + formatWhen_(ev.start, ev.duration) + '\n' +
      'Joining link: ' + ev.link + '\n\n' +
      'We look forward to the conversation. If you can no longer attend, simply reply to this email so we can offer your place to someone on the waitlist.' +
      sign_(),
  };
}

// Template 9: waitlist (automatic).
function waitlistedEmail_(name, ev, ref) {
  return {
    subject: 'You are on the roundtable waitlist' + refText_(ref),
    body: hello_(name) + '\n\n' +
      'Thank you for your interest in ' + rtTitle_(ev) + '. The session is currently full, so we have added you to the waitlist. Your reference is ' + ref + '.\n\n' +
      'This email does not confirm a place. If a place opens, we will email you, and your place is confirmed only when you receive that email.\n\n' +
      'If you would rather not stay on the waitlist, or if you did not register, simply reply to this email and we will remove your details.' +
      sign_(),
  };
}

// Template 9b: a waitlist place opened (menu).
function promotedEmail_(name, ev) {
  return {
    subject: 'A place has opened: ' + rtSubjectTitle_(ev),
    body: hello_(name) + '\n\n' +
      'Good news: a place has opened at ' + rtTitle_(ev) + ', and your registration is now confirmed.\n\n' +
      whenBlock_(ev) +
      'If you can no longer attend, simply reply to this email so we can offer your place to someone else.' +
      sign_(),
  };
}

// Template 10: post-roundtable thank-you (menu).
function roundtableFollowUpEmail_(name, ev, wantsUpdates) {
  return {
    subject: 'Thank you for joining the ' + SERIES + ' roundtable',
    body: hello_(name) + '\n\n' +
      'Thank you for joining ' + rtTitle_(ev) + '. We appreciated your time and perspective.\n\n' +
      (wantsUpdates ? 'As you requested, we will let you know about future roundtables.\n\n' : '') +
      'If you have thoughts on the discussion or ideas for future topics, simply reply to this email.' +
      sign_(),
  };
}

// Internal notification to NOTIFY_EMAIL. Contains the submitted text: for staff only.
function notifyBody_(kind, ref, pairs) {
  let url = '';
  try { url = ss_().getUrl(); } catch (err) { url = ''; }
  return 'A new ' + kind + ' has been stored (' + ref + ').\n' +
    'Submitted text is shown exactly as entered. Do not open links in it unless you trust the sender.\n\n' +
    pairs.map(p => p[0] + ': ' + p[1]).join('\n\n') +
    (url ? '\n\nOpen the Sheet: ' + url : '') + '\n';
}

// ---------------------------------------------------------------------------
// Setup (run once from the Apps Script editor; safe to repeat)
// ---------------------------------------------------------------------------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open Apps Script from the Sheet (Extensions > Apps Script) and run setup() there.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  // Defaults (only if not already set), so they are visible and editable in Script Properties.
  const defaults = {
    NOTIFY_EMAIL: 'info@parseus.ai', CONSULTATION_CAP: '10', SENDER_NAME: 'Parseus AI',
    REQUIRE_TURNSTILE: 'false', MAX_SUBMISSIONS_PER_10_MIN: '20', MAX_SUBMISSIONS_PER_DAY: '100',
    DUPLICATE_WINDOW_DAYS: '30', PRIVACY_NOTICE_VERSION: 'October 2026',
    RETENTION_NOT_SELECTED_MONTHS: '6', RETENTION_COMPLETED_MONTHS: '12', RETENTION_ROUNDTABLE_MONTHS: '6',
  };
  Object.keys(defaults).forEach(k => { if (!props.getProperty(k)) props.setProperty(k, defaults[k]); });

  const consult = ensureSheet_(ss, 'consult');
  const reg = ensureSheet_(ss, 'reg');
  const events = ensureSheet_(ss, 'events');

  // Dropdowns, checkboxes and date formats, located by header name (works on older Sheets too).
  const rows = sh => Math.max(sh.getMaxRows() - 1, 1);
  const colRange = (sh, name) => {
    const t = readTable_(sh);
    return sh.getRange(2, col_(t, name), rows(sh), 1);
  };
  colRange(consult, 'Status').setDataValidation(listRule_(CONSULT_STATUSES));
  colRange(reg, 'Registration status').setDataValidation(listRule_(REG_STATUSES));
  colRange(reg, 'Attended').insertCheckboxes();
  colRange(events, 'Registration open').insertCheckboxes();
  const dt = 'yyyy-mm-dd hh:mm';
  DATE_COLUMNS.consult.forEach(h => colRange(consult, h).setNumberFormat(dt));
  DATE_COLUMNS.reg.forEach(h => colRange(reg, h).setNumberFormat(dt));
  DATE_COLUMNS.events.forEach(h => colRange(events, h).setNumberFormat(dt));

  // Seed the first roundtable once.
  if (events.getLastRow() < 2) {
    const t = readTable_(events);
    events.appendRow(buildRow_(t, {
      'Event ID': 'rt-01',
      'Title': 'From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?',
      'Start': '', 'Duration (min)': 60, 'Capacity': 25, 'Registration open': true, 'Meeting link (private)': '',
      'Notes': 'Capacity 25 is a placeholder. Set Start and Meeting link once confirmed.',
    }));
  }

  // Remove the empty default tab if present.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  try {
    SpreadsheetApp.getUi().alert('Setup complete. Tabs, headers and dropdowns are ready. Any missing columns were added at the end.');
  } catch (err) { /* running without UI */ }
}

/** Creates the tab if needed and appends any missing header columns. Never moves or deletes data. */
function ensureSheet_(ss, key) {
  let sh = ss.getSheetByName(SHEETS[key]);
  if (!sh) sh = ss.insertSheet(SHEETS[key]);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]);
  } else {
    const t = readTable_(sh);
    let last = t.headers.length;
    while (last > 0 && !t.headers[last - 1]) last--;
    const missing = HEADERS[key].filter(h => !(h in t.idx));
    if (missing.length) sh.getRange(1, last + 1, 1, missing.length).setValues([missing]);
  }
  sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// ---------------------------------------------------------------------------
// Sheet menu & selection guard
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Parseus')
    .addItem('Send booking links to Selected applicants', 'sendBookingLinks')
    .addItem('Send decision notices (Not selected / Held)', 'sendDecisionNotices')
    .addItem('Show consultation places used', 'showConsultationCap')
    .addItem('Send consultation follow-ups (Completed)', 'sendConsultationFollowUps')
    .addSeparator()
    .addItem('Send event details to registrants', 'sendEventDetails')
    .addItem('Promote from waitlist', 'promoteFromWaitlist')
    .addItem('Send due reminders now', 'sendRemindersNow')
    .addItem('Send roundtable follow-ups (Attended)', 'sendRoundtableFollowUps')
    .addSeparator()
    .addItem('Check setup', 'showSetupStatus')
    .addItem('Apply data retention (anonymise old rows)', 'applyRetention')
    .addItem('Install reminder trigger', 'installReminderTrigger')
    .addItem('Run setup (safe to repeat)', 'setup')
    .addToUi();
}

// Places used = rows whose status counts toward the cap, or that already received a link.
function placesUsed_(t) {
  const cS = t.idx['Status'], cB = t.idx['Booking link sent at'];
  return t.rows.filter(r => CAP_STATUSES.indexOf(String(r[cS])) !== -1 || !isBlank_(r[cB])).length;
}

function linksSent_(t) {
  const cS = t.idx['Status'], cB = t.idx['Booking link sent at'];
  return t.rows.filter(r => SENT_STATUSES.indexOf(String(r[cS])) !== -1 || !isBlank_(r[cB])).length;
}

/**
 * Simple trigger: refuses to mark more applicants "Selected" than the cap allows.
 * Limits: it only sees edits made by hand in the Sheet UI (not API/script edits),
 * and cannot restore old values after a multi-cell paste, so it only warns then.
 * The hard guarantee is in sendBookingLinks, which re-checks the cap under a lock.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEETS.consult) return;
    const t = readTable_(sh);
    const statusCol = col_(t, 'Status');
    const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
    if (statusCol < c0 || statusCol > c1) return;
    const cap = config_().cap;
    if (placesUsed_(t) <= cap) return;
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) {
      if (e.value !== 'Selected') return;
      e.range.setValue(e.oldValue !== undefined ? e.oldValue : 'Under review');
      sh.getParent().toast('All ' + cap + ' complimentary conversations are already allocated. Status was not changed.', 'Parseus', 8);
    } else {
      sh.getParent().toast('More applicants are marked as using a place than the cap of ' + cap +
        ' allows. Booking links will still only be sent up to the cap. Please correct the Status column.', 'Parseus', 10);
    }
  } catch (err) {
    console.error('onEdit: ' + errText_(err));
  }
}

function showConsultationCap() {
  const t = readTable_(sheet_('consult'));
  const cap = config_().cap;
  const used = placesUsed_(t);
  SpreadsheetApp.getUi().alert('Complimentary conversations: ' + used + ' of ' + cap + ' places used (' +
    Math.max(cap - used, 0) + ' remaining).' + (used > cap ? '\n\nWarning: more rows are selected than the cap allows.' : ''));
}

// ---------------------------------------------------------------------------
// Bulk sending: claim under lock, send outside the lock, undo on failure
// ---------------------------------------------------------------------------

/**
 * spec = {
 *   key:     'consult' | 'reg'
 *   select:  (t) => row indexes to email, in order (called while holding the lock)
 *   message: (t, i) => { to, subject, body } or null to skip
 *   claim:   (t, i, now) => marks the row as sent (stamp columns, status)
 *   revert:  (t, i) => undoes claim() if the email could not be sent
 * }
 * Rows are stamped BEFORE sending (and the stamps flushed), so a second person
 * running the same menu, a double click or a retry can never email the same row
 * twice. If a send fails, the stamp is removed again and "Last email error" is
 * filled in. If the script is killed mid-run, a stamped row may not have been
 * emailed: at most once, never twice.
 */
function bulkSend_(spec, maxCount) {
  const result = { busy: false, sent: 0, failed: [], deferred: 0, eligible: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) { result.busy = true; return result; }
  const cfg = config_();
  const jobs = [];
  try {
    const t = readTable_(sheet_(spec.key));
    const picked = spec.select(t);
    result.eligible = picked.length;
    const room = Math.max(0, Math.min(MailApp.getRemainingDailyQuota(), MAX_BATCH,
      maxCount === undefined ? Infinity : maxCount));
    const now = new Date();
    for (const i of picked) {
      if (jobs.length >= room) break;
      const msg = spec.message(t, i);
      if (!msg || !EMAIL_RE.test(String(msg.to))) continue;
      jobs.push({ i: i, ref: String(cell_(t, i, 'Ref') || ''), msg: msg, hadError: !isBlank_(cell_(t, i, 'Last email error')) });
      spec.claim(t, i, now);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  result.deferred = result.eligible - jobs.length;

  const started = Date.now();
  const failed = [], unsent = [], cleared = [];
  jobs.forEach(j => {
    if (Date.now() - started > TIME_BUDGET_MS) { unsent.push(j); return; }
    try {
      send_(j.msg.to, j.msg.subject, j.msg.body, cfg);
      result.sent++;
      if (j.hadError) cleared.push(j);
    } catch (err) {
      console.error('Bulk email failed for ' + (j.ref || 'row ' + (j.i + 2)) + ': ' + errText_(err && err.message ? err.message : err));
      failed.push(j);
    }
  });
  result.failed = failed.map(j => j.ref || 'row ' + (j.i + 2));
  result.deferred += unsent.length;
  if (failed.length || unsent.length || cleared.length) fixUpRows_(spec, failed, unsent, cleared);
  return result;
}

// Undo claims that were not sent; record or clear "Last email error". Rows are found by Ref in case the Sheet was re-sorted.
function fixUpRows_(spec, failed, unsent, cleared) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.error('Could not obtain lock to undo unsent rows.');
    return;
  }
  try {
    const t = readTable_(sheet_(spec.key));
    const find = j => {
      if (j.ref) {
        const cR = t.idx['Ref'];
        const k = t.rows.findIndex(r => String(r[cR]) === j.ref);
        if (k !== -1) return k;
      }
      return j.i < t.rows.length ? j.i : -1;
    };
    const stampNow = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    failed.concat(unsent).forEach(j => {
      const k = find(j);
      if (k === -1) return;
      spec.revert(t, k);
      if (failed.indexOf(j) !== -1) setCellIf_(t, k, 'Last email error', stampNow + ' send failed, not marked as sent');
    });
    cleared.forEach(j => { const k = find(j); if (k !== -1) setCellIf_(t, k, 'Last email error', ''); });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function bulkReport_(label, res) {
  if (res.busy) return 'Another Parseus action is running. Please try again in a moment. No emails were sent.';
  let s = label + ': ' + res.sent + '.';
  if (res.failed.length) s += '\n\nCould not be sent (see "Last email error"; you can run this again): ' + res.failed.join(', ') + '.';
  if (res.deferred > 0) s += '\n\n' + res.deferred + ' not sent this time (daily email quota, batch size of ' + MAX_BATCH +
    ' or time limit). Run this again to continue, or try again tomorrow if the daily email quota is used up.';
  return s;
}

// Confirm, then send. `preview` counts eligible rows without the lock, purely for the dialog.
function confirmAndSend_(title, question, spec, preview, label, suffix) {
  const ui = SpreadsheetApp.getUi();
  const quota = MailApp.getRemainingDailyQuota();
  const n = Math.min(preview, Math.max(quota, 0), MAX_BATCH);
  if (!n) { ui.alert('The daily email quota is used up. Please try again tomorrow.'); return; }
  if (ui.alert(title, question(n), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert(bulkReport_(label, bulkSend_(spec, n)) + (suffix || ''));
}

// ---------------------------------------------------------------------------
// Consultation menu actions
// ---------------------------------------------------------------------------

function selectedPending_(t) {
  const cS = t.idx['Status'], cB = t.idx['Booking link sent at'];
  const out = [];
  t.rows.forEach((r, i) => { if (String(r[cS]) === 'Selected' && isBlank_(r[cB]) && !isAnon_(t, r)) out.push(i); });
  return out;
}

/** Menu: email the private booking link to Selected applicants (up to the cap). */
function sendBookingLinks() {
  const ui = SpreadsheetApp.getUi();
  const cfg = config_();
  if (!cfg.bookingUrl) {
    ui.alert('BOOKING_URL is not set.\n\nAdd it in Apps Script > Project Settings > Script properties, then try again. No emails were sent.');
    return;
  }
  if (!/^https:\/\/\S+$/i.test(cfg.bookingUrl)) {
    ui.alert('BOOKING_URL must be a single https:// link. Please check it in Script properties. No emails were sent.');
    return;
  }
  const t = readTable_(sheet_('consult'));
  const pending = selectedPending_(t);
  if (!pending.length) {
    ui.alert('No applicants are waiting for a booking link (Status "Selected" with no "Booking link sent at").');
    return;
  }
  const remaining = cfg.cap - linksSent_(t);
  if (remaining <= 0) {
    ui.alert('All ' + cfg.cap + ' complimentary conversations have already been offered. No emails were sent.');
    return;
  }
  const overCap = pending.length - Math.min(pending.length, remaining);
  const quota = MailApp.getRemainingDailyQuota();
  const n = Math.min(pending.length, remaining, Math.max(quota, 0), MAX_BATCH);
  if (!n) { ui.alert('The daily email quota is used up. Please try again tomorrow.'); return; }
  const confirm = ui.alert('Send booking links',
    'Send the private booking link to ' + n + ' applicant(s)?' +
    (overCap ? '\n\nWarning: ' + overCap + ' Selected applicant(s) exceed the cap of ' + cfg.cap + ' and will NOT be emailed.' : ''),
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const spec = {
    key: 'consult',
    // Re-checked under the lock: never more links than the cap, whoever else is working.
    select: tt => selectedPending_(tt).slice(0, Math.max(cfg.cap - linksSent_(tt), 0)),
    message: (tt, i) => Object.assign({ to: unsafe_(cell_(tt, i, 'Email')).trim() },
      bookingEmail_(cell_(tt, i, 'Name'), String(cell_(tt, i, 'Ref') || ''), cfg.bookingUrl, cfg)),
    claim: (tt, i, now) => {
      setCell_(tt, i, 'Booking link sent at', now);
      setCell_(tt, i, 'Status', 'Booking link sent');
      if (isBlank_(cell_(tt, i, 'Decision date'))) setCell_(tt, i, 'Decision date', now);
      setCellIf_(tt, i, 'Decision sent at', now);
    },
    revert: (tt, i) => {
      setCell_(tt, i, 'Booking link sent at', '');
      setCell_(tt, i, 'Status', 'Selected');
      setCellIf_(tt, i, 'Decision sent at', '');
    },
  };
  const res = bulkSend_(spec, n);
  let msg = bulkReport_('Booking links sent', res);
  if (overCap) msg += '\n\n' + overCap + ' Selected applicant(s) were not emailed because the cap of ' + cfg.cap + ' is reached.';
  if (!res.busy && n < Math.min(pending.length, remaining)) msg += '\n\nSome were not sent because of the daily email quota or batch size.';
  ui.alert(msg);
}

function decisionPending_(t) {
  const out = [];
  if (!('Decision sent at' in t.idx)) return out;
  t.rows.forEach((r, i) => {
    if (DECISION_STATUSES.indexOf(String(r[t.idx['Status']])) !== -1 &&
        isBlank_(r[t.idx['Decision sent at']]) && !isAnon_(t, r)) out.push(i);
  });
  return out;
}

/** Menu: "not selected" / "held for a later round" notices for rows without "Decision sent at". */
function sendDecisionNotices() {
  const ui = SpreadsheetApp.getUi();
  const cfg = config_();
  const t = readTable_(sheet_('consult'));
  if (!('Decision sent at' in t.idx)) { ui.alert('The "Decision sent at" column is missing. Run Parseus > Run setup first.'); return; }
  const pending = decisionPending_(t);
  if (!pending.length) {
    ui.alert('No applicants are waiting for a decision notice (Status "Not selected" or "Held for later round" with no "Decision sent at").');
    return;
  }
  const spec = {
    key: 'consult',
    select: decisionPending_,
    message: (tt, i) => {
      const name = cell_(tt, i, 'Name'), ref = String(cell_(tt, i, 'Ref') || '');
      const m = String(cell_(tt, i, 'Status')) === 'Held for later round' ? heldEmail_(name, ref) : notSelectedEmail_(name, ref, cfg);
      return Object.assign({ to: unsafe_(cell_(tt, i, 'Email')).trim() }, m);
    },
    claim: (tt, i, now) => {
      setCell_(tt, i, 'Decision sent at', now);
      if (isBlank_(cell_(tt, i, 'Decision date'))) setCell_(tt, i, 'Decision date', now);
    },
    revert: (tt, i) => setCell_(tt, i, 'Decision sent at', ''),
  };
  confirmAndSend_('Send decision notices',
    n => 'Send a decision email to ' + n + ' applicant(s)? "Not selected" rows get the not-selected message; "Held for later round" rows get the held message.',
    spec, pending.length, 'Decision notices sent');
}

/** Menu: follow-up to consultations marked Completed. */
function sendConsultationFollowUps() {
  const ui = SpreadsheetApp.getUi();
  const select = t => {
    const out = [];
    t.rows.forEach((r, i) => {
      if (String(r[t.idx['Status']]) === 'Completed' && isBlank_(r[t.idx['Follow-up sent at']]) && !isAnon_(t, r)) out.push(i);
    });
    return out;
  };
  const pending = select(readTable_(sheet_('consult')));
  if (!pending.length) { ui.alert('No completed conversations are waiting for a follow-up.'); return; }
  confirmAndSend_('Send follow-ups', n => 'Send a follow-up email to ' + n + ' person(s)?', {
    key: 'consult',
    select: select,
    message: (t, i) => Object.assign({ to: unsafe_(cell_(t, i, 'Email')).trim() }, consultFollowUpEmail_(cell_(t, i, 'Name'))),
    claim: (t, i, now) => { setCell_(t, i, 'Follow-up sent at', now); setCell_(t, i, 'Status', 'Follow-up sent'); },
    revert: (t, i) => { setCell_(t, i, 'Follow-up sent at', ''); setCell_(t, i, 'Status', 'Completed'); },
  }, pending.length, 'Follow-ups sent');
}

// ---------------------------------------------------------------------------
// Roundtable menu actions
// ---------------------------------------------------------------------------

function eventMap_() {
  const m = {};
  readEvents_().forEach(ev => { m[ev.id] = ev; });
  return m;
}

/** Menu: send date/time + meeting link to Registered rows without "Details sent at". */
function sendEventDetails() {
  const ui = SpreadsheetApp.getUi();
  const ready = {};
  const notReady = [];
  readEvents_().forEach(ev => {
    if (ev.start && ev.link && ev.start.getTime() > Date.now()) ready[ev.id] = ev;
    else notReady.push(ev.id);
  });
  const select = t => {
    const out = [];
    t.rows.forEach((r, i) => {
      if (ready[String(r[t.idx['Event ID']])] && String(r[t.idx['Registration status']]) === 'Registered' &&
          isBlank_(r[t.idx['Details sent at']]) && !isAnon_(t, r)) out.push(i);
    });
    return out;
  };
  const skippedNote = notReady.length ? '\n\nSkipped (needs a future Start and a Meeting link in the Events tab): ' + notReady.join(', ') : '';
  const pending = select(readTable_(sheet_('reg')));
  if (!pending.length) { ui.alert('No registrants are waiting for event details.' + skippedNote); return; }
  confirmAndSend_('Send event details', n => 'Send date, time and joining link to ' + n + ' registrant(s)?', {
    key: 'reg',
    select: select,
    message: (t, i) => Object.assign({ to: unsafe_(cell_(t, i, 'Email')).trim() },
      detailsEmail_(cell_(t, i, 'Name'), ready[String(cell_(t, i, 'Event ID'))])),
    claim: (t, i, now) => setCell_(t, i, 'Details sent at', now),
    revert: (t, i) => setCell_(t, i, 'Details sent at', ''),
  }, pending.length, 'Event details sent', skippedNote);
}

/** Fill freed capacity from the waitlist in submission order. Returns the bulkSend_ result. */
function promoteWaitlistCore_() {
  const events = eventMap_();
  return bulkSend_({
    key: 'reg',
    select: t => {
      const cE = t.idx['Event ID'], cS = t.idx['Registration status'];
      const out = [];
      Object.keys(events).forEach(id => {
        const ev = events[id];
        if (ev.start && ev.start.getTime() <= Date.now()) return; // past events
        const registered = t.rows.filter(r => String(r[cE]) === id && String(r[cS]) === 'Registered').length;
        const free = ev.capacity - registered;
        if (free <= 0) return;
        // Sheet order is submission order; sort by "Submitted at" in case rows were re-sorted.
        const waiting = [];
        t.rows.forEach((r, i) => { if (String(r[cE]) === id && String(r[cS]) === 'Waitlisted' && !isAnon_(t, r)) waiting.push(i); });
        waiting.sort((a, b) => toTime_(t.rows[a][t.idx['Submitted at']]) - toTime_(t.rows[b][t.idx['Submitted at']]) || a - b);
        waiting.slice(0, free).forEach(i => out.push(i));
      });
      return out;
    },
    message: (t, i) => Object.assign({ to: unsafe_(cell_(t, i, 'Email')).trim() },
      promotedEmail_(cell_(t, i, 'Name'), events[String(cell_(t, i, 'Event ID'))])),
    claim: (t, i, now) => {
      setCell_(t, i, 'Registration status', 'Registered');
      const ev = events[String(cell_(t, i, 'Event ID'))];
      if (ev.start && ev.link) setCell_(t, i, 'Details sent at', now);
    },
    revert: (t, i) => { setCell_(t, i, 'Registration status', 'Waitlisted'); setCell_(t, i, 'Details sent at', ''); },
  });
}

function toTime_(v) {
  return isDate_(v) ? v.getTime() : (Date.parse(v) || 0);
}

function promoteFromWaitlist() {
  const ui = SpreadsheetApp.getUi();
  const res = promoteWaitlistCore_();
  if (res.busy) { ui.alert(bulkReport_('', res)); return; }
  if (!res.eligible) { ui.alert('No places are free, or nobody is on the waitlist.'); return; }
  ui.alert(bulkReport_('Promoted from waitlist and emailed', res));
}

/** Reminders for events starting within the next 24 hours, once per registrant. No UI (runs from a trigger). */
function sendRemindersCore_() {
  const now = Date.now();
  const due = {};
  readEvents_().forEach(ev => {
    if (!ev.start || !ev.link) return;
    const ms = ev.start.getTime() - now;
    if (ms > 0 && ms <= 24 * 3600 * 1000) due[ev.id] = ev;
  });
  if (!Object.keys(due).length) return { busy: false, sent: 0, failed: [], deferred: 0, eligible: 0 };
  return bulkSend_({
    key: 'reg',
    select: t => {
      const out = [];
      t.rows.forEach((r, i) => {
        if (due[String(r[t.idx['Event ID']])] && String(r[t.idx['Registration status']]) === 'Registered' &&
            isBlank_(r[t.idx['Reminder sent at']]) && !isAnon_(t, r)) out.push(i);
      });
      return out;
    },
    message: (t, i) => Object.assign({ to: unsafe_(cell_(t, i, 'Email')).trim() },
      reminderEmail_(cell_(t, i, 'Name'), due[String(cell_(t, i, 'Event ID'))])),
    claim: (t, i, now2) => setCell_(t, i, 'Reminder sent at', now2),
    revert: (t, i) => setCell_(t, i, 'Reminder sent at', ''),
  });
}

/** Time-driven trigger target (hourly). */
function sendReminders() {
  try {
    const res = sendRemindersCore_();
    if (res.failed.length) alertOwner_('reminders', 'Some roundtable reminders could not be sent: ' + res.failed.join(', ') + '. See "Last email error".');
  } catch (err) {
    console.error('sendReminders: ' + errText_(err));
  }
}

function sendRemindersNow() {
  const res = sendRemindersCore_();
  SpreadsheetApp.getUi().alert(bulkReport_('Reminders sent', res) +
    '\n\n(Only events starting within the next 24 hours with a Meeting link are included.)');
}

function installReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(tr => {
    if (tr.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  try {
    SpreadsheetApp.getUi().alert('Hourly reminder trigger installed. Reminders go out once, within 24 hours before each event.');
  } catch (err) { /* no UI */ }
}

/** Menu: follow-up to registrants marked Attended. */
function sendRoundtableFollowUps() {
  const ui = SpreadsheetApp.getUi();
  const events = eventMap_();
  const select = t => {
    const out = [];
    t.rows.forEach((r, i) => {
      const att = r[t.idx['Attended']];
      if ((att === true || String(att).toUpperCase() === 'TRUE') && isBlank_(r[t.idx['Follow-up sent at']]) && !isAnon_(t, r)) out.push(i);
    });
    return out;
  };
  const pending = select(readTable_(sheet_('reg')));
  if (!pending.length) { ui.alert('No attendees are waiting for a follow-up.'); return; }
  confirmAndSend_('Send follow-ups', n => 'Send a thank-you email to ' + n + ' attendee(s)?', {
    key: 'reg',
    select: select,
    message: (t, i) => Object.assign({ to: unsafe_(cell_(t, i, 'Email')).trim() },
      roundtableFollowUpEmail_(cell_(t, i, 'Name'), events[String(cell_(t, i, 'Event ID'))], String(cell_(t, i, 'Future updates')) === 'Yes')),
    claim: (t, i, now) => setCell_(t, i, 'Follow-up sent at', now),
    revert: (t, i) => setCell_(t, i, 'Follow-up sent at', ''),
  }, pending.length, 'Follow-ups sent');
}

// ---------------------------------------------------------------------------
// Setup check and data retention
// ---------------------------------------------------------------------------

/** Menu: shows which settings are in place. Never displays secret values. */
function showSetupStatus() {
  const cfg = config_();
  const has = k => (prop_(k, '') ? 'set' : 'NOT SET');
  const trigger = ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === 'sendReminders');
  const lines = [
    'NOTIFY_EMAIL: ' + cfg.notifyEmail,
    'BOOKING_URL: ' + has('BOOKING_URL') + (cfg.bookingUrl && !/^https:\/\//i.test(cfg.bookingUrl) ? ' (WARNING: not an https link)' : ''),
    'TURNSTILE_SECRET: ' + has('TURNSTILE_SECRET'),
    'REQUIRE_TURNSTILE: ' + (cfg.requireTurnstile ? 'true' : 'false'),
    'Consultation cap: ' + cfg.cap,
    'Global limit: ' + cfg.maxPer10Min + ' per 10 minutes, ' + cfg.maxPerDay + ' per 24 hours',
    'Reminder trigger: ' + (trigger ? 'installed' : 'not installed'),
    'Emails left today (Google quota): ' + MailApp.getRemainingDailyQuota(),
  ];
  const warn = [];
  if (!cfg.turnstileSecret || !cfg.requireTurnstile) warn.push('Before activating the public forms, set TURNSTILE_SECRET and set REQUIRE_TURNSTILE to true.');
  if (!cfg.bookingUrl) warn.push('Set BOOKING_URL before sending booking links.');
  SpreadsheetApp.getUi().alert(lines.join('\n') + (warn.length ? '\n\n' + warn.join('\n') : '\n\nNo problems found.'));
}

function monthsAgo_(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}

/**
 * Rows due for anonymisation under the retention settings.
 *   Consultations: Not selected, after RETENTION_NOT_SELECTED_MONTHS from the decision.
 *     Completed / Follow-up sent, after RETENTION_COMPLETED_MONTHS from the conversation.
 *     New / Under review / Held for later round, after RETENTION_COMPLETED_MONTHS from submission.
 *     Selected / Booking link sent / Scheduled are never touched.
 *   Registrations: after RETENTION_ROUNDTABLE_MONTHS from the event (or submission if no date).
 *     People who asked for future updates keep name + email.
 */
function retentionPlan_() {
  const notSel = monthsAgo_(intProp_('RETENTION_NOT_SELECTED_MONTHS', 6, 1, 120));
  const done = monthsAgo_(intProp_('RETENTION_COMPLETED_MONTHS', 12, 1, 120));
  const rt = monthsAgo_(intProp_('RETENTION_ROUNDTABLE_MONTHS', 6, 1, 120));
  const plan = { consult: [], reg: [], regKeep: [], active: 0 };

  const c = readTable_(sheet_('consult'));
  c.rows.forEach((r, i) => {
    if (isAnon_(c, r)) return;
    const st = String(r[c.idx['Status']]);
    const t = col => toTime_(cell_(c, i, col));
    const submitted = t('Submitted at');
    if (ACTIVE_STATUSES.indexOf(st) !== -1) { if (submitted && submitted < done) plan.active++; return; }
    let ref, limit;
    if (st === 'Not selected') { ref = t('Decision date') || submitted; limit = notSel; }
    else if (st === 'Completed' || st === 'Follow-up sent') { ref = t('Conversation date') || t('Decision date') || submitted; limit = done; }
    else { ref = submitted; limit = done; }
    if (ref && ref < limit) plan.consult.push(i);
  });

  const events = eventMap_();
  const g = readTable_(sheet_('reg'));
  g.rows.forEach((r, i) => {
    if (isAnon_(g, r)) return;
    const ev = events[String(r[g.idx['Event ID']])];
    const ref = ev && ev.start ? ev.start.getTime() : toTime_(r[g.idx['Submitted at']]);
    if (!ref || ref >= rt) return;
    if (String(r[g.idx['Future updates']]) === 'Yes') plan.regKeep.push(i); else plan.reg.push(i);
  });
  return plan;
}

/** Menu: anonymise rows past the retention periods, after showing counts and asking YES/NO. */
function applyRetention() {
  const ui = SpreadsheetApp.getUi();
  const p = retentionPlan_();
  const total = p.consult.length + p.reg.length + p.regKeep.length;
  const activeNote = p.active ? '\n\nNot touched: ' + p.active + ' older consultation(s) still Selected / Booking link sent / Scheduled. Please update their Status.' : '';
  if (!total) { ui.alert('No rows are past the retention periods. Nothing was changed.' + activeNote); return; }
  const q = 'This permanently replaces personal details with "' + REMOVED + '" (it cannot be undone):\n\n' +
    '- Consultations: ' + p.consult.length + ' row(s) (name, role, organization, email, challenge, outcome, notes)\n' +
    '- Roundtable registrations: ' + p.reg.length + ' row(s) (name, role, organization, email, question)\n' +
    '- Roundtable registrations who asked for updates: ' + p.regKeep.length + ' row(s) (role, organization, question only; name and email kept)\n\n' +
    'Status, dates, area and stage are kept so place counts stay correct. Continue?' + activeNote;
  if (ui.alert('Apply data retention', q, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) { ui.alert('Another Parseus action is running. Please try again in a moment. Nothing was changed.'); return; }
  let n = 0;
  try {
    const plan = retentionPlan_(); // re-check under the lock
    const now = new Date();
    const scrub = (key, indexes, cols) => {
      const t = readTable_(sheet_(key));
      indexes.forEach(i => {
        const row = t.rows[i].map(v => safe_(v));
        cols.forEach(cn => { if (cn in t.idx) row[t.idx[cn]] = REMOVED; });
        if ('Last email error' in t.idx) row[t.idx['Last email error']] = '';
        if ('Anonymised at' in t.idx) row[t.idx['Anonymised at']] = now;
        t.sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        n++;
      });
    };
    scrub('consult', plan.consult, ['Name', 'Role', 'Organization', 'Email', 'Challenge', 'Desired outcome', 'Reviewer notes']);
    scrub('reg', plan.reg, ['Name', 'Role', 'Organization', 'Email', 'Question']);
    scrub('reg', plan.regKeep, ['Role', 'Organization', 'Question']);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  ui.alert('Anonymised ' + n + ' row(s). Note: copies in email inboxes (notifications and replies) are not affected; delete those separately if needed.');
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}
