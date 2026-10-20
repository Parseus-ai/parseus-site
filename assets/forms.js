/* Parseus AI: application and registration forms.
 *
 * Each <form data-form="consultation|roundtable"> sits next to:
 *   [data-form-unavailable]  shown when no endpoint is configured (default in HTML)
 *   [data-form-success]      template shown after a successful submission
 * The form itself is [hidden] in the HTML, so without JavaScript or without a
 * configured endpoint visitors only see the email alternative.
 *
 * Local review: add ?preview=forms to the URL to show the forms without a backend.
 * Nothing is sent in preview. Add &simulate=error|validation|waitlisted to see
 * those states.
 */
(function () {
  var cfg = window.PARSEUS_FORMS || {};
  var params = new URLSearchParams(location.search);
  var preview = params.get('preview') === 'forms';
  var simulate = params.get('simulate') || '';
  var endpoint = (cfg.endpoint || '').trim();
  var live = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint);
  var loadedAt = Date.now();

  var MESSAGES = {
    required: 'This field is required.',
    email: 'Enter an email address like name@company.com.',
    tooShort: function (n) { return 'Please write at least ' + n + ' characters.'; },
    tooLong: function (n) { return 'Please keep this under ' + n + ' characters.'; },
    consent: 'Please confirm you agree so we can process your submission.'
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function init(form) {
    var box = form.closest('[data-form-box]') || form.parentElement;
    var unavailable = $('[data-form-unavailable]', box);
    if (!live && !preview) return; // stay hidden; the email alternative is already visible
    if (unavailable) unavailable.hidden = true;
    form.hidden = false;
    if (preview && !live) {
      var banner = document.createElement('p');
      banner.className = 'notice preview';
      banner.setAttribute('role', 'note');
      banner.innerHTML = '<strong>Preview mode.</strong> This form is shown for review only. Submissions are not sent anywhere.';
      form.insertBefore(banner, form.firstChild);
    }
    setupCounters(form);
    if (cfg.turnstileSiteKey && live) setupTurnstile(form);
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(form, box); });
    $all('input,select,textarea', form).forEach(function (el) {
      // Re-check a flagged field while the person corrects it (not on blur, which
      // would shift the layout just as they tap the next control).
      var recheck = function () { if (el.getAttribute('aria-invalid') === 'true' && !validateField(el)) setError(el, ''); };
      el.addEventListener('input', recheck);
      el.addEventListener('change', recheck);
    });
  }

  /* ---------- Validation ---------- */
  function errorEl(el) { return document.getElementById(el.id + '-error'); }

  function setError(el, msg) {
    var err = errorEl(el);
    if (err) err.textContent = msg || '';
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }

  function validateField(el) {
    var v = el.type === 'checkbox' ? el.checked : (el.value || '').trim();
    var msg = '';
    if (el.type === 'checkbox') {
      if (el.required && !v) msg = el.dataset.msg || MESSAGES.consent;
    } else if (el.required && !v) {
      msg = el.dataset.msg || MESSAGES.required;
    } else if (v) {
      var min = parseInt(el.getAttribute('minlength') || el.dataset.min || '0', 10);
      var max = parseInt(el.getAttribute('maxlength') || '0', 10);
      if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = MESSAGES.email;
      else if (min && v.length < min) msg = MESSAGES.tooShort(min);
      else if (max && v.length > max) msg = MESSAGES.tooLong(max);
    }
    setError(el, msg);
    return msg;
  }

  function validate(form) {
    var problems = [];
    $all('[data-validate]', form).forEach(function (el) {
      var msg = validateField(el);
      if (msg) problems.push({ el: el, msg: msg });
    });
    return problems;
  }

  function showSummary(form, problems) {
    var summary = $('.error-summary', form);
    if (!problems.length) { if (summary) summary.hidden = true; return; }
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'error-summary';
      summary.setAttribute('tabindex', '-1');
      summary.setAttribute('role', 'alert');
      form.insertBefore(summary, form.querySelector('.field, .row'));
    }
    summary.hidden = false;
    summary.innerHTML = '<h2>Please check ' + (problems.length === 1 ? 'one answer' : problems.length + ' answers') + '</h2><ul></ul>';
    var ul = $('ul', summary);
    problems.forEach(function (p) {
      var label = form.querySelector('label[for="' + p.el.id + '"]');
      var name = label ? label.firstChild.textContent.trim() : p.el.name;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + p.el.id;
      a.textContent = name + ': ' + p.msg;
      a.addEventListener('click', function (e) { e.preventDefault(); p.el.focus(); });
      li.appendChild(a); ul.appendChild(li);
    });
    summary.focus();
  }

  function setupCounters(form) {
    $all('textarea[maxlength]', form).forEach(function (ta) {
      var out = document.getElementById(ta.id + '-count');
      if (!out) return;
      var max = ta.getAttribute('maxlength');
      var update = function () { out.textContent = ta.value.length + ' / ' + max; };
      ta.addEventListener('input', update); update();
    });
  }

  /* ---------- Spam protection ---------- */
  function setupTurnstile(form) {
    var slot = $('[data-turnstile]', form);
    if (!slot) return;
    slot.hidden = false;
    window.__parseusTurnstile = function () {
      if (window.turnstile) window.turnstile.render(slot, { sitekey: cfg.turnstileSiteKey, theme: 'light', action: form.dataset.form });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__parseusTurnstile';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  function turnstileToken(form) {
    var t = form.querySelector('input[name="cf-turnstile-response"]');
    return t ? t.value : '';
  }

  /* ---------- Submit ---------- */
  function collect(form) {
    var fields = {};
    $all('[name]', form).forEach(function (el) {
      if (el.name === 'website' || el.name === 'cf-turnstile-response') return;
      if (el.type === 'checkbox') fields[el.name] = el.checked;
      else fields[el.name] = (el.value || '').trim();
    });
    return fields;
  }

  function setBusy(form, busy, text, isError) {
    var btn = $('button[type="submit"]', form);
    var status = $('.form-status', form);
    if (btn) { btn.disabled = busy; btn.setAttribute('aria-busy', busy ? 'true' : 'false'); }
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (status) { status.textContent = text || ''; status.classList.toggle('err', !!isError); }
  }

  function submit(form, box) {
    var problems = validate(form);
    showSummary(form, problems);
    if (problems.length) return;

    var payload = {
      form: form.dataset.form,
      fields: collect(form),
      meta: {
        elapsedMs: Date.now() - loadedAt,
        page: location.pathname,
        turnstileToken: turnstileToken(form),
        website: (form.querySelector('[name="website"]') || {}).value || ''
      }
    };

    if (!live) { // preview only
      setBusy(form, true, 'Checking your answers…');
      setTimeout(function () {
        setBusy(form, false, '');
        if (simulate === 'error') return handleError(form, 'network');
        if (simulate === 'validation') return handleResponse(form, box, { ok: false, error: 'validation', fields: { email: 'This email address could not be accepted.' } });
        handleResponse(form, box, { ok: true, status: simulate === 'waitlisted' ? 'waitlisted' : (payload.form === 'roundtable' ? 'registered' : 'received'), ref: 'PREVIEW' });
      }, 500);
      return;
    }

    if (cfg.turnstileSiteKey && !payload.meta.turnstileToken) {
      setBusy(form, false, 'Please complete the verification check above the button, then try again.', true);
      return;
    }

    setBusy(form, true, 'Sending…');
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, cfg.timeoutMs || 20000);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      clearTimeout(timer);
      setBusy(form, false, '');
      handleResponse(form, box, data);
    }).catch(function (err) {
      clearTimeout(timer);
      handleError(form, err && err.name === 'AbortError' ? 'timeout' : 'network');
    });
  }

  function handleResponse(form, box, data) {
    if (data && data.ok) return showSuccess(form, box, data);
    var err = (data && data.error) || 'server';
    if (err === 'validation' && data.fields) {
      var problems = [];
      Object.keys(data.fields).forEach(function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el) { setError(el, data.fields[name]); problems.push({ el: el, msg: data.fields[name] }); }
      });
      if (problems.length) { showSummary(form, problems); setBusy(form, false, ''); return; }
    }
    var text = {
      spam: 'We couldn’t verify this submission. Please refresh the page and try again.',
      rate_limited: 'We’ve already received several submissions from this email address recently. Please email info@parseus.ai if you need to update your details.',
      closed: 'Registration for this roundtable is closed. Email info@parseus.ai to hear about future dates.',
      bad_request: 'Something went wrong with this form. Please refresh the page and try again.'
    }[err] || 'Something went wrong on our side. Your answers are still here: please try again, or email info@parseus.ai.';
    setBusy(form, false, text, true);
    if (window.turnstile) try { window.turnstile.reset(); } catch (e) {}
  }

  function handleError(form, kind) {
    var text = kind === 'timeout'
      ? 'This is taking longer than expected. Your answers are still here: please try again, or email info@parseus.ai.'
      : 'We couldn’t reach our server. Check your connection and try again; your answers are still here. You can also email info@parseus.ai.';
    setBusy(form, false, text, true);
  }

  function showSuccess(form, box, data) {
    var tpl = $('[data-form-success="' + (data.status || 'received') + '"]', box) || $('[data-form-success]', box);
    if (!tpl) return;
    var ref = $('[data-ref]', tpl);
    if (ref) ref.textContent = data.ref || '';
    form.hidden = true;
    tpl.hidden = false;
    var h = $('h2', tpl) || tpl;
    h.setAttribute('tabindex', '-1');
    h.focus();
  }

  $all('form[data-form]').forEach(init);
})();
