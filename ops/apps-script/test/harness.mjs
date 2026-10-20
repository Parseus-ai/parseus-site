// Test harness for ops/apps-script/Code.gs
// Run: node ops/apps-script/test/harness.mjs
// Loads Code.gs into a Node `vm` context with in-memory mocks of the Apps Script services.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, '..', 'Code.gs'), 'utf8');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockRange {
  constructor(sheet, row, col, nr = 1, nc = 1) {
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    vals.forEach((rowVals, r) => rowVals.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setDataValidation(rule) { this.sheet.validations.push({ row: this.row, col: this.col, nr: this.nr, rule }); return this; }
  insertCheckboxes() { this.sheet.validations.push({ row: this.row, col: this.col, nr: this.nr, rule: { checkbox: true } }); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.data = [];
    this.validations = [];
    this.frozen = 0;
  }
  getName() { return this.name; }
  getParent() { return this.parent; }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const r = this.data[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = v;
  }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getDataRange() { return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  appendRow(arr) { this.data.push([...arr]); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  // test helpers
  headers() { return this.data[0]; }
  col(name) { const i = this.data[0].indexOf(name); if (i < 0) throw new Error('no col ' + name); return i; }
  rows() { return this.data.slice(1); }
  cell(rowIdx, name) { return this.data[rowIdx + 1][this.col(name)]; }
  addRow(obj) { this.data.push(this.data[0].map(h => (h in obj ? obj[h] : ''))); }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = [new MockSheet('Sheet1', this)];
    this.toasts = [];
  }
  getId() { return 'test-sheet-id'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets; }
  insertSheet(n) { const s = new MockSheet(n, this); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  toast(msg) { this.toasts.push(msg); }
}

function chain(log) {
  // Chainable builder stub (menus, data validation, triggers).
  const p = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'build') return () => ({ built: true, log: [...log] });
      return (...args) => { log.push([prop, ...args]); return p; };
    },
  });
  return p;
}

function makeEnv(opts = {}) {
  const env = { flushes: 0, lockDepth: 0, lockBusy: false, failFor: null, onConfirm: null, turnstileExtra: null };
  const ss = new MockSpreadsheet();
  const props = new Map(Object.entries(opts.props || {}));
  const cache = new Map();
  const sent = [];
  const alerts = [];
  const fetches = [];
  const menus = [];
  let triggers = [];
  let quota = opts.quota ?? 100;
  let uuidCounter = 0;

  const Button = { YES: 'YES', NO: 'NO', OK: 'OK' };
  const ui = {
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
    Button,
    alert: (...args) => {
      alerts.push(args.length === 1 ? args[0] : args[0] + ' :: ' + args[1]);
      if (args.length > 2 && env.onConfirm) { const f = env.onConfirm; env.onConfirm = null; f(); }
      return opts.confirm ?? Button.YES;
    },
    createMenu: (name) => { const log = []; menus.push({ name, log }); return chain(log); },
  };

  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => (ctx.__errors = (ctx.__errors || []).concat(a.join(' '))) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      openById: () => ss,
      getUi: () => ui,
      newDataValidation: () => chain([]),
      flush: () => { env.flushes++; },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: k => { props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (env.lockBusy) return false; env.lockDepth++; return true; },
        waitLock: () => {},
        releaseLock: () => { env.lockDepth--; },
      }),
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (to, subject, body, options) => {
        if (env.failFor && env.failFor(to)) throw new Error('Service error sending to ' + to);
        quota--; sent.push({ to, subject, body, options, lockHeld: env.lockDepth > 0 });
      },
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        fetches.push({ url, params });
        const ok = params.payload.response.startsWith('good-token');
        const extra = env.turnstileExtra || {};
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: ok, ...extra }) };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_alg, s) => [...crypto.createHash('sha256').update(s).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      formatDate: (d, tz, _fmt) => `${d.toISOString()} [${tz}]`,
    },
    Session: { getScriptTimeZone: () => 'America/Vancouver' },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
      newTrigger: fn => {
        const spec = { fn, everyHours: null };
        const b = {
          timeBased: () => b,
          everyHours: n => { spec.everyHours = n; return b; },
          create: () => { const t = { getHandlerFunction: () => fn, spec }; triggers.push(t); return t; },
        };
        return b;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  ctx.setup();
  alerts.length = 0; // ignore setup alert

  Object.assign(env, {
    ctx, ss, props, cache, sent, alerts, fetches, menus,
    setQuota: q => { quota = q; },
    sheet: n => ss.getSheetByName(n),
    consult: () => ss.getSheetByName('Consultations'),
    reg: () => ss.getSheetByName('Roundtable registrations'),
    events: () => ss.getSheetByName('Events'),
    post(body) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      const out = ctx.doPost({ postData: { contents: raw, type: 'text/plain' } });
      if (out.mime !== 'application/json') throw new Error('response is not JSON mime');
      return JSON.parse(out.content);
    },
    setEvent(id, patch) {
      const ev = env.events();
      let idx = ev.rows().findIndex(r => r[0] === id);
      if (idx < 0) { ev.addRow({ 'Event ID': id, Title: 'Test event ' + id, 'Duration (min)': 60, Capacity: 25, 'Registration open': true }); idx = ev.rows().length - 1; }
      Object.entries(patch).forEach(([k, v]) => { ev.data[idx + 1][ev.col(k)] = v; });
    },
  });
  Object.defineProperty(env, 'triggers', { get: () => triggers });
  return env;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const consultFields = (over = {}) => ({
  name: 'Ada Example',
  role: 'Head of Operations',
  organization: 'Example Manufacturing Ltd',
  email: 'ada@example.com',
  area: 'Manufacturing and industrial automation',
  challenge: 'We want to understand where computer vision could reduce inspection effort on our line.',
  outcome: 'A short list of realistic first use cases.',
  stage: 'Exploring ideas',
  consent: true,
  ...over,
});
const rtFields = (over = {}) => ({
  eventId: 'rt-01',
  name: 'Ben Example',
  role: 'CTO',
  organization: 'Example Robotics Inc',
  email: 'ben@example.com',
  question: 'How do teams move beyond pilots?',
  updates: true,
  consent: true,
  ...over,
});
const meta = (over = {}) => ({ elapsedMs: 15000, page: '/consultation.html', turnstileToken: '', website: '', ...over });
const consultPayload = (f = {}, m = {}) => ({ form: 'consultation', fields: consultFields(f), meta: meta(m) });
const rtPayload = (f = {}, m = {}) => ({ form: 'roundtable', fields: rtFields(f), meta: meta(m) });

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
const isDate = v => Object.prototype.toString.call(v) === "[object Date]";
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg ? msg + ': ' : '') + `expected ${B}, got ${A}`);
}
const SIGN = 'Warm regards,\nParseus AI · Beyond AI Headlines\ninfo@parseus.ai';
const HOURS = h => new Date(Date.now() + h * 3600 * 1000);

// ---------------------------------------------------------------------------
// Tests: setup / health
// ---------------------------------------------------------------------------

test('setup() creates tabs, headers, frozen rows, seed event; idempotent', () => {
  const env = makeEnv();
  eq(env.ss.getSheets().map(s => s.name), ['Consultations', 'Roundtable registrations', 'Events'], 'tabs');
  eq(env.consult().headers().length, 21, 'consult header count');
  eq(env.reg().headers().length, 18, 'reg header count');
  eq(env.consult().headers()[10], 'Status');
  eq(env.reg().headers()[12], 'Attended');
  eq(env.events().headers()[6], 'Meeting link (private)');
  assert(env.consult().frozen === 1 && env.reg().frozen === 1 && env.events().frozen === 1, 'frozen header rows');
  assert(env.consult().validations.length > 0 && env.reg().validations.length > 0, 'validations applied');
  const ev = env.events().rows();
  eq(ev.length, 1, 'one seed event');
  eq(ev[0].slice(0, 7), ['rt-01', 'From AI Capabilities to Real-World Value: What Does It Take to Operationalize AI?', '', 60, 25, true, '']);
  env.ctx.setup();
  eq(env.events().rows().length, 1, 'setup idempotent');
  eq(env.props.get('NOTIFY_EMAIL'), 'info@parseus.ai');
  eq(env.props.get('CONSULTATION_CAP'), '10');
});

test('doGet health check', () => {
  const env = makeEnv();
  eq(JSON.parse(env.ctx.doGet({}).content), { ok: true, service: 'parseus-forms' });
});

// ---------------------------------------------------------------------------
// Tests: consultation
// ---------------------------------------------------------------------------

test('valid consultation → row + applicant confirmation + notification + ok', () => {
  const env = makeEnv();
  const res = env.post(consultPayload());
  eq(res.ok, true); eq(res.status, 'received');
  assert(/^C-[0-9A-F]{6}$/.test(res.ref), 'ref format ' + res.ref);
  const rows = env.consult().rows();
  eq(rows.length, 1, 'one row');
  eq(env.consult().cell(0, 'Ref'), res.ref);
  eq(env.consult().cell(0, 'Status'), 'New');
  eq(env.consult().cell(0, 'Email'), 'ada@example.com');
  eq(env.consult().cell(0, 'Desired outcome'), 'A short list of realistic first use cases.');
  assert(isDate(env.consult().cell(0, 'Submitted at')), 'timestamp');
  eq(env.sent.length, 2, 'two emails');
  const [conf, note] = env.sent;
  eq(conf.to, 'ada@example.com');
  eq(conf.options, { name: 'Parseus AI', replyTo: 'info@parseus.ai' });
  assert(conf.body.startsWith('Hello Ada Example,'), 'greeting');
  assert(conf.body.includes('we read every application individually'), 'individual review');
  assert(conf.body.includes('ten complimentary 20-minute conversations'), 'ten conversations');
  assert(conf.body.includes('private scheduling link'), 'scheduling link mention');
  assert(conf.body.includes('does not mean that your application has been selected'), 'no premature selection claim');
  eq(conf.subject, 'We received your application (' + res.ref + ')');
  assert(conf.body.includes('confidential'), 'confidential warning');
  assert(conf.body.includes('withdraw'), 'withdraw');
  assert(conf.body.trim().endsWith(SIGN), 'signature');
  assert(!/undefined|null/.test(conf.body), 'no undefined in body');
  eq(note.to, 'info@parseus.ai');
  assert(note.body.includes(res.ref) && note.body.includes('docs.google.com/spreadsheets'), 'notify has ref + sheet link');
  assert(note.body.includes('Example Manufacturing Ltd'), 'notify has fields');
});

test('NOTIFY_EMAIL / SENDER_NAME properties are honoured', () => {
  const env = makeEnv({ props: { NOTIFY_EMAIL: 'team@example.org', SENDER_NAME: 'Parseus Team' } });
  env.post(consultPayload());
  eq(env.sent[1].to, 'team@example.org');
  eq(env.sent[0].options, { name: 'Parseus Team', replyTo: 'team@example.org' });
});

test('consultation validation errors per field', () => {
  const env = makeEnv();
  const cases = [
    [{ name: '' }, 'name'], [{ name: 'A' }, 'name'], [{ name: 'x'.repeat(121) }, 'name'],
    [{ role: undefined }, 'role'], [{ role: 'r'.repeat(121) }, 'role'],
    [{ organization: ' ' }, 'organization'], [{ organization: 'o'.repeat(161) }, 'organization'],
    [{ email: '' }, 'email'], [{ email: 'not-an-email' }, 'email'], [{ email: 'a@b' }, 'email'],
    [{ email: 'a'.repeat(250) + '@example.com' }, 'email'],
    [{ area: 'Quantum' }, 'area'], [{ area: '' }, 'area'],
    [{ challenge: 'too short' }, 'challenge'], [{ challenge: 'c'.repeat(2001) }, 'challenge'],
    [{ outcome: 'short' }, 'outcome'], [{ outcome: 'o'.repeat(1001) }, 'outcome'],
    [{ stage: 'Done' }, 'stage'],
    [{ consent: false }, 'consent'], [{ consent: 'true' }, 'consent'],
    [{ name: 42 }, 'name'],
  ];
  for (const [over, field] of cases) {
    const res = env.post(consultPayload(over));
    eq(res.ok, false, JSON.stringify(over));
    eq(res.error, 'validation', JSON.stringify(over));
    assert(res.fields && typeof res.fields[field] === 'string', `fields.${field} for ${JSON.stringify(over).slice(0, 60)}`);
    eq(Object.keys(res.fields), [field], 'only the bad field reported');
  }
  const multi = env.post(consultPayload({ name: '', email: 'x', consent: false }));
  eq(Object.keys(multi.fields).sort(), ['consent', 'email', 'name']);
  eq(env.consult().rows().length, 0, 'nothing stored');
  eq(env.sent.length, 0, 'nothing emailed');
});

test('values are trimmed and formula-injection is neutralised', () => {
  const env = makeEnv();
  env.post(consultPayload({ name: '  =HYPERLINK("x")  ', role: '+Admin', organization: '@Org', challenge: '-' + 'c'.repeat(40) }));
  eq(env.consult().cell(0, 'Name'), "'=HYPERLINK(\"x\")");
  eq(env.consult().cell(0, 'Role'), "'+Admin");
  eq(env.consult().cell(0, 'Organization'), "'@Org");
  assert(env.consult().cell(0, 'Challenge').startsWith("'-"), 'challenge prefixed');
});

test('honeypot filled → ok "received" but nothing stored or emailed', () => {
  const env = makeEnv();
  const res = env.post(consultPayload({}, { website: 'http://spam.example' }));
  eq(res.ok, true); eq(res.status, 'received'); assert(/^C-/.test(res.ref));
  const res2 = env.post(rtPayload({}, { website: 'x' }));
  eq(res2.ok, true); eq(res2.status, 'received');
  eq(env.consult().rows().length, 0); eq(env.reg().rows().length, 0); eq(env.sent.length, 0);
});

test('elapsedMs < 3000 → silent drop', () => {
  const env = makeEnv();
  const res = env.post(consultPayload({}, { elapsedMs: 1200 }));
  eq(res, { ok: true, status: 'received', ref: res.ref });
  eq(env.consult().rows().length, 0); eq(env.sent.length, 0);
});

test('rate limit: >3 per email per hour per form → rate_limited (repeats stored once)', () => {
  const env = makeEnv();
  for (let i = 0; i < 3; i++) eq(env.post(consultPayload()).ok, true, 'submission ' + (i + 1));
  const res = env.post(consultPayload({ email: 'ADA@example.com' }));
  eq(res, { ok: false, error: 'rate_limited' });
  eq(env.consult().rows().length, 1, 'repeat applications within the duplicate window are not stored again');
  eq(env.post(consultPayload({ email: 'other@example.com' })).ok, true, 'other email unaffected');
  eq(env.post(rtPayload({ email: 'ada@example.com' })).ok, true, 'other form unaffected');
});

test('Turnstile: secret set → missing/failed token = spam; good token = stored', () => {
  const env = makeEnv({ props: { TURNSTILE_SECRET: 'test-secret' } });
  eq(env.post(consultPayload({}, { turnstileToken: '' })), { ok: false, error: 'spam' });
  eq(env.post(consultPayload({}, { turnstileToken: 'bad-token' })), { ok: false, error: 'spam' });
  eq(env.consult().rows().length, 0);
  const ok = env.post(consultPayload({}, { turnstileToken: 'good-token' }));
  eq(ok.ok, true);
  eq(env.consult().rows().length, 1);
  const last = env.fetches.at(-1);
  assert(last.url.includes('challenges.cloudflare.com/turnstile/v0/siteverify'), 'verify url');
  eq(last.params.payload, { secret: 'test-secret', response: 'good-token' });
  eq(env.post(rtPayload({}, { turnstileToken: '' })), { ok: false, error: 'spam' }, 'roundtable also protected');
});

test('Turnstile not configured → no verification call', () => {
  const env = makeEnv();
  env.post(consultPayload());
  eq(env.fetches.length, 0);
});

test('malformed / incomplete requests → bad_request', () => {
  const env = makeEnv();
  eq(env.post('{not json'), { ok: false, error: 'bad_request' });
  eq(env.post('null'), { ok: false, error: 'bad_request' });
  eq(env.post('[]'), { ok: false, error: 'bad_request' });
  eq(env.post({ form: 'other', fields: {}, meta: meta() }), { ok: false, error: 'bad_request' });
  eq(env.post({ form: 'consultation', fields: consultFields() }), { ok: false, error: 'bad_request' });
  eq(env.post({ form: 'consultation', fields: consultFields(), meta: { website: '' } }), { ok: false, error: 'bad_request' });
  eq(JSON.parse(env.ctx.doPost({}).content), { ok: false, error: 'bad_request' });
  eq(JSON.parse(env.ctx.doPost(undefined).content), { ok: false, error: 'bad_request' });
  eq(env.post('x'.repeat(30000)), { ok: false, error: 'bad_request' }, 'oversized body');
});

test('thrown exception → error "server" without leaking details', () => {
  const env = makeEnv();
  env.ss.getSheetByName = () => { throw new Error('SECRET internal path /x/y'); };
  const out = env.ctx.doPost({ postData: { contents: JSON.stringify(consultPayload()) } });
  eq(JSON.parse(out.content), { ok: false, error: 'server' });
  assert(!/SECRET|stack|Error/.test(out.content), 'no leak');
  eq(env.sent.length, 1, 'only the owner alert is sent');
  eq(env.sent[0].to, 'info@parseus.ai');
  assert(!env.sent[0].body.includes('SECRET'), 'alert does not include error text');
  env.ctx.doPost({ postData: { contents: JSON.stringify(consultPayload()) } });
  eq(env.sent.length, 1, 'owner alert is rate limited');
});

test('email failure after storing still returns ok (row kept)', () => {
  const env = makeEnv();
  env.ctx.MailApp.sendEmail = () => { throw new Error('mail down'); };
  const res = env.post(consultPayload());
  eq(res.ok, true);
  eq(env.consult().rows().length, 1);
});

// ---------------------------------------------------------------------------
// Tests: roundtable
// ---------------------------------------------------------------------------

test('roundtable within capacity → registered; no date/link invented', () => {
  const env = makeEnv();
  const res = env.post(rtPayload());
  eq(res.ok, true); eq(res.status, 'registered');
  assert(/^R-[0-9A-F]{6}$/.test(res.ref), 'ref ' + res.ref);
  const reg = env.reg();
  eq(reg.rows().length, 1);
  eq(reg.cell(0, 'Event ID'), 'rt-01');
  eq(reg.cell(0, 'Registration status'), 'Registered');
  eq(reg.cell(0, 'Future updates'), 'Yes');
  eq(reg.cell(0, 'Attended'), false);
  eq(reg.cell(0, 'Details sent at'), '');
  eq(env.sent.length, 2);
  const conf = env.sent[0];
  eq(conf.to, 'ben@example.com');
  assert(conf.body.includes('From AI Capabilities to Real-World Value'), 'topic');
  assert(conf.body.includes('The date and joining details have not been confirmed yet. We will email them to you as soon as they are set.'), 'TBC wording');
  assert(!/https?:\/\//.test(conf.body), 'no links in confirmation');
  assert(conf.body.trim().endsWith(SIGN));
  eq(env.sent[1].to, 'info@parseus.ai');
});

test('roundtable optional fields: question blank, updates omitted', () => {
  const env = makeEnv();
  const f = rtFields({ question: '' }); delete f.updates;
  const res = env.post({ form: 'roundtable', fields: f, meta: meta() });
  eq(res.status, 'registered');
  eq(env.reg().cell(0, 'Future updates'), 'No');
  const bad = env.post(rtPayload({ email: 'q@example.com', question: 'q'.repeat(1001), updates: 'yes', consent: false }));
  eq(bad.error, 'validation');
  eq(Object.keys(bad.fields).sort(), ['consent', 'question', 'updates']);
});

test('roundtable with Start but no link → date shown, link withheld', () => {
  const env = makeEnv();
  const start = HOURS(24 * 10);
  env.setEvent('rt-01', { Start: start });
  env.post(rtPayload());
  const body = env.sent[0].body;
  assert(body.includes(start.toISOString()) && body.includes('America/Vancouver'), 'formatted date in script tz');
  assert(!/https?:\/\//.test(body), 'no link');
  eq(env.reg().cell(0, 'Details sent at'), '');
});

test('roundtable with Start AND link → both included, Details sent at stamped', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Start: HOURS(24 * 10), 'Meeting link (private)': 'https://meet.example/abc' });
  env.post(rtPayload());
  assert(env.sent[0].body.includes('https://meet.example/abc'), 'link included');
  assert(isDate(env.reg().cell(0, 'Details sent at')), 'details stamped');
});

test('roundtable at capacity → waitlisted with waitlist email', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Capacity: 2 });
  eq(env.post(rtPayload({ email: 'a1@example.com' })).status, 'registered');
  eq(env.post(rtPayload({ email: 'a2@example.com' })).status, 'registered');
  const res = env.post(rtPayload({ email: 'a3@example.com' }));
  eq(res.status, 'waitlisted'); eq(res.ok, true);
  eq(env.reg().cell(2, 'Registration status'), 'Waitlisted');
  const mail = env.sent.find(m => m.to === 'a3@example.com');
  assert(mail.body.includes('waitlist') && mail.body.includes('If a place opens'), 'waitlist email');
});

test('cancelled registrations free capacity for new sign-ups', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Capacity: 1 });
  env.post(rtPayload({ email: 'a1@example.com' }));
  env.reg().data[1][env.reg().col('Registration status')] = 'Cancelled';
  eq(env.post(rtPayload({ email: 'a2@example.com' })).status, 'registered');
});

test('registration closed → error "closed" (checkbox off, or event already started)', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { 'Registration open': false });
  eq(env.post(rtPayload()), { ok: false, error: 'closed' });
  env.setEvent('rt-01', { 'Registration open': true, Start: HOURS(-1) });
  eq(env.post(rtPayload()), { ok: false, error: 'closed' });
  eq(env.reg().rows().length, 0); eq(env.sent.length, 0);
});

test('unknown eventId → validation error on eventId', () => {
  const env = makeEnv();
  const res = env.post(rtPayload({ eventId: 'rt-99' }));
  eq(res.ok, false); eq(res.error, 'validation');
  assert(typeof res.fields.eventId === 'string');
  const missing = env.post(rtPayload({ eventId: '' }));
  assert(missing.fields.eventId, 'missing eventId');
});

test('duplicate registration (same email + event) → existing status, no new row', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Capacity: 1 });
  const first = env.post(rtPayload({ email: 'dup@example.com' }));
  const w = env.post(rtPayload({ email: 'wait@example.com' }));
  eq(w.status, 'waitlisted');
  const sentBefore = env.sent.length;
  const again = env.post(rtPayload({ email: ' DUP@example.com ' }));
  eq(again, { ok: true, status: 'registered', ref: first.ref });
  const againW = env.post(rtPayload({ email: 'wait@example.com' }));
  eq(againW, { ok: true, status: 'waitlisted', ref: w.ref });
  eq(env.reg().rows().length, 2);
  eq(env.sent.length, sentBefore, 'no extra emails');
});

// ---------------------------------------------------------------------------
// Tests: menu workflow
// ---------------------------------------------------------------------------

function addConsult(env, n, patch = {}) {
  for (let i = 0; i < n; i++) {
    env.consult().addRow({
      'Submitted at': new Date(Date.now() - (1000 - env.consult().rows().length) * 60000),
      Ref: 'C-' + String(env.consult().rows().length).padStart(6, '0'),
      Name: 'Person ' + env.consult().rows().length,
      Email: `p${env.consult().rows().length}@example.com`,
      Status: 'New',
      ...patch,
    });
  }
}

test('onOpen adds the Parseus menu with all workflow items', () => {
  const env = makeEnv();
  env.ctx.onOpen();
  const m = env.menus.find(x => x.name === 'Parseus');
  assert(m, 'menu created');
  const fns = m.log.filter(l => l[0] === 'addItem').map(l => l[2]);
  for (const fn of ['sendBookingLinks', 'sendEventDetails', 'promoteFromWaitlist', 'sendRemindersNow',
    'sendConsultationFollowUps', 'sendRoundtableFollowUps', 'installReminderTrigger', 'showConsultationCap']) {
    assert(fns.includes(fn), 'menu item ' + fn);
    assert(typeof env.ctx[fn] === 'function', 'function exists ' + fn);
  }
  assert(m.log.some(l => l[0] === 'addToUi'), 'added to UI');
});

test('booking links: refuses with alert when BOOKING_URL not set', () => {
  const env = makeEnv();
  addConsult(env, 1, { Status: 'Selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 0);
  assert(env.alerts[0].includes('BOOKING_URL is not set'));
});

test('booking links: only Selected rows without "Booking link sent at"', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 1, { Status: 'New' });
  addConsult(env, 1, { Status: 'Selected' });
  addConsult(env, 1, { Status: 'Selected', 'Booking link sent at': new Date() });
  addConsult(env, 1, { Status: 'Not selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 1);
  eq(env.sent[0].to, 'p1@example.com');
  assert(env.sent[0].body.includes('https://calendar.example/private'), 'link in email');
  assert(env.sent[0].body.trim().endsWith(SIGN));
  eq(env.consult().cell(1, 'Status'), 'Booking link sent');
  assert(isDate(env.consult().cell(1, 'Booking link sent at')));
  assert(isDate(env.consult().cell(1, 'Decision date')));
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 1, 'not sent twice');
});

test('booking links: cap of 10 enforced with a warning', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 9, { Status: 'Booking link sent', 'Booking link sent at': new Date() });
  addConsult(env, 3, { Status: 'Selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 1, 'only one place left');
  assert(env.alerts.some(a => /exceed the cap of 10/.test(a)), 'warning shown: ' + env.alerts.join(' | '));
  eq(env.consult().rows().filter(r => r[env.consult().col('Status')] === 'Selected').length, 2, 'two left Selected');
  env.sent.length = 0; env.alerts.length = 0;
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 0);
  assert(env.alerts[0].includes('already been offered'), 'refuses once cap reached');
});

test('booking links: confirmation "No" sends nothing', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' }, confirm: 'NO' });
  addConsult(env, 1, { Status: 'Selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 0);
  eq(env.consult().cell(0, 'Status'), 'Selected');
});

test('onEdit: refuses to mark more than the cap as Selected', () => {
  const env = makeEnv();
  addConsult(env, 10, { Status: 'Selected' });
  addConsult(env, 1, { Status: 'Under review' });
  const sh = env.consult();
  const statusCol = sh.col('Status') + 1;
  // Simulate the user picking "Selected" on row 12 (11th applicant).
  sh.set(12, statusCol, 'Selected');
  env.ctx.onEdit({ range: sh.getRange(12, statusCol), value: 'Selected', oldValue: 'Under review' });
  eq(sh.cell(10, 'Status'), 'Under review', 'reverted');
  assert(env.ss.toasts[0].includes('already allocated'), 'toast warning');
  // Within the cap it is allowed.
  sh.set(2, statusCol, 'Not selected');
  sh.set(12, statusCol, 'Selected');
  env.ctx.onEdit({ range: sh.getRange(12, statusCol), value: 'Selected', oldValue: 'Under review' });
  eq(sh.cell(10, 'Status'), 'Selected', 'allowed within cap');
  env.ctx.showConsultationCap();
  assert(env.alerts.at(-1).includes('10 of 10'), 'cap summary');
});

test('promote from waitlist fills freed capacity in submission order and emails', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Capacity: 2 });
  ['r1', 'r2', 'w1', 'w2'].forEach(n => env.post(rtPayload({ email: n + '@example.com' })));
  eq(env.reg().rows().map(r => r[env.reg().col('Registration status')]), ['Registered', 'Registered', 'Waitlisted', 'Waitlisted']);
  env.sent.length = 0;
  env.ctx.promoteFromWaitlist();
  eq(env.sent.length, 0, 'no capacity yet → nothing');
  env.reg().data[1][env.reg().col('Registration status')] = 'Cancelled';
  env.ctx.promoteFromWaitlist();
  eq(env.sent.length, 1);
  eq(env.sent[0].to, 'w1@example.com');
  assert(env.sent[0].body.includes('a place has opened'), 'promotion email');
  eq(env.reg().cell(2, 'Registration status'), 'Registered');
  eq(env.reg().cell(3, 'Registration status'), 'Waitlisted');
  assert(env.alerts.at(-1).includes('Promoted from waitlist and emailed: 1'));
});

test('event details: Registered rows without "Details sent at", only when Start+link set', () => {
  const env = makeEnv();
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'A', Email: 'a@example.com', 'Registration status': 'Registered' });
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'B', Email: 'b@example.com', 'Registration status': 'Waitlisted' });
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'C', Email: 'c@example.com', 'Registration status': 'Registered', 'Details sent at': new Date() });
  env.ctx.sendEventDetails();
  eq(env.sent.length, 0, 'not ready without Start/link');
  assert(env.alerts[0].includes('rt-01'), 'explains skip');
  env.setEvent('rt-01', { Start: HOURS(72), 'Meeting link (private)': 'https://meet.example/xyz' });
  env.ctx.sendEventDetails();
  eq(env.sent.map(m => m.to), ['a@example.com']);
  assert(env.sent[0].body.includes('https://meet.example/xyz'));
  assert(isDate(env.reg().cell(0, 'Details sent at')));
});

test('reminders: only events within next 24h, only once per registrant', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Start: HOURS(2), 'Meeting link (private)': 'https://meet.example/soon' });
  env.setEvent('rt-02', { Start: HOURS(30), 'Meeting link (private)': 'https://meet.example/later' });
  env.setEvent('rt-00', { Start: HOURS(-2), 'Meeting link (private)': 'https://meet.example/past' });
  const add = (ev, email, status, extra = {}) => env.reg().addRow({ 'Event ID': ev, Name: email, Email: email, 'Registration status': status, ...extra });
  add('rt-01', 'soon1@example.com', 'Registered');
  add('rt-01', 'soon2@example.com', 'Registered', { 'Reminder sent at': new Date() });
  add('rt-01', 'soonw@example.com', 'Waitlisted');
  add('rt-01', 'soonc@example.com', 'Cancelled');
  add('rt-02', 'later@example.com', 'Registered');
  add('rt-00', 'past@example.com', 'Registered');
  env.ctx.sendReminders();
  eq(env.sent.map(m => m.to), ['soon1@example.com']);
  assert(env.sent[0].body.includes('https://meet.example/soon'));
  env.ctx.sendReminders();
  eq(env.sent.length, 1, 'not sent twice');
  env.ctx.sendRemindersNow();
  assert(env.alerts.at(-1).includes('Reminders sent: 0'));
});

test('install reminder trigger: hourly, replaces existing', () => {
  const env = makeEnv();
  env.ctx.installReminderTrigger();
  env.ctx.installReminderTrigger();
  eq(env.triggers.length, 1);
  eq(env.triggers[0].spec, { fn: 'sendReminders', everyHours: 1 });
});

test('follow-ups: consultations Completed without follow-up; roundtable Attended without follow-up', () => {
  const env = makeEnv();
  addConsult(env, 1, { Status: 'Completed' });
  addConsult(env, 1, { Status: 'Completed', 'Follow-up sent at': new Date() });
  addConsult(env, 1, { Status: 'Scheduled' });
  env.ctx.sendConsultationFollowUps();
  eq(env.sent.map(m => m.to), ['p0@example.com']);
  eq(env.consult().cell(0, 'Status'), 'Follow-up sent');
  env.ctx.sendConsultationFollowUps();
  eq(env.sent.length, 1, 'once only');

  env.sent.length = 0;
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'A', Email: 'att@example.com', 'Registration status': 'Registered', Attended: true, 'Future updates': 'Yes' });
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'B', Email: 'no@example.com', 'Registration status': 'Registered', Attended: false });
  env.reg().addRow({ 'Event ID': 'rt-01', Name: 'C', Email: 'done@example.com', 'Registration status': 'Registered', Attended: true, 'Follow-up sent at': new Date() });
  env.ctx.sendRoundtableFollowUps();
  eq(env.sent.map(m => m.to), ['att@example.com']);
  assert(env.sent[0].body.includes('future roundtables'), 'mentions updates opt-in');
  assert(isDate(env.reg().cell(0, 'Follow-up sent at')));
});

test('bulk sends respect the daily mail quota', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' }, quota: 2 });
  addConsult(env, 5, { Status: 'Selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 2);
  assert(env.alerts.at(-1).includes('daily email quota'));
});

// ---------------------------------------------------------------------------
// Tests: security review fixes (abuse, sanitisation, concurrency, retention)
// ---------------------------------------------------------------------------

const daysAgo = d => new Date(Date.now() - d * 86400000);
const applicantMails = env => env.sent.filter(m => m.to !== 'info@parseus.ai');

test('global throttle: per 10 minutes, across different emails; generic error; nothing stored or sent; one owner alert', () => {
  const env = makeEnv({ props: { MAX_SUBMISSIONS_PER_10_MIN: '3' } });
  for (let i = 0; i < 3; i++) eq(env.post(consultPayload({ email: `v${i}@example.com` })).ok, true);
  env.sent.length = 0;
  const res = env.post(consultPayload({ email: 'victim@example.com' }));
  eq(res, { ok: false, error: 'busy' });
  eq(env.post(rtPayload({ email: 'victim2@example.com' })), { ok: false, error: 'busy' }, 'applies to both forms');
  eq(env.consult().rows().length, 3, 'not stored');
  eq(env.reg().rows().length, 0, 'not stored');
  eq(applicantMails(env).length, 0, 'no email to the victim addresses');
  eq(env.sent.length, 1, 'exactly one owner alert');
  assert(env.sent[0].subject.includes('submission-limit'));
});

test('global throttle: rolling 24-hour cap counts older entries; old entries expire', () => {
  const now = Date.now();
  const log = [now - 23 * 3600000, now - 22 * 3600000, now - 25 * 3600000];
  const env = makeEnv({ props: { MAX_SUBMISSIONS_PER_DAY: '3', THROTTLE_LOG: JSON.stringify(log) } });
  eq(env.post(consultPayload({ email: 'a@example.com' })).ok, true, '2 in window + this one = 3');
  eq(env.post(consultPayload({ email: 'b@example.com' })), { ok: false, error: 'busy' });
  const stored = JSON.parse(env.props.get('THROTTLE_LOG'));
  eq(stored.length, 3, 'expired entry pruned');
});

test('global throttle: honeypot, invalid, rate-limited and duplicate requests do not use slots', () => {
  const env = makeEnv({ props: { MAX_SUBMISSIONS_PER_10_MIN: '1' } });
  env.post(consultPayload({}, { website: 'x' }));
  env.post(consultPayload({ email: 'bad' }));
  eq(env.post(consultPayload()).ok, true, 'first real submission accepted');
  eq(env.post(consultPayload()).ok, true, 'duplicate answered without a slot');
  eq(env.consult().rows().length, 1);
});

test('duplicate consultation within window → same ref, no row, no email; after window → new application', () => {
  const env = makeEnv();
  const first = env.post(consultPayload());
  env.sent.length = 0;
  const again = env.post(consultPayload({ email: 'Ada@Example.com', challenge: 'A different challenge text that is long enough to pass.' }));
  eq(again, { ok: true, status: 'received', ref: first.ref });
  eq(env.consult().rows().length, 1);
  eq(env.sent.length, 0, 'no emails for a repeat');
  env.consult().data[1][env.consult().col('Submitted at')] = daysAgo(31);
  env.cache.clear();
  const later = env.post(consultPayload());
  assert(later.ok && later.ref !== first.ref, 'new ref after window');
  eq(env.consult().rows().length, 2);
});

test('DUPLICATE_WINDOW_DAYS=0 disables duplicate detection', () => {
  const env = makeEnv({ props: { DUPLICATE_WINDOW_DAYS: '0' } });
  env.post(consultPayload()); env.post(consultPayload());
  eq(env.consult().rows().length, 2);
});

test('automatic emails never echo free text; unsafe names fall back to "Hello,"', () => {
  const env = makeEnv();
  const spam = 'BUY CHEAP PILLS at https://spam.example now';
  env.post(consultPayload({ name: 'Visit spam.example today', organization: 'Org https://evil.example', role: 'Role www.evil.example',
    challenge: spam + ' ' + 'x'.repeat(30), outcome: spam }));
  const conf = env.sent[0];
  eq(conf.to, 'ada@example.com');
  assert(conf.body.startsWith('Hello,\n'), 'generic greeting');
  for (const bad of ['spam.example', 'evil.example', 'PILLS', 'https://']) assert(!conf.body.includes(bad), 'no echo of ' + bad);
  assert(!conf.subject.includes('evil'), 'subject clean');
  env.sent.length = 0;
  env.post(rtPayload({ name: 'Click here: bit.ly/x', question: spam }));
  assert(env.sent[0].body.startsWith('Hello,\n') && !env.sent[0].body.includes('PILLS'), 'roundtable confirmation clean');
  const ctx = env.ctx;
  eq(ctx.hello_('Zoë O\u2019Brien-Smith'), 'Hello Zoë O\u2019Brien-Smith,');
  eq(ctx.hello_('Dr. J. Smith'), 'Hello Dr. J. Smith,');
  eq(ctx.hello_('example.com'), 'Hello,');
  eq(ctx.hello_('Win $1000 now'), 'Hello,');
  eq(ctx.hello_('A very long name that goes on and on and on'), 'Hello,');
  eq(ctx.hello_("'=HYPERLINK(1)"), 'Hello,');
});

test('sanitisation: single-line fields lose newlines/tabs; invisible and control characters removed; header injection blocked', () => {
  const env = makeEnv();
  env.post(consultPayload({
    name: 'Ada\u200B Ex\u202Eample', role: 'Head\nBcc: x@evil.example', organization: 'Org\r\nSubject: hi\t\u0007',
    challenge: 'Line one\r\n\r\n\r\n\r\nLine two\u0000 with enough text to pass validation',
  }));
  const sh = env.consult();
  eq(sh.cell(0, 'Name'), 'Ada Example');
  eq(sh.cell(0, 'Role'), 'Head Bcc: x@evil.example');
  eq(sh.cell(0, 'Organization'), 'Org Subject: hi');
  eq(sh.cell(0, 'Challenge'), 'Line one\n\nLine two  with enough text to pass validation'.replace('  ', ' '));
  const note = env.sent[1];
  assert(!/[\r\n]/.test(note.subject), 'notification subject single line');
  for (const m of env.sent) assert(!/[\r\n]/.test(m.subject) && m.subject.length <= 200, 'subjects single line');
});

test('email validation rejects lists, display names, invisible chars and header tricks', () => {
  const env = makeEnv();
  for (const email of ['a@b.com,c@d.com', 'a@b.com; c@d.com', 'Ada <a@b.com>', 'a\u200B@b.com', 'a@b.com\nBcc: c@d.com',
    '\u00E4@b.com', 'a@-b.com', 'a@b.c', 'x'.repeat(65) + '@b.com']) {
    const res = env.post(consultPayload({ email }));
    eq(res.error, 'validation', JSON.stringify(email));
    assert(res.fields.email, 'email field flagged ' + JSON.stringify(email));
  }
  for (const email of ['first.last+tag@sub.example.co.uk', 'o\'brien@example.ie', 'A_B@EXAMPLE.COM']) {
    eq(env.post(consultPayload({ email })).ok, true, email);
  }
  eq(env.sent.filter(m => /,|;|</.test(m.to)).length, 0);
});

test('formula injection: email and question columns are protected; notification stays plain text', () => {
  const env = makeEnv();
  env.post(consultPayload({ email: '=1+1@example.com' }));
  eq(env.consult().cell(0, 'Email'), "'=1+1@example.com");
  env.post(rtPayload({ question: '=IMPORTXML("https://evil.example","//a")' }));
  assert(env.reg().cell(0, 'Question').startsWith("'="), 'question prefixed');
  eq(env.consult().cell(0, 'Privacy notice version'), 'October 2026');
});

test('consent is recorded with timestamp and privacy notice version (configurable)', () => {
  const env = makeEnv({ props: { PRIVACY_NOTICE_VERSION: 'v2' } });
  env.post(consultPayload());
  env.post(rtPayload());
  assert(isDate(env.consult().cell(0, 'Consent given at')), 'consult consent time');
  eq(env.consult().cell(0, 'Privacy notice version'), 'v2');
  assert(isDate(env.reg().cell(0, 'Consent given at')), 'reg consent time');
  eq(env.reg().cell(0, 'Privacy notice version'), 'v2');
});

test('REQUIRE_TURNSTILE=true without a secret refuses everything (fail closed) and alerts the owner once', () => {
  const env = makeEnv({ props: { REQUIRE_TURNSTILE: 'true' } });
  eq(env.post(consultPayload()), { ok: false, error: 'unavailable' });
  eq(env.post(rtPayload()), { ok: false, error: 'unavailable' });
  eq(env.consult().rows().length + env.reg().rows().length, 0);
  eq(env.sent.length, 1, 'one owner alert');
  eq(env.sent[0].to, 'info@parseus.ai');
});

test('Turnstile: action must match the form; optional hostname allow-list', () => {
  const env = makeEnv({ props: { TURNSTILE_SECRET: 's', TURNSTILE_HOSTNAMES: 'parseus.ai, www.parseus.ai' } });
  env.turnstileExtra = { action: 'roundtable', hostname: 'parseus.ai' };
  eq(env.post(consultPayload({}, { turnstileToken: 'good-token' })), { ok: false, error: 'spam' }, 'token minted for the other form');
  env.turnstileExtra = { action: 'consultation', hostname: 'evil.example' };
  eq(env.post(consultPayload({}, { turnstileToken: 'good-token' })), { ok: false, error: 'spam' }, 'wrong hostname');
  env.turnstileExtra = { action: 'consultation', hostname: 'www.parseus.ai' };
  eq(env.post(consultPayload({}, { turnstileToken: 'good-token' })).ok, true);
  eq(env.post(consultPayload({ email: 'z@example.com' }, { turnstileToken: 'good-token' + 'x'.repeat(3000) })), { ok: false, error: 'spam' }, 'oversized token');
});

test('logs never contain applicant emails or submitted text', () => {
  const env = makeEnv();
  env.failFor = () => true;
  env.post(consultPayload({ organization: 'Secret Org Name' }));
  env.ss.getSheetByName = () => { throw new Error('Cannot send to ada@example.com'); };
  env.ctx.doPost({ postData: { contents: JSON.stringify(consultPayload()) } });
  const logs = (env.ctx.__errors || []).join('\n');
  assert(logs.length > 0, 'something was logged');
  assert(!logs.includes('ada@example.com') && !logs.includes('Secret Org Name') && !logs.includes('info@parseus.ai'), 'redacted: ' + logs);
});

test('doGet ignores parameters and returns no data', () => {
  const env = makeEnv();
  env.post(consultPayload());
  const out = env.ctx.doGet({ parameter: { ref: 'C-1', email: 'ada@example.com', action: 'list' } });
  eq(JSON.parse(out.content), { ok: true, service: 'parseus-forms' });
});

test('script lock busy → doPost returns generic "server" error; menu reports busy and sends nothing', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 1, { Status: 'Selected' });
  env.lockBusy = true;
  eq(env.post(rtPayload()), { ok: false, error: 'server' });
  env.ctx.sendBookingLinks();
  eq(applicantMails(env).length, 0);
  assert(env.alerts.at(-1).includes('Another Parseus action is running'), env.alerts.at(-1));
  eq(env.consult().cell(0, 'Status'), 'Selected');
});

test('bulk send: rows are claimed (stamped and flushed) before sending; emails are sent outside the lock', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 2, { Status: 'Selected' });
  let stampedBeforeSend = true;
  env.failFor = () => { if (env.consult().rows().some(r => r[env.consult().col('Booking link sent at')] === '')) stampedBeforeSend = false; return false; };
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 2);
  assert(stampedBeforeSend, 'both rows stamped before the first email');
  assert(env.sent.every(m => !m.lockHeld), 'no email sent while holding the script lock');
  assert(env.flushes > 0, 'flushed');
});

test('bulk send: a failed email is un-claimed, marked in "Last email error", and retried next run', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 2, { Status: 'Selected' });
  env.failFor = to => to === 'p0@example.com';
  env.ctx.sendBookingLinks();
  eq(env.sent.map(m => m.to), ['p1@example.com']);
  const sh = env.consult();
  eq(sh.cell(0, 'Status'), 'Selected', 'reverted');
  eq(sh.cell(0, 'Booking link sent at'), '');
  eq(sh.cell(0, 'Decision sent at'), '');
  assert(/send failed/.test(sh.cell(0, 'Last email error')), 'error noted');
  assert(env.alerts.at(-1).includes('C-000000'), 'report names the failed ref: ' + env.alerts.at(-1));
  eq(sh.cell(1, 'Status'), 'Booking link sent');
  env.failFor = null;
  env.ctx.sendBookingLinks();
  eq(env.sent.map(m => m.to), ['p1@example.com', 'p0@example.com']);
  eq(sh.cell(0, 'Last email error'), '', 'cleared after success');
});

test('bulk send: revert finds the right row by Ref even if the Sheet was re-sorted meanwhile', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  addConsult(env, 1, { Status: 'Under review' });
  addConsult(env, 1, { Status: 'Selected' });
  env.failFor = to => {
    const d = env.consult().data; [d[1], d[2]] = [d[2], d[1]]; // someone sorts the Sheet mid-run
    return to === 'p1@example.com';
  };
  env.ctx.sendBookingLinks();
  const sh = env.consult();
  const rowOf = ref => sh.rows().findIndex(r => r[sh.col('Ref')] === ref);
  eq(sh.cell(rowOf('C-000001'), 'Status'), 'Selected', 'failed row reverted');
  eq(sh.cell(rowOf('C-000000'), 'Status'), 'Under review', 'other row untouched');
});

test('two people sending booking links at once: no double send and cap re-checked under the lock', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private', CONSULTATION_CAP: '3' } });
  addConsult(env, 3, { Status: 'Selected' });
  // While person A is looking at the confirmation dialog, person B runs the same menu to completion.
  env.onConfirm = () => env.ctx.sendBookingLinks();
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 3, 'each applicant emailed exactly once');
  eq(new Set(env.sent.map(m => m.to)).size, 3);

  const env2 = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private', CONSULTATION_CAP: '2' } });
  addConsult(env2, 2, { Status: 'Selected' });
  // During the dialog, someone else records a place as used (e.g. edits via API, which onEdit cannot see).
  env2.onConfirm = () => { env2.consult().addRow({ Ref: 'C-X', Email: 'x@example.com', Status: 'Scheduled', 'Booking link sent at': new Date() }); };
  env2.ctx.sendBookingLinks();
  eq(env2.sent.length, 1, 'only the one remaining place is offered');
});

test('onEdit: multi-cell paste over the cap shows a warning (cannot revert) and the send still respects the cap', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private', CONSULTATION_CAP: '2' } });
  addConsult(env, 4, { Status: 'Selected' });
  const sh = env.consult();
  env.ctx.onEdit({ range: sh.getRange(2, sh.col('Status') + 1, 4, 1) });
  assert(env.ss.toasts.at(-1).includes('cap of 2'), 'warning toast');
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 2);
});

test('bulk send: batch size limit; the rest is sent on the next run', () => {
  const env = makeEnv();
  env.setEvent('rt-01', { Start: HOURS(72), 'Meeting link (private)': 'https://meet.example/x', Capacity: 500 });
  for (let i = 0; i < 60; i++) env.reg().addRow({ Ref: 'R-' + i, 'Event ID': 'rt-01', Name: 'P', Email: `p${i}@example.com`, 'Registration status': 'Registered' });
  env.ctx.sendEventDetails();
  eq(env.sent.length, 50);
  assert(env.alerts.at(-1).includes('10 not sent this time'), env.alerts.at(-1));
  env.ctx.sendEventDetails();
  eq(env.sent.length, 60);
  eq(new Set(env.sent.map(m => m.to)).size, 60, 'no duplicates');
});

test('decision notices: Not selected and Held get their templates, once each; Decision date filled', () => {
  const env = makeEnv();
  addConsult(env, 1, { Status: 'Not selected' });
  addConsult(env, 1, { Status: 'Held for later round' });
  addConsult(env, 1, { Status: 'Not selected', 'Decision sent at': new Date() });
  addConsult(env, 1, { Status: 'Under review' });
  env.ctx.sendDecisionNotices();
  eq(env.sent.map(m => m.to), ['p0@example.com', 'p1@example.com']);
  assert(env.sent[0].body.includes('not able to offer you a place this time'), 'not selected body');
  assert(env.sent[0].body.includes('roundtables'), 'roundtable invitation');
  assert(env.sent[1].body.includes('keep your application on file'), 'held body');
  assert(isDate(env.consult().cell(0, 'Decision sent at')) && isDate(env.consult().cell(0, 'Decision date')));
  env.ctx.sendDecisionNotices();
  eq(env.sent.length, 2, 'not sent twice');
  assert(env.alerts.at(-1).includes('No applicants are waiting for a decision notice'));
});

test('"Held for later round" does not use a place; a held applicant can later be Selected and get a link', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private', CONSULTATION_CAP: '1' } });
  addConsult(env, 1, { Status: 'Held for later round' });
  env.ctx.showConsultationCap();
  assert(env.alerts.at(-1).includes('0 of 1'), env.alerts.at(-1));
  env.consult().data[1][env.consult().col('Status')] = 'Selected';
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 1);
});

test('setup() upgrades an existing Sheet: appends missing columns without moving data', () => {
  const env = makeEnv();
  const OLD = ['Submitted at', 'Ref', 'Name', 'Role', 'Organization', 'Email', 'Area', 'Challenge', 'Desired outcome', 'Stage',
    'Status', 'Reviewer notes', 'Decision date', 'Booking link sent at', 'Conversation date', 'Follow-up sent at'];
  const sh = env.consult();
  sh.data = [OLD.slice(), OLD.map((h, i) => (h === 'Status' ? 'Not selected' : h === 'Email' ? 'old@example.com' : h === 'Ref' ? 'C-OLD' : 'v' + i))];
  // Before setup: submissions still work and the menu explains what to do.
  eq(env.post(consultPayload()).ok, true, 'works on the old layout');
  env.ctx.sendDecisionNotices();
  assert(env.alerts.at(-1).includes('Run setup'), 'asks for setup');
  env.ctx.setup();
  eq(sh.headers().slice(0, 16), OLD, 'old columns unchanged');
  eq(sh.headers().slice(16), ['Decision sent at', 'Consent given at', 'Privacy notice version', 'Last email error', 'Anonymised at']);
  eq(sh.cell(0, 'Email'), 'old@example.com', 'data in place');
  env.ctx.setup();
  eq(sh.headers().length, 21, 'idempotent');
  env.ctx.sendDecisionNotices();
  eq(applicantMails(env).filter(m => m.to === 'old@example.com').length, 1);
});

test('retention: shows counts, NO changes nothing, YES anonymises only rows past their period', () => {
  const env = makeEnv({ confirm: 'NO' });
  const sh = env.consult();
  addConsult(env, 1, { Status: 'Not selected', 'Decision date': daysAgo(200), Name: 'Old Reject', Challenge: 'text' });       // 0: due (6 months)
  addConsult(env, 1, { Status: 'Not selected', 'Decision date': daysAgo(30), Name: 'Recent Reject' });                         // 1: keep
  addConsult(env, 1, { Status: 'Completed', 'Conversation date': daysAgo(400), Name: 'Old Done' });                           // 2: due (12 months)
  addConsult(env, 1, { Status: 'Completed', 'Conversation date': daysAgo(200), Name: 'Recent Done' });                        // 3: keep
  addConsult(env, 1, { Status: 'Scheduled', 'Submitted at': daysAgo(500), Name: 'Active' });                                   // 4: never
  addConsult(env, 1, { Status: 'Under review', 'Submitted at': daysAgo(400), Name: 'Stale' });                                 // 5: due
  env.setEvent('rt-old', { Start: daysAgo(200) });
  env.reg().addRow({ Ref: 'R-1', 'Event ID': 'rt-old', Name: 'Gone', Email: 'g@example.com', Question: 'q', 'Future updates': 'No', 'Registration status': 'Registered' });
  env.reg().addRow({ Ref: 'R-2', 'Event ID': 'rt-old', Name: 'Keep Me', Email: 'k@example.com', Organization: 'Org', 'Future updates': 'Yes', 'Registration status': 'Registered' });
  env.reg().addRow({ Ref: 'R-3', 'Event ID': 'rt-01', Name: 'Upcoming', Email: 'u@example.com', 'Future updates': 'No', 'Registration status': 'Registered', 'Submitted at': new Date() });
  const usedBefore = env.ctx.placesUsed_(env.ctx.readTable_(sh));

  env.ctx.applyRetention();
  const q = env.alerts.at(-1);
  assert(q.includes('Consultations: 3 row(s)') && q.includes('Roundtable registrations: 1 row(s)') && q.includes('asked for updates: 1 row(s)'), q);
  assert(q.includes('Not touched: 1'), 'mentions active rows');
  eq(sh.cell(0, 'Name'), 'Old Reject', 'NO = unchanged');

  env.ctx.SpreadsheetApp.getUi().alert = (...a) => { env.alerts.push(a.join(' :: ')); return 'YES'; };
  env.ctx.applyRetention();
  for (const i of [0, 2, 5]) {
    for (const c of ['Name', 'Email', 'Challenge', 'Organization']) eq(sh.cell(i, c), '[removed]', `row ${i} ${c}`);
    assert(isDate(sh.cell(i, 'Anonymised at')));
  }
  for (const i of [1, 3, 4]) assert(sh.cell(i, 'Name') !== '[removed]', 'kept row ' + i);
  eq(sh.cell(0, 'Status'), 'Not selected', 'status kept');
  eq(env.ctx.placesUsed_(env.ctx.readTable_(sh)), usedBefore, 'place count unchanged');
  const rg = env.reg();
  eq(rg.cell(0, 'Email'), '[removed]'); eq(rg.cell(0, 'Question'), '[removed]');
  eq(rg.cell(1, 'Email'), 'k@example.com'); eq(rg.cell(1, 'Name'), 'Keep Me'); eq(rg.cell(1, 'Organization'), '[removed]');
  eq(rg.cell(2, 'Name'), 'Upcoming');
  env.alerts.length = 0;
  env.ctx.applyRetention();
  assert(env.alerts.at(-1).includes('Nothing was changed'), 'idempotent');
});

test('anonymised rows are skipped by menus and duplicate checks', () => {
  const env = makeEnv();
  env.post(consultPayload());
  const sh = env.consult();
  sh.data[1][sh.col('Anonymised at')] = new Date();
  sh.data[1][sh.col('Status')] = 'Not selected';
  env.sent.length = 0;
  eq(env.post(consultPayload()).ref !== sh.cell(0, 'Ref'), true, 'not treated as duplicate');
  env.ctx.sendDecisionNotices();
  eq(applicantMails(env).filter(m => m.subject.includes('application (C-') && m.body.includes('not able')).length, 0);
});

test('menu "Check setup" never shows secret values', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/SECRETLINK', TURNSTILE_SECRET: 'SECRETKEY' } });
  env.ctx.showSetupStatus();
  const a = env.alerts.at(-1);
  assert(!a.includes('SECRETLINK') && !a.includes('SECRETKEY'), a);
  assert(a.includes('BOOKING_URL: set') && a.includes('REQUIRE_TURNSTILE: false'), a);
  assert(a.includes('set REQUIRE_TURNSTILE to true'), 'activation warning');
});

test('booking link: refuses a non-https BOOKING_URL', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'javascript:alert(1)' } });
  addConsult(env, 1, { Status: 'Selected' });
  env.ctx.sendBookingLinks();
  eq(env.sent.length, 0);
  assert(env.alerts.at(-1).includes('https://'));
});

test('emails contain no em/en dashes, no unfilled placeholders, and end with the signature', () => {
  const env = makeEnv({ props: { BOOKING_URL: 'https://calendar.example/private' } });
  env.setEvent('rt-01', { Capacity: 1 });
  env.post(consultPayload()); env.post(rtPayload()); env.post(rtPayload({ email: 'w@example.com' }));
  addConsult(env, 1, { Status: 'Selected' }); env.ctx.sendBookingLinks();
  addConsult(env, 1, { Status: 'Not selected' }); addConsult(env, 1, { Status: 'Held for later round' }); env.ctx.sendDecisionNotices();
  addConsult(env, 1, { Status: 'Completed' }); env.ctx.sendConsultationFollowUps();
  env.reg().data[1][env.reg().col('Attended')] = true; env.ctx.sendRoundtableFollowUps();
  const mails = applicantMails(env);
  assert(mails.length >= 8, 'covered ' + mails.length);
  for (const m of mails) {
    assert(!/[\u2013\u2014]/.test(m.subject + m.body), 'dash in ' + m.subject);
    assert(!/\{\{|\}\}|undefined|null|NaN/.test(m.subject + m.body), 'placeholder in ' + m.subject);
    assert(m.body.endsWith(SIGN), 'signature in ' + m.subject);
  }
});

test('ops/campaign-messages.md matches the emails Code.gs sends, word for word', () => {
  const md = fs.readFileSync(path.join(here, '..', '..', 'campaign-messages.md'), 'utf8');
  const blocks = {};
  for (const m of md.matchAll(/<!-- template: ([\w-]+) -->\r?\n```text\r?\n([\s\S]*?)\r?\n```/g)) blocks[m[1]] = m[2].replace(/\r\n/g, '\n');
  assert(!/[\u2013\u2014]/.test(md), 'no em/en dashes anywhere in campaign-messages.md');
  const env = makeEnv();
  const ctx = env.ctx;
  ctx.Utilities.formatDate = () => 'DATETIME';
  const cfg = ctx.config_();
  const N = 'Ada Example', R = 'REF-1', U = 'https://booking.invalid/x', L = 'https://meet.invalid/x';
  const evNo = { title: 'EVTITLE', start: null, link: '', duration: null };
  const evDate = { title: 'EVTITLE', start: new Date(), link: '', duration: null };
  const evFull = { title: 'EVTITLE', start: new Date(), link: L, duration: null };
  const render = {
    received: ctx.consultReceivedEmail_(N, R, cfg),
    booking: ctx.bookingEmail_(N, R, U, cfg),
    'not-selected': ctx.notSelectedEmail_(N, R, cfg),
    held: ctx.heldEmail_(N, R),
    'consult-follow-up': ctx.consultFollowUpEmail_(N),
    'registered-no-date': ctx.registeredEmail_(N, evNo, R),
    'registered-date-no-link': ctx.registeredEmail_(N, evDate, R),
    'registered-date-and-link': ctx.registeredEmail_(N, evFull, R),
    'joining-details': ctx.detailsEmail_(N, evFull),
    'rt-reminder': ctx.reminderEmail_(N, evFull),
    waitlist: ctx.waitlistedEmail_(N, evNo, R),
    'waitlist-promoted': ctx.promotedEmail_(N, evFull),
    'rt-thank-you': ctx.roundtableFollowUpEmail_(N, evFull, false),
    'rt-thank-you-updates': ctx.roundtableFollowUpEmail_(N, evFull, true),
  };
  const ph = s => s.split(N).join('{{name}}').split(R).join('{{ref}}').split(U).join('{{booking_link}}')
    .split('EVTITLE').join('{{event_title}}').split('DATETIME').join('{{date_time}}').split(L).join('{{meeting_link}}');
  eq(Object.keys(blocks).sort(), Object.keys(render).sort(), 'template ids');
  for (const [k, m] of Object.entries(render)) {
    const expected = 'Subject: ' + ph(m.subject) + '\n\n' + ph(m.body);
    if (blocks[k] !== expected) {
      const a = blocks[k].split('\n'), b = expected.split('\n');
      const i = a.findIndex((line, j) => line !== b[j]);
      throw new Error(`template "${k}" differs at line ${i + 1}:\n  md:   ${a[i]}\n  code: ${b[i]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log('\nParseus forms backend — Code.gs test harness');
console.log('='.repeat(48));
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.ok) console.log('      ' + String(r.err && r.err.stack || r.err).split('\n').slice(0, 3).join('\n      '));
}
console.log('='.repeat(48));
console.log(`${passed}/${results.length} passed${failed.length ? `, ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
