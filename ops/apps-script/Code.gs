/**
 * Parseus AI — website forms backend (Google Apps Script, V8).
 *
 * Bound to a private Google Sheet. Receives the consultation application and
 * roundtable registration forms from the static website, stores them in the
 * Sheet, and sends plain-text emails. A "Parseus" menu in the Sheet drives the
 * day-to-day review workflow.
 *
 * No secrets live in this file. Configuration is read from Script Properties:
 *   NOTIFY_EMAIL      where new-submission notifications go (default info@parseus.ai)
 *   BOOKING_URL       private appointment-schedule link (never on the website)
 *   TURNSTILE_SECRET  Cloudflare Turnstile secret key (optional)
 *   CONSULTATION_CAP  number of complimentary conversations (default 10)
 *   SENDER_NAME       "From" display name (default "Parseus AI")
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHEETS = {
  consult: 'Consultations',
  reg: 'Roundtable registrations',
  events: 'Events',
};

const HEADERS = {
  consult: ['Submitted at', 'Ref', 'Name', 'Role', 'Organization', 'Email', 'Area',
    'Challenge', 'Desired outcome', 'Stage', 'Status', 'Reviewer notes', 'Decision date',
    'Booking link sent at', 'Conversation date', 'Follow-up sent at'],
  reg: ['Submitted at', 'Ref', 'Event ID', 'Name', 'Role', 'Organization', 'Email',
    'Question', 'Future updates', 'Registration status', 'Details sent at',
    'Reminder sent at', 'Attended', 'Follow-up sent at'],
  events: ['Event ID', 'Title', 'Start', 'Duration (min)', 'Capacity',
    'Registration open', 'Meeting link (private)', 'Notes'],
};

const CONSULT_STATUSES = ['New', 'Under review', 'Selected', 'Not selected',
  'Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
// Statuses that use up one of the complimentary conversation places.
const CAP_STATUSES = ['Selected', 'Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
// Statuses meaning the booking link has already gone out.
const SENT_STATUSES = ['Booking link sent', 'Scheduled', 'Completed', 'Follow-up sent'];
const REG_STATUSES = ['Registered', 'Waitlisted', 'Cancelled'];

const AREAS = ['Enterprise AI and agentic AI', 'Physical AI and robotics',
  'Manufacturing and industrial automation', 'Intelligent systems and computer vision',
  'Enterprise architecture and operating models', 'Strategy, implementation and scaling', 'Other'];
const STAGES = ['Exploring ideas', 'Defining a use case', 'Planning a pilot',
  'Pilot underway', 'Scaling to production', 'Operating in production'];

const SIGNATURE = 'Parseus AI · Beyond AI Headlines';
const MIN_ELAPSED_MS = 3000;       // faster than this = bot
const RATE_LIMIT = 3;              // max submissions per email, per form, per hour
const RATE_WINDOW_S = 3600;
const MAX_BODY_CHARS = 20000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || String(v).trim() === '') ? fallback : String(v).trim();
}

function config_() {
  const cap = parseInt(prop_('CONSULTATION_CAP', '10'), 10);
  return {
    notifyEmail: prop_('NOTIFY_EMAIL', 'info@parseus.ai'),
    bookingUrl: prop_('BOOKING_URL', ''),
    turnstileSecret: prop_('TURNSTILE_SECRET', ''),
    cap: isNaN(cap) || cap < 0 ? 10 : cap,
    senderName: prop_('SENDER_NAME', 'Parseus AI'),
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
// Web app entry points
// ---------------------------------------------------------------------------

/** Health check. Returns no data. */
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
      ? handleConsultation_(payload.fields, meta)
      : handleRoundtable_(payload.fields, meta);
  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
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

// ---------------------------------------------------------------------------
// Consultation applications
// ---------------------------------------------------------------------------

function handleConsultation_(fields, meta) {
  const v = validateConsultation_(fields);
  if (v.errors) return json_({ ok: false, error: 'validation', fields: v.errors });

  const ts = verifyTurnstile_(meta);
  if (ts) return json_({ ok: false, error: ts });

  const ref = makeRef_('C');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Could not obtain lock');
  try {
    if (isRateLimited_('consultation', v.data.email)) return json_({ ok: false, error: 'rate_limited' });
    const sh = sheet_('consult');
    const t = readTable_(sh);
    sh.appendRow(buildRow_(t, {
      'Submitted at': new Date(),
      'Ref': ref,
      'Name': v.data.name,
      'Role': v.data.role,
      'Organization': v.data.organization,
      'Email': v.data.email,
      'Area': v.data.area,
      'Challenge': v.data.challenge,
      'Desired outcome': v.data.outcome,
      'Stage': v.data.stage,
      'Status': 'New',
    }));
    applyRowValidation_(sh, 'consult', sh.getLastRow());
    recordSubmission_('consultation', v.data.email);
  } finally {
    lock.releaseLock();
  }

  // Emails are best-effort: the submission is already safely stored.
  const cfg = config_();
  safeSend_(v.data.email, 'We have received your consultation application (' + ref + ')',
    consultConfirmBody_(v.data, ref, cfg), cfg);
  safeSend_(cfg.notifyEmail, 'New consultation application ' + ref + ' — ' + v.data.organization,
    notifyBody_('consultation application', ref, [
      ['Name', v.data.name], ['Role', v.data.role], ['Organization', v.data.organization],
      ['Email', v.data.email], ['Area', v.data.area], ['Stage', v.data.stage],
      ['Challenge', v.data.challenge], ['Desired outcome', v.data.outcome],
      ['Page', strOrEmpty_(meta.page).slice(0, 200)],
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
  data.challenge = textField_(f, 'challenge', 30, 2000, true, errors);
  data.outcome = textField_(f, 'outcome', 10, 1000, true, errors);
  data.stage = enumField_(f, 'stage', STAGES, errors);
  if (f.consent !== true) errors.consent = 'Please confirm your consent so we can process your application.';
  return Object.keys(errors).length ? { errors: errors } : { data: data };
}

// ---------------------------------------------------------------------------
// Roundtable registrations
// ---------------------------------------------------------------------------

function handleRoundtable_(fields, meta) {
  const v = validateRoundtable_(fields);
  if (v.errors) return json_({ ok: false, error: 'validation', fields: v.errors });

  const event = getEvent_(v.data.eventId);
  if (!event) {
    return json_({ ok: false, error: 'validation', fields: { eventId: 'This roundtable could not be found. Please refresh the page and try again.' } });
  }
  if (!isEventOpen_(event)) return json_({ ok: false, error: 'closed' });

  const ts = verifyTurnstile_(meta);
  if (ts) return json_({ ok: false, error: ts });

  const email = v.data.email;
  let status, ref, detailsIncluded = false;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Could not obtain lock');
  try {
    if (isRateLimited_('roundtable', email)) return json_({ ok: false, error: 'rate_limited' });

    const sh = sheet_('reg');
    const t = readTable_(sh);
    const cEvent = t.idx['Event ID'], cEmail = t.idx['Email'], cStatus = t.idx['Registration status'], cRef = t.idx['Ref'];

    // Duplicate (same email + event, not cancelled): return the existing status.
    let registered = 0;
    for (const row of t.rows) {
      if (String(row[cEvent]) !== event.id) continue;
      const st = String(row[cStatus]);
      if (st === 'Cancelled') continue;
      if (unsafe_(row[cEmail]).toLowerCase() === email.toLowerCase()) {
        recordSubmission_('roundtable', email);
        return json_({ ok: true, status: st === 'Waitlisted' ? 'waitlisted' : 'registered', ref: String(row[cRef]) });
      }
      if (st === 'Registered') registered++;
    }

    status = registered < event.capacity ? 'Registered' : 'Waitlisted';
    ref = makeRef_('R');
    detailsIncluded = status === 'Registered' && !!event.start && !!event.link;
    sh.appendRow(buildRow_(t, {
      'Submitted at': new Date(),
      'Ref': ref,
      'Event ID': event.id,
      'Name': v.data.name,
      'Role': v.data.role,
      'Organization': v.data.organization,
      'Email': email,
      'Question': v.data.question,
      'Future updates': v.data.updates ? 'Yes' : 'No',
      'Registration status': status,
      'Details sent at': detailsIncluded ? new Date() : '',
      'Attended': false,
    }));
    applyRowValidation_(sh, 'reg', sh.getLastRow());
    recordSubmission_('roundtable', email);
  } finally {
    lock.releaseLock();
  }

  const cfg = config_();
  if (status === 'Registered') {
    safeSend_(email, 'Your roundtable registration is confirmed (' + ref + ')',
      registeredBody_(v.data, event, ref, detailsIncluded), cfg);
  } else {
    safeSend_(email, 'You are on the roundtable waitlist (' + ref + ')',
      waitlistedBody_(v.data, event, ref), cfg);
  }
  safeSend_(cfg.notifyEmail, 'Roundtable registration ' + ref + ' (' + status + ') — ' + event.id,
    notifyBody_('roundtable registration', ref, [
      ['Event', event.id + ' — ' + event.title], ['Status', status],
      ['Name', v.data.name], ['Role', v.data.role], ['Organization', v.data.organization],
      ['Email', email], ['Question', v.data.question || '(none)'],
      ['Future updates', v.data.updates ? 'Yes' : 'No'],
      ['Page', strOrEmpty_(meta.page).slice(0, 200)],
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
  data.question = textField_(f, 'question', 0, 1000, false, errors);
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

// Trim, strip control characters (keeps newlines/tabs), enforce length.
function textField_(f, key, min, max, required, errors) {
  const raw = f[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors[key] = 'Please enter your ' + LABELS[key] + '.';
    return '';
  }
  if (typeof raw !== 'string') {
    errors[key] = 'Please enter your ' + LABELS[key] + ' as text.';
    return '';
  }
  const v = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!v) {
    if (required) errors[key] = 'Please enter your ' + LABELS[key] + '.';
    return '';
  }
  if (v.length < min) errors[key] = 'Please enter at least ' + min + ' characters.';
  else if (v.length > max) errors[key] = 'Please keep this to ' + max + ' characters or fewer.';
  return v;
}

function emailField_(f, errors) {
  const raw = f.email;
  if (typeof raw !== 'string' || !raw.trim()) {
    errors.email = 'Please enter your email address.';
    return '';
  }
  const v = raw.trim();
  if (v.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(v)) {
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
// Spam protection
// ---------------------------------------------------------------------------

// Returns null when OK, otherwise an error code ('spam').
function verifyTurnstile_(meta) {
  const secret = config_().turnstileSecret;
  if (!secret) return null; // Turnstile not configured
  const token = typeof meta.turnstileToken === 'string' ? meta.turnstileToken.trim() : '';
  if (!token || token.length > 4096) return 'spam';
  const res = UrlFetchApp.fetch(TURNSTILE_VERIFY_URL, {
    method: 'post',
    payload: { secret: secret, response: token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return 'spam';
  let body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (err) {
    return 'spam';
  }
  return body && body.success === true ? null : 'spam';
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

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function readTable_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i; });
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

// Formula-injection guard: text starting with = + - @ is stored as literal text.
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

function setCell_(t, rowIndex, name, value) {
  // rowIndex is the 0-based index into t.rows; sheet row = rowIndex + 2.
  t.sheet.getRange(rowIndex + 2, col_(t, name)).setValue(value);
  t.rows[rowIndex][t.idx[name]] = value;
}

// Dropdowns / checkboxes on a freshly appended row (in case it is past the pre-formatted range).
function applyRowValidation_(sh, key, row) {
  const t = { sheet: sh, headers: HEADERS[key], idx: {} };
  HEADERS[key].forEach((h, i) => { t.idx[h] = i; });
  if (key === 'consult') {
    sh.getRange(row, col_(t, 'Status')).setDataValidation(listRule_(CONSULT_STATUSES));
  } else if (key === 'reg') {
    sh.getRange(row, col_(t, 'Registration status')).setDataValidation(listRule_(REG_STATUSES));
    sh.getRange(row, col_(t, 'Attended')).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

function listRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
}

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

function send_(to, subject, body, cfg) {
  MailApp.sendEmail(to, subject, body, { name: cfg.senderName, replyTo: cfg.notifyEmail });
}

// Best-effort send for transactional emails: never fails the request.
function safeSend_(to, subject, body, cfg) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      console.warn('Mail quota exhausted; not sent: ' + subject);
      return false;
    }
    send_(to, subject, body, cfg);
    return true;
  } catch (err) {
    console.error('Email failed (' + subject + '): ' + err);
    return false;
  }
}

function formatWhen_(date, durationMin) {
  const tz = Session.getScriptTimeZone();
  let s = Utilities.formatDate(date, tz, "EEEE, MMMM d, yyyy 'at' h:mm a z");
  if (durationMin) s += ' (' + durationMin + ' minutes)';
  return s;
}

function sign_() {
  return '\n\nWarm regards,\n' + SIGNATURE;
}

function consultConfirmBody_(d, ref, cfg) {
  return 'Hello ' + d.name + ',\n\n' +
    'Thank you for applying for a complimentary conversation with Parseus AI. We have received your application (reference ' + ref + ').\n\n' +
    'We review every application personally. We are offering ten complimentary 20-minute conversations. ' +
    'If your application is selected, you will receive a private scheduling link by email.\n\n' +
    'Please do not send confidential or commercially sensitive information by email or through our forms.\n\n' +
    'If you would like to withdraw your application, simply reply to this email and let us know.' +
    sign_();
}

function notifyBody_(kind, ref, pairs) {
  let url = '';
  try { url = ss_().getUrl(); } catch (err) { url = ''; }
  return 'A new ' + kind + ' has been stored (' + ref + ').\n\n' +
    pairs.map(p => p[0] + ': ' + p[1]).join('\n\n') +
    (url ? '\n\nOpen the Sheet: ' + url : '') + '\n';
}

function registeredBody_(d, ev, ref, includeDetails) {
  let body = 'Hello ' + d.name + ',\n\n' +
    'Thank you for registering for the Parseus AI roundtable "' + ev.title + '". Your place is confirmed (reference ' + ref + ').\n\n';
  if (ev.start) {
    body += 'When: ' + formatWhen_(ev.start, ev.duration) + '\n';
    if (includeDetails) body += 'Joining link: ' + ev.link + '\n';
    else body += 'Joining details will be sent by email before the session.\n';
    body += '\n';
  } else {
    body += 'The date and joining details will be sent by email once confirmed.\n\n';
  }
  body += 'If your plans change, simply reply to this email and we will release your place to someone on the waitlist.' + sign_();
  return body;
}

function waitlistedBody_(d, ev, ref) {
  return 'Hello ' + d.name + ',\n\n' +
    'Thank you for your interest in the Parseus AI roundtable "' + ev.title + '". The session is currently full, so we have added you to the waitlist (reference ' + ref + ').\n\n' +
    'If a place opens, we will email you straight away.' + sign_();
}

function bookingBody_(name, url) {
  return 'Hello ' + name + ',\n\n' +
    'Thank you for your application. We are pleased to offer you one of our ten complimentary 20-minute conversations with Parseus AI.\n\n' +
    'Please choose a time that suits you using this private scheduling link:\n' + url + '\n\n' +
    'This link is intended for you only, so please do not share it. Please do not send confidential or commercially sensitive information ahead of the conversation.\n\n' +
    'If you are no longer able to take part, simply reply to this email.' + sign_();
}

function detailsBody_(name, ev) {
  return 'Hello ' + name + ',\n\n' +
    'Here are the details for the Parseus AI roundtable "' + ev.title + '".\n\n' +
    'When: ' + formatWhen_(ev.start, ev.duration) + '\n' +
    'Joining link: ' + ev.link + '\n\n' +
    'Please keep this link to yourself. If you can no longer attend, simply reply to this email so we can offer your place to someone on the waitlist.' + sign_();
}

function reminderBody_(name, ev) {
  return 'Hello ' + name + ',\n\n' +
    'A friendly reminder that the Parseus AI roundtable "' + ev.title + '" takes place soon.\n\n' +
    'When: ' + formatWhen_(ev.start, ev.duration) + '\n' +
    'Joining link: ' + ev.link + '\n\n' +
    'We look forward to the conversation. If you can no longer attend, simply reply to this email.' + sign_();
}

function promotedBody_(name, ev) {
  let body = 'Hello ' + name + ',\n\n' +
    'Good news: a place has opened at the Parseus AI roundtable "' + ev.title + '", and your registration is now confirmed.\n\n';
  if (ev.start && ev.link) {
    body += 'When: ' + formatWhen_(ev.start, ev.duration) + '\nJoining link: ' + ev.link + '\n\n';
  } else if (ev.start) {
    body += 'When: ' + formatWhen_(ev.start, ev.duration) + '\nJoining details will be sent by email before the session.\n\n';
  } else {
    body += 'The date and joining details will be sent by email once confirmed.\n\n';
  }
  body += 'If you can no longer attend, simply reply to this email.' + sign_();
  return body;
}

function consultFollowUpBody_(name) {
  return 'Hello ' + name + ',\n\n' +
    'Thank you for taking the time to speak with Parseus AI. We enjoyed the conversation and hope it was useful.\n\n' +
    'If you would like to continue the discussion or explore next steps, simply reply to this email.' + sign_();
}

function roundtableFollowUpBody_(name, ev, wantsUpdates) {
  return 'Hello ' + name + ',\n\n' +
    'Thank you for joining the Parseus AI roundtable "' + (ev ? ev.title : 'roundtable') + '". We appreciated your perspective.\n\n' +
    (wantsUpdates ? 'As requested, we will keep you informed about future roundtables.\n\n' : '') +
    'If you have thoughts on the discussion or topics for future sessions, simply reply to this email.' + sign_();
}

// ---------------------------------------------------------------------------
// Setup (run once from the Apps Script editor)
// ---------------------------------------------------------------------------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open Apps Script from the Sheet (Extensions → Apps Script) and run setup() there.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  // Defaults (only if not already set).
  const defaults = { NOTIFY_EMAIL: 'info@parseus.ai', CONSULTATION_CAP: '10', SENDER_NAME: 'Parseus AI' };
  Object.keys(defaults).forEach(k => { if (!props.getProperty(k)) props.setProperty(k, defaults[k]); });

  const consult = ensureSheet_(ss, 'consult');
  const reg = ensureSheet_(ss, 'reg');
  const events = ensureSheet_(ss, 'events');

  // Dropdowns and checkboxes for the data rows.
  const rows = n => Math.max(n.getMaxRows() - 1, 1);
  consult.getRange(2, HEADERS.consult.indexOf('Status') + 1, rows(consult), 1).setDataValidation(listRule_(CONSULT_STATUSES));
  reg.getRange(2, HEADERS.reg.indexOf('Registration status') + 1, rows(reg), 1).setDataValidation(listRule_(REG_STATUSES));
  reg.getRange(2, HEADERS.reg.indexOf('Attended') + 1, rows(reg), 1).insertCheckboxes();
  events.getRange(2, HEADERS.events.indexOf('Registration open') + 1, rows(events), 1).insertCheckboxes();

  // Date formats.
  const dt = 'yyyy-mm-dd hh:mm';
  ['Submitted at', 'Decision date', 'Booking link sent at', 'Conversation date', 'Follow-up sent at'].forEach(h =>
    consult.getRange(2, HEADERS.consult.indexOf(h) + 1, rows(consult), 1).setNumberFormat(dt));
  ['Submitted at', 'Details sent at', 'Reminder sent at', 'Follow-up sent at'].forEach(h =>
    reg.getRange(2, HEADERS.reg.indexOf(h) + 1, rows(reg), 1).setNumberFormat(dt));
  events.getRange(2, HEADERS.events.indexOf('Start') + 1, rows(events), 1).setNumberFormat(dt);

  // Seed the first roundtable once.
  if (events.getLastRow() < 2) {
    events.appendRow(['rt-01', 'From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?',
      '', 60, 25, true, '', 'Capacity 25 is a placeholder. Set Start and Meeting link once confirmed.']);
  }

  // Remove the empty default tab if present.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  try {
    SpreadsheetApp.getUi().alert('Setup complete. Tabs, headers and dropdowns are ready.');
  } catch (err) { /* running without UI */ }
}

function ensureSheet_(ss, key) {
  let sh = ss.getSheetByName(SHEETS[key]);
  if (!sh) sh = ss.insertSheet(SHEETS[key]);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]);
  }
  sh.getRange(1, 1, 1, HEADERS[key].length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// ---------------------------------------------------------------------------
// Sheet menu & selection guard
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Parseus')
    .addItem('Send booking links to Selected applicants', 'sendBookingLinks')
    .addItem('Show consultation places used', 'showConsultationCap')
    .addItem('Send consultation follow-ups (Completed)', 'sendConsultationFollowUps')
    .addSeparator()
    .addItem('Send event details to registrants', 'sendEventDetails')
    .addItem('Promote from waitlist', 'promoteFromWaitlist')
    .addItem('Send due reminders now', 'sendRemindersNow')
    .addItem('Send roundtable follow-ups (Attended)', 'sendRoundtableFollowUps')
    .addSeparator()
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

/** Simple trigger: refuses to mark more applicants "Selected" than the cap allows. */
function onEdit(e) {
  try {
    if (!e || !e.range || e.value !== 'Selected') return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEETS.consult) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    const t = readTable_(sh);
    if (e.range.getColumn() !== col_(t, 'Status')) return;
    const cap = config_().cap;
    if (placesUsed_(t) > cap) {
      e.range.setValue(e.oldValue !== undefined ? e.oldValue : 'Under review');
      sh.getParent().toast('All ' + cap + ' complimentary conversations are already allocated. Status was not changed.', 'Parseus', 8);
    }
  } catch (err) {
    console.error('onEdit: ' + err);
  }
}

function showConsultationCap() {
  const t = readTable_(sheet_('consult'));
  const cap = config_().cap;
  const used = placesUsed_(t);
  SpreadsheetApp.getUi().alert('Complimentary conversations: ' + used + ' of ' + cap + ' places used (' +
    Math.max(cap - used, 0) + ' remaining).' + (used > cap ? '\n\nWarning: more rows are selected than the cap allows.' : ''));
}

/** Menu: email the private booking link to Selected applicants (up to the cap). */
function sendBookingLinks() {
  const ui = SpreadsheetApp.getUi();
  const cfg = config_();
  if (!cfg.bookingUrl) {
    ui.alert('BOOKING_URL is not set.\n\nAdd it in Apps Script → Project Settings → Script properties, then try again. No emails were sent.');
    return;
  }
  const t = readTable_(sheet_('consult'));
  const cS = t.idx['Status'], cB = t.idx['Booking link sent at'];
  const pending = [];
  t.rows.forEach((r, i) => { if (String(r[cS]) === 'Selected' && isBlank_(r[cB])) pending.push(i); });
  if (!pending.length) {
    ui.alert('No applicants are waiting for a booking link (Status "Selected" with no "Booking link sent at").');
    return;
  }
  const remaining = cfg.cap - linksSent_(t);
  if (remaining <= 0) {
    ui.alert('All ' + cfg.cap + ' complimentary conversations have already been offered. No emails were sent.');
    return;
  }
  let batch = pending.slice(0, remaining);
  const quota = MailApp.getRemainingDailyQuota();
  if (quota < batch.length) batch = batch.slice(0, Math.max(quota, 0));
  if (!batch.length) {
    ui.alert('The daily email quota is used up. Please try again tomorrow.');
    return;
  }
  const overCap = pending.length - Math.min(pending.length, remaining);
  const confirm = ui.alert('Send booking links',
    'Send the private booking link to ' + batch.length + ' applicant(s)?' +
    (overCap ? '\n\nWarning: ' + overCap + ' Selected applicant(s) exceed the cap of ' + cfg.cap + ' and will NOT be emailed.' : ''),
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  let sent = 0;
  const now = new Date();
  batch.forEach(i => {
    const r = t.rows[i];
    const email = unsafe_(r[t.idx['Email']]);
    if (!email) return;
    send_(email, 'Your complimentary conversation with Parseus AI', bookingBody_(unsafe_(r[t.idx['Name']]), cfg.bookingUrl), cfg);
    setCell_(t, i, 'Booking link sent at', now);
    setCell_(t, i, 'Status', 'Booking link sent');
    if (isBlank_(r[t.idx['Decision date']])) setCell_(t, i, 'Decision date', now);
    sent++;
  });
  ui.alert('Booking links sent: ' + sent + '.' +
    (overCap ? '\n\n' + overCap + ' Selected applicant(s) were not emailed because the cap of ' + cfg.cap + ' is reached.' : '') +
    (batch.length < Math.min(pending.length, remaining) ? '\n\nSome were not sent because of the daily email quota.' : ''));
}

/** Menu: follow-up to consultations marked Completed. */
function sendConsultationFollowUps() {
  const ui = SpreadsheetApp.getUi();
  const cfg = config_();
  const t = readTable_(sheet_('consult'));
  const todo = [];
  t.rows.forEach((r, i) => {
    if (String(r[t.idx['Status']]) === 'Completed' && isBlank_(r[t.idx['Follow-up sent at']])) todo.push(i);
  });
  if (!todo.length) { ui.alert('No completed conversations are waiting for a follow-up.'); return; }
  const batch = todo.slice(0, Math.max(MailApp.getRemainingDailyQuota(), 0));
  if (ui.alert('Send follow-ups', 'Send a follow-up email to ' + batch.length + ' person(s)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const now = new Date();
  batch.forEach(i => {
    const r = t.rows[i];
    send_(unsafe_(r[t.idx['Email']]), 'Thank you for speaking with Parseus AI', consultFollowUpBody_(unsafe_(r[t.idx['Name']])), cfg);
    setCell_(t, i, 'Follow-up sent at', now);
    setCell_(t, i, 'Status', 'Follow-up sent');
  });
  ui.alert('Follow-ups sent: ' + batch.length + '.' + (batch.length < todo.length ? ' The rest were held back by the daily email quota.' : ''));
}

/** Menu: send date/time + meeting link to Registered rows without "Details sent at". */
function sendEventDetails() {
  const ui = SpreadsheetApp.getUi();
  const cfg = config_();
  const events = readEvents_();
  const ready = {};
  const notReady = [];
  events.forEach(ev => {
    if (ev.start && ev.link && ev.start.getTime() > Date.now()) ready[ev.id] = ev;
    else notReady.push(ev.id);
  });
  const t = readTable_(sheet_('reg'));
  const todo = [];
  t.rows.forEach((r, i) => {
    const ev = ready[String(r[t.idx['Event ID']])];
    if (ev && String(r[t.idx['Registration status']]) === 'Registered' && isBlank_(r[t.idx['Details sent at']])) todo.push(i);
  });
  const skippedNote = notReady.length ? '\n\nSkipped (needs a future Start and a Meeting link in the Events tab): ' + notReady.join(', ') : '';
  if (!todo.length) { ui.alert('No registrants are waiting for event details.' + skippedNote); return; }
  const batch = todo.slice(0, Math.max(MailApp.getRemainingDailyQuota(), 0));
  if (ui.alert('Send event details', 'Send date, time and joining link to ' + batch.length + ' registrant(s)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const now = new Date();
  batch.forEach(i => {
    const r = t.rows[i];
    const ev = ready[String(r[t.idx['Event ID']])];
    send_(unsafe_(r[t.idx['Email']]), 'Joining details: ' + ev.title, detailsBody_(unsafe_(r[t.idx['Name']]), ev), cfg);
    setCell_(t, i, 'Details sent at', now);
  });
  ui.alert('Event details sent: ' + batch.length + '.' + (batch.length < todo.length ? ' The rest were held back by the daily email quota.' : '') + skippedNote);
}

/** Core: fill freed capacity from the waitlist in submission order. Returns number promoted. */
function promoteWaitlistCore_() {
  const cfg = config_();
  const events = readEvents_();
  const t = readTable_(sheet_('reg'));
  const cE = t.idx['Event ID'], cS = t.idx['Registration status'];
  let promoted = 0;
  const now = new Date();
  events.forEach(ev => {
    if (ev.start && ev.start.getTime() <= Date.now()) return; // past events
    const registered = t.rows.filter(r => String(r[cE]) === ev.id && String(r[cS]) === 'Registered').length;
    let free = ev.capacity - registered;
    if (free <= 0) return;
    // Sheet order is submission order; sort by "Submitted at" in case rows were re-sorted.
    const waiting = [];
    t.rows.forEach((r, i) => { if (String(r[cE]) === ev.id && String(r[cS]) === 'Waitlisted') waiting.push(i); });
    waiting.sort((a, b) => toTime_(t.rows[a][t.idx['Submitted at']]) - toTime_(t.rows[b][t.idx['Submitted at']]) || a - b);
    for (const i of waiting) {
      if (free <= 0 || MailApp.getRemainingDailyQuota() < 1) break;
      const r = t.rows[i];
      setCell_(t, i, 'Registration status', 'Registered');
      send_(unsafe_(r[t.idx['Email']]), 'A place has opened: ' + ev.title, promotedBody_(unsafe_(r[t.idx['Name']]), ev), cfg);
      if (ev.start && ev.link) setCell_(t, i, 'Details sent at', now);
      free--;
      promoted++;
    }
  });
  return promoted;
}

function toTime_(v) {
  return isDate_(v) ? v.getTime() : (Date.parse(v) || 0);
}

function promoteFromWaitlist() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { SpreadsheetApp.getUi().alert('Busy, please try again in a moment.'); return; }
  let n;
  try { n = promoteWaitlistCore_(); } finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().alert(n ? 'Promoted from waitlist and emailed: ' + n + '.' : 'No places are free, or nobody is on the waitlist.');
}

/** Core: reminders for events starting within the next 24 hours, once per registrant. No UI (runs from a trigger). */
function sendRemindersCore_() {
  const cfg = config_();
  const now = Date.now();
  const due = {};
  readEvents_().forEach(ev => {
    if (!ev.start || !ev.link) return;
    const ms = ev.start.getTime() - now;
    if (ms > 0 && ms <= 24 * 3600 * 1000) due[ev.id] = ev;
  });
  if (!Object.keys(due).length) return 0;
  const t = readTable_(sheet_('reg'));
  let sent = 0;
  const stamp = new Date();
  t.rows.forEach((r, i) => {
    const ev = due[String(r[t.idx['Event ID']])];
    if (!ev || String(r[t.idx['Registration status']]) !== 'Registered' || !isBlank_(r[t.idx['Reminder sent at']])) return;
    if (MailApp.getRemainingDailyQuota() < 1) return;
    send_(unsafe_(r[t.idx['Email']]), 'Reminder: ' + ev.title, reminderBody_(unsafe_(r[t.idx['Name']]), ev), cfg);
    setCell_(t, i, 'Reminder sent at', stamp);
    sent++;
  });
  return sent;
}

/** Time-driven trigger target (hourly). */
function sendReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { sendRemindersCore_(); } finally { lock.releaseLock(); }
}

function sendRemindersNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { SpreadsheetApp.getUi().alert('Busy, please try again in a moment.'); return; }
  let n;
  try { n = sendRemindersCore_(); } finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().alert('Reminders sent: ' + n + '. (Only events starting within the next 24 hours with a Meeting link are included.)');
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
  const cfg = config_();
  const events = {};
  readEvents_().forEach(ev => { events[ev.id] = ev; });
  const t = readTable_(sheet_('reg'));
  const todo = [];
  t.rows.forEach((r, i) => {
    const att = r[t.idx['Attended']];
    if ((att === true || String(att).toUpperCase() === 'TRUE') && isBlank_(r[t.idx['Follow-up sent at']])) todo.push(i);
  });
  if (!todo.length) { ui.alert('No attendees are waiting for a follow-up.'); return; }
  const batch = todo.slice(0, Math.max(MailApp.getRemainingDailyQuota(), 0));
  if (ui.alert('Send follow-ups', 'Send a thank-you email to ' + batch.length + ' attendee(s)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const now = new Date();
  batch.forEach(i => {
    const r = t.rows[i];
    const ev = events[String(r[t.idx['Event ID']])];
    send_(unsafe_(r[t.idx['Email']]), 'Thank you for joining the Parseus AI roundtable',
      roundtableFollowUpBody_(unsafe_(r[t.idx['Name']]), ev, String(r[t.idx['Future updates']]) === 'Yes'), cfg);
    setCell_(t, i, 'Follow-up sent at', now);
  });
  ui.alert('Follow-ups sent: ' + batch.length + '.' + (batch.length < todo.length ? ' The rest were held back by the daily email quota.' : ''));
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}
