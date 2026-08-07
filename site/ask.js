/* The app's own confirm() and alert().

   Every irreversible step here — sign out everywhere, wipe a book, delete a
   class, hand in an exam — used to raise a native window.confirm(). Three
   things were wrong with that: on iOS and Android the box is system chrome
   titled with the bare origin ("127.0.0.1:8853 says…"), which reads like the
   page has broken out of itself; the buttons are the browser's, so they are in
   the browser's language and not the reader's; and it blocks the event loop,
   which in a page with a sync tick and a running exam clock is not free.

   The API is deliberately the shape of the thing it replaces, minus the
   blocking:

     ASK.confirm(text, opts)  -> Promise<boolean>
     ASK.tell(text, opts)     -> Promise<void>      (an alert with one button)

   `opts` may carry `title`, `yes`, `no`, and `danger: true` — which colours the
   confirming button as destructive rather than as the primary action, because
   "Delete the class" should not look like the safe way out.

   It lives in its own file, and before app.js and srs.js in index.html, because
   both of them ask questions. */
(function () {
  'use strict';

  var modal   = document.getElementById('askModal');
  var titleEl = document.getElementById('askTitle');
  var textEl  = document.getElementById('askText');
  var yesEl   = document.getElementById('askYes');
  var noEl    = document.getElementById('askNo');

  // No markup — a fork that trimmed index.html still gets working calls rather
  // than a crash on the first destructive click.
  var ready = !!(modal && titleEl && textEl && yesEl && noEl);

  // Same lookup srs.js uses: I18N is a plain {kk:{…}, en:{…}} and the language
  // is whatever app.js is currently painting in. Kazakh is the fallback, then
  // the caller's — this file loads before app.js, so APP_LANG can be missing on
  // the very first call.
  function t(key, fallback) {
    var lang = (window.APP_LANG && window.APP_LANG()) || 'kk';
    var I = window.I18N || {};
    var s = (I[lang] || {})[key];
    if (s == null) s = (I.kk || {})[key];
    return s == null ? fallback : s;
  }

  var open = null;          // { resolve, lastFocus, onKey } while a dialog is up

  function finish(answer) {
    if (!open) return;
    var o = open;
    open = null;
    modal.hidden = true;
    document.removeEventListener('keydown', o.onKey, true);
    // Back to whatever the reader was on. A dialog that drops focus on <body>
    // sends a keyboard user to the top of the page for every confirmation.
    if (o.lastFocus && document.contains(o.lastFocus)) {
      try { o.lastFocus.focus(); } catch (e) { /* gone from the DOM */ }
    }
    o.resolve(answer);
  }

  function show(text, opts, twoWay) {
    opts = opts || {};
    // Already asking something: answer the old one "no" first, so a stray
    // second call can never leave a promise hanging forever.
    if (open) finish(false);
    if (!ready) {
      // Degrade to the browser's, rather than silently doing the dangerous
      // thing. This branch should never run in the shipped app.
      return Promise.resolve(twoWay ? window.confirm(text) : (window.alert(text), undefined));
    }

    titleEl.textContent = opts.title || t('ask.title', 'Confirm');
    textEl.textContent = text;
    yesEl.textContent = opts.yes || (twoWay ? t('ask.yes', 'Yes') : t('ask.ok', 'OK'));
    yesEl.className = 'btn ' + (opts.danger ? 'bad' : 'primary');
    noEl.textContent = opts.no || t('ask.no', 'Cancel');
    noEl.hidden = !twoWay;

    modal.hidden = false;

    return new Promise(function (resolve) {
      open = {
        resolve: resolve,
        lastFocus: document.activeElement,
        onKey: function (e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
          if (e.key !== 'Tab') return;
          // Focus trap. Two buttons and a close cross, so the cycle is short
          // enough to list rather than to query for.
          var stops = [noEl, yesEl, modal.querySelector('.modal-close')]
            .filter(function (n) { return n && !n.hidden; });
          if (!stops.length) return;
          var i = stops.indexOf(document.activeElement);
          var next = e.shiftKey ? i - 1 : i + 1;
          if (next < 0) next = stops.length - 1;
          if (next >= stops.length) next = 0;
          e.preventDefault();
          stops[next].focus();
        }
      };
      // Capture, so Esc closes this and not the dialog underneath it — the
      // account panel opens confirmations of its own.
      document.addEventListener('keydown', open.onKey, true);
      // The cancelling button when there is one: a reader who hits Enter by
      // reflex should not delete anything. On a one-button alert the only
      // button is the one to land on.
      (twoWay ? noEl : yesEl).focus();
    });
  }

  if (ready) {
    yesEl.addEventListener('click', function () { finish(true); });
    noEl.addEventListener('click', function () { finish(false); });
    // Backdrop and ✕ both mean "no" — same as dismissing a native confirm.
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute('data-close-ask')) finish(false);
    });
  }

  window.ASK = {
    confirm: function (text, opts) { return show(text, opts, true); },
    tell: function (text, opts) { return show(text, opts, false).then(function () {}); },
    // For tests and for anything that needs to know whether one is up.
    isOpen: function () { return !!open; }
  };
})();
