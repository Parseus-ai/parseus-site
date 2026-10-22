/* Parseus AI: shared navigation behaviour (desktop dropdowns + mobile drawer). */
(function () {
  var root = document.documentElement;
  var nav = document.getElementById('site-nav');
  var toggle = document.querySelector('.nav-toggle');
  var closeBtn = nav && nav.querySelector('.nav-close');
  var scrim = document.querySelector('.nav-scrim');
  if (!nav || !toggle) return;

  var mobileQuery = window.matchMedia('(max-width: 1280px)');
  var subButtons = Array.prototype.slice.call(nav.querySelectorAll('.navitem > button.navlabel'));
  var savedScrollY = 0;

  function isMobile() { return mobileQuery.matches; }
  function isOpen() { return root.classList.contains('nav-open'); }

  /* ---------- Submenus ---------- */
  function setSub(btn, open) {
    var item = btn.parentElement;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    item.classList.toggle('open', open);
    item.classList.toggle('closed', !open && !isMobile());
  }
  function closeAllSubs(except) {
    subButtons.forEach(function (b) { if (b !== except) setSub(b, false); });
  }

  subButtons.forEach(function (btn) {
    var item = btn.parentElement;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      if (!isMobile()) closeAllSubs(btn);
      setSub(btn, open);
    });
    // Desktop: hovering or focusing re-enables an item closed by Escape / outside click
    item.addEventListener('mouseenter', function () { item.classList.remove('closed'); });
    item.addEventListener('mouseleave', function () {
      if (!isMobile() && !item.contains(document.activeElement)) {
        btn.setAttribute('aria-expanded', 'false');
        item.classList.remove('open');
      }
    });
    item.addEventListener('focusin', function (e) {
      // Only reopen when focus arrives from outside this item
      if (!isMobile() && !item.contains(e.relatedTarget)) { item.classList.remove('closed'); }
    });
    item.addEventListener('focusout', function (e) {
      if (!isMobile() && !item.contains(e.relatedTarget)) {
        btn.setAttribute('aria-expanded', 'false');
        item.classList.remove('open', 'closed');
      }
    });
  });

  /* ---------- Mobile drawer ---------- */
  function background() {
    // Everything on the page except the header that holds the drawer
    var header = nav.closest('header');
    var holder = header;
    while (holder && holder.parentElement !== document.body) holder = holder.parentElement;
    return Array.prototype.slice.call(document.body.children).filter(function (el) {
      return el !== holder && el.tagName !== 'SCRIPT';
    }).concat(header ? Array.prototype.slice.call(header.children).filter(function (el) {
      return el !== nav && el !== scrim;
    }) : []);
  }

  function openMenu() {
    if (isOpen()) return;
    savedScrollY = window.scrollY || window.pageYOffset;
    root.classList.add('nav-open');
    // iOS Safari scroll lock
    document.body.style.position = 'fixed';
    document.body.style.top = -savedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    toggle.setAttribute('aria-expanded', 'true');
    nav.removeAttribute('aria-hidden');
    background().forEach(function (el) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); });
    // Expand the section containing the current page
    nav.querySelectorAll('.dropdown [aria-current="page"]').forEach(function (a) {
      var b = a.closest('.navitem').querySelector('button.navlabel');
      if (b) setSub(b, true);
    });
    requestAnimationFrame(function () { requestAnimationFrame(function () { (closeBtn || nav).focus(); }); });
  }

  function closeMenu(returnFocus) {
    if (!isOpen()) return;
    root.classList.remove('nav-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' });
    toggle.setAttribute('aria-expanded', 'false');
    if (isMobile()) nav.setAttribute('aria-hidden', 'true');
    background().forEach(function (el) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); });
    if (returnFocus !== false) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', function () { isOpen() ? closeMenu() : openMenu(); });
  if (closeBtn) closeBtn.addEventListener('click', function () { closeMenu(); });
  if (scrim) scrim.addEventListener('click', function () { closeMenu(); });

  // Close the drawer when a real link inside it is followed (same-page anchors, mailto)
  nav.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (a && isOpen()) closeMenu(false);
  });

  /* ---------- Keyboard ---------- */
  // Arrow keys: Down from a menu button enters its links; Up/Down move between them
  nav.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var item = e.target.closest('.navitem');
    if (!item) return;
    var btn = item.querySelector('button.navlabel');
    var links = Array.prototype.slice.call(item.querySelectorAll('.dropdown a[href]'));
    if (!btn || !links.length) return;
    var i = links.indexOf(document.activeElement);
    if (e.target === btn && e.key === 'ArrowDown') {
      e.preventDefault();
      setSub(btn, true);
      requestAnimationFrame(function () { links[0].focus(); });
    } else if (i !== -1) {
      e.preventDefault();
      if (e.key === 'ArrowDown') links[(i + 1) % links.length].focus();
      else if (i === 0) btn.focus();
      else links[i - 1].focus();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (isOpen()) { closeMenu(); return; }
      var expanded = subButtons.filter(function (b) {
        return b.getAttribute('aria-expanded') === 'true' || b.parentElement.contains(document.activeElement);
      });
      expanded.forEach(function (b) { setSub(b, false); });
      if (expanded.length && expanded[0].parentElement.contains(document.activeElement)) expanded[0].focus();
      return;
    }
    // Keep Tab inside the open drawer (handled manually so it behaves the
    // same in Safari, which skips links on Tab by default)
    if (e.key === 'Tab' && isOpen()) {
      var focusables = Array.prototype.filter.call(
        nav.querySelectorAll('a[href], button:not([disabled])'),
        function (el) { return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }
      );
      if (!focusables.length) return;
      e.preventDefault();
      var i = focusables.indexOf(document.activeElement);
      var next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i + 1) % focusables.length;
      focusables[next].focus();
    }
  });

  // Desktop: click outside closes any open dropdown
  document.addEventListener('click', function (e) {
    if (!isMobile() && !nav.contains(e.target)) closeAllSubs();
  });

  /* ---------- Breakpoint changes ---------- */
  function sync() {
    if (isMobile()) {
      if (!isOpen()) nav.setAttribute('aria-hidden', 'true');
      subButtons.forEach(function (b) { b.parentElement.classList.remove('closed'); });
    } else {
      if (isOpen()) closeMenu(false);
      nav.removeAttribute('aria-hidden');
      closeAllSubs();
      subButtons.forEach(function (b) { b.parentElement.classList.remove('closed'); });
    }
  }
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', sync);
  else if (mobileQuery.addListener) mobileQuery.addListener(sync);
  sync();

  // Restore a clean state when returning via the back/forward cache
  window.addEventListener('pageshow', function (e) { if (e.persisted) closeMenu(false); });
})();
