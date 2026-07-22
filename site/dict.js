/* Word lookup — point at an English word inside an exercise and get a Kazakh
   translation plus a plain-English gloss ("kitten — марғау, kid of a cat").

   Four ways in, because reading habits differ: hover and rest on a word,
   double-click it, select it with the mouse, or long-press it on a phone.

   Two sources, in this order:
     1. data/dict.json — the hand-written core, bundled with the site. Instant,
        works offline, covers the words that actually recur in these books.
     2. free online providers — everything else, once, then cached in
        localStorage so the second look is as fast as the first source.

   Exposed as window.WordLookup; app.js calls .attach() on rendered pages. */
(function () {
  'use strict';

  var DICT_URL = 'data/dict.json';
  var CACHE_KEY = 'agylshyn_wl_cache_v1';
  var PREF_KEY = 'agylshyn_wl_pref_v1';
  var CACHE_MAX = 4000;        // ~400 KB of localStorage at worst
  var HOVER_DELAY = 380;       // rest this long before a hover counts
  var PRESS_DELAY = 480;       // touch long-press
  var MAX_PHRASE_WORDS = 6;    // a longer selection is prose, not a lookup

  /* ================= preferences ================= */

  var pref = { hover: true };
  try {
    var savedPref = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    if (typeof savedPref.hover === 'boolean') pref.hover = savedPref.hover;
  } catch (e) { /* no storage — defaults are fine */ }

  function savePref() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) {}
  }

  /* ================= local dictionary ================= */

  var DICT = null;             // word -> [kk, en, pos?]
  var dictPending = null;

  function loadDict() {
    if (DICT) return Promise.resolve(DICT);
    if (dictPending) return dictPending;
    dictPending = fetch(DICT_URL)
      .then(function (r) { return r.ok ? r.json() : { words: {} }; })
      .then(function (j) { DICT = (j && j.words) || {}; return DICT; })
      .catch(function () { DICT = {}; return DICT; });
    return dictPending;
  }

  /* ================= online cache ================= */

  var cache = {};              // word -> {kk, en, pos, ph, audio}
  var cacheOrder = [];
  try {
    var savedCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    if (savedCache && savedCache.w) {
      cache = savedCache.w;
      cacheOrder = savedCache.o || Object.keys(cache);
    }
  } catch (e) { /* start with an empty cache */ }

  var cacheTimer = null;
  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      // Oldest lookups go first: the words being studied now are the ones
      // worth keeping instant.
      while (cacheOrder.length > CACHE_MAX) delete cache[cacheOrder.shift()];
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ w: cache, o: cacheOrder }));
      } catch (e) { /* quota — the in-memory cache still helps this session */ }
    }, 400);
  }

  function remember(word, entry) {
    if (!cache[word]) cacheOrder.push(word);
    cache[word] = entry;
    saveCache();
  }

  /* ================= morphology ================= */

  // Enough English inflection to land on a dictionary form. Everything here is
  // a *guess list*; the caller keeps the first candidate that exists locally.
  function baseForms(w) {
    var out = [];
    function add(x) { if (x && x.length > 1 && out.indexOf(x) < 0) out.push(x); }

    // What is left after cutting a suffix can need a letter back (mak → make)
    // or one letter fewer (stopp → stop, bigg → big).
    function stem(s) {
      add(s);
      add(s + 'e');
      var end = s.charAt(s.length - 1);
      if (s.length > 2 && end === s.charAt(s.length - 2) &&
          'bdgklmnprtz'.indexOf(end) > -1) add(s.slice(0, -1));
    }

    if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ed$/.test(w)) stem(w.slice(0, -2));
    if (/ing$/.test(w)) stem(w.slice(0, -3));
    if (/iest$/.test(w)) add(w.slice(0, -4) + 'y');
    if (/est$/.test(w)) stem(w.slice(0, -3));
    if (/ier$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/er$/.test(w)) stem(w.slice(0, -2));
    if (/ily$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ly$/.test(w)) add(w.slice(0, -2));
    return out;
  }

  // Contractions carry their own meaning ("I'm" is not "I"), so they are looked
  // up whole first; this only splits what the core dictionary does not hold.
  function stripClitic(w) {
    var m = /^(.+?)('s|'re|'ve|'ll|'d|n't)$/.exec(w);
    return m ? m[1] : null;
  }

  function normalize(raw) {
    return String(raw)
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/^[^a-z']+|[^a-z']+$/g, '')
      .replace(/^'+|'+$/g, '');
  }

  /* ================= lookup ================= */

  // cb is called up to twice: once with whatever is known immediately, then
  // again when the network answers. Callers re-render both times.
  function lookup(raw, cb) {
    var word = normalize(raw);
    if (!word) { cb(null); return; }

    loadDict().then(function (dict) {
      var hit = dict[word];
      if (hit) { cb(entryFrom(word, hit, null, 'local')); return; }

      var i, forms = baseForms(word);
      for (i = 0; i < forms.length; i++) {
        if (dict[forms[i]]) { cb(entryFrom(word, dict[forms[i]], forms[i], 'local')); return; }
      }
      var stem = stripClitic(word);
      if (stem) {
        if (dict[stem]) { cb(entryFrom(word, dict[stem], stem, 'local')); return; }
        var sf = baseForms(stem);
        for (i = 0; i < sf.length; i++) {
          if (dict[sf[i]]) { cb(entryFrom(word, dict[sf[i]], sf[i], 'local')); return; }
        }
      }

      if (cache[word]) { cb(cache[word]); return; }

      cb({ word: word, loading: true });
      fetchOnline(word, function (entry) {
        if (entry) remember(word, entry);
        cb(entry || { word: word, missing: true });
      });
    });
  }

  function entryFrom(word, row, base, src) {
    return {
      word: word,
      base: base && base !== word ? base : null,
      kk: row[0],
      en: row[1] || '',
      pos: row[2] || '',
      src: src
    };
  }

  /* ================= online providers ================= */

  function jsonGet(url) {
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  // Two independent calls: the Kazakh side and the English side. Whichever
  // fails just leaves its half of the card empty.
  function fetchOnline(word, done) {
    var q = encodeURIComponent(word);
    var entry = { word: word, kk: '', en: '', pos: '', ph: '', audio: '', src: 'online' };
    var left = 2;

    function finish() {
      if (--left) return;
      done(entry.kk || entry.en ? entry : null);
    }

    translate(q)
      .then(function (kk) { entry.kk = kk || ''; })
      .catch(function () {})
      .then(finish);

    jsonGet('https://api.dictionaryapi.dev/api/v2/entries/en/' + q)
      .then(function (j) {
        var e0 = j && j[0];
        if (!e0) return;
        var m = (e0.meanings || [])[0];
        if (m) {
          entry.pos = m.partOfSpeech || '';
          entry.en = simplest(m.definitions || []);
        }
        entry.ph = e0.phonetic || '';
        (e0.phonetics || []).forEach(function (p) {
          if (!entry.audio && p.audio) entry.audio = p.audio;
          if (!entry.ph && p.text) entry.ph = p.text;
        });
      })
      .catch(function () {})
      .then(finish);
  }

  // The online definitions are written for dictionaries, not for learners
  // ("A small mammal, of the family Erinaceidae…"). Drop the Latin asides and
  // keep the shortest sense — the shortest is nearly always the plainest.
  function simplest(defs) {
    var best = '';
    defs.slice(0, 4).forEach(function (d) {
      var s = (d && d.definition || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
      if (!s) return;
      if (!best || s.length < best.length) best = s;
    });
    if (best.length > 130) {
      var cut = best.slice(0, 130);
      var sp = cut.lastIndexOf(' ');
      best = (sp > 60 ? cut.slice(0, sp) : cut) + '…';
    }
    return best;
  }

  function translate(q) {
    return jsonGet('https://translate.googleapis.com/translate_a/single' +
                   '?client=gtx&sl=en&tl=kk&dt=t&q=' + q)
      .then(function (j) {
        var out = '';
        (j && j[0] || []).forEach(function (seg) { if (seg && seg[0]) out += seg[0]; });
        if (!out) throw new Error('empty');
        return out;
      })
      .catch(function () {
        return jsonGet('https://api.mymemory.translated.net/get?langpair=en|kk&q=' + q)
          .then(function (j) {
            return (j && j.responseData && j.responseData.translatedText) || '';
          });
      });
  }

  /* ================= popup ================= */

  var pop = null, popWord = null, popFromHover = false;

  function T(key, fallback) {
    var I = window.I18N;
    var lang = (window.APP_LANG && window.APP_LANG()) || 'kk';
    var d = (I && (I[lang] || I.kk)) || {};
    return d[key] || fallback;
  }

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'wl-pop';
    pop.hidden = true;
    pop.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    document.body.appendChild(pop);
    return pop;
  }

  function hide() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    popWord = null;
  }

  function render(entry, word) {
    var p = ensurePop();
    p.textContent = '';

    var head = document.createElement('div');
    head.className = 'wl-head';
    var w = document.createElement('b');
    w.className = 'wl-word';
    w.textContent = entry && entry.base ? word + ' → ' + entry.base : word;
    head.appendChild(w);
    if (entry && entry.pos) {
      var pos = document.createElement('span');
      pos.className = 'wl-pos';
      pos.textContent = entry.pos;
      head.appendChild(pos);
    }
    if (entry && entry.ph) {
      var ph = document.createElement('span');
      ph.className = 'wl-ph';
      ph.textContent = entry.ph;
      head.appendChild(ph);
    }
    if (entry && entry.audio) {
      var au = document.createElement('button');
      au.type = 'button';
      au.className = 'wl-audio';
      au.textContent = '🔊';
      au.title = T('wl.listen', 'Тыңдау');
      au.addEventListener('click', function () { new Audio(entry.audio).play(); });
      head.appendChild(au);
    }
    p.appendChild(head);

    if (!entry || entry.loading) {
      p.appendChild(line('wl-loading', T('wl.loading', 'Ізделуде…')));
    } else if (entry.missing) {
      p.appendChild(line('wl-loading', T('wl.missing', 'Табылмады. Интернет бар ма?')));
    } else {
      if (entry.kk) p.appendChild(line('wl-kk', entry.kk));
      if (entry.en) p.appendChild(line('wl-en', entry.en));
      if (entry.src === 'online') {
        p.appendChild(line('wl-src', T('wl.online', 'интернеттен · машина аудармасы')));
      }
    }

    var foot = document.createElement('div');
    foot.className = 'wl-foot';
    var hv = document.createElement('button');
    hv.type = 'button';
    hv.className = 'wl-toggle' + (pref.hover ? ' on' : '');
    hv.textContent = T('wl.hover', 'Меңзегенде шықсын');
    hv.addEventListener('click', function () {
      pref.hover = !pref.hover;
      savePref();
      hv.classList.toggle('on', pref.hover);
    });
    foot.appendChild(hv);
    p.appendChild(foot);
    return p;
  }

  function line(cls, text) {
    var d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  function place(p, rect) {
    p.hidden = false;
    p.style.left = '0px';
    p.style.top = '0px';
    var box = p.getBoundingClientRect();
    var pad = 8;
    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - box.width - pad));
    var top = rect.bottom + 8;
    var flip = top + box.height > window.innerHeight - pad;
    if (flip) top = rect.top - box.height - 8;
    if (top < pad) top = pad;
    p.classList.toggle('above', flip);
    p.style.left = Math.round(left) + 'px';
    p.style.top = Math.round(top) + 'px';
  }

  function open(raw, rect, fromHover) {
    var word = String(raw).trim();
    if (!word) return;
    if (popWord === word && pop && !pop.hidden) { place(pop, rect); return; }
    popWord = word;
    popFromHover = !!fromHover;

    var mine = word;
    lookup(word, function (entry) {
      if (popWord !== mine) return;           // a newer lookup won the race
      place(render(entry, word), rect);
    });
  }

  /* ================= hit testing ================= */

  var WORD_CHAR = /[A-Za-z'’-]/;

  function caretAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      var r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
    return null;
  }

  // Returns {word, rect} for the word under the point, or null. `strict` also
  // requires the point to sit on the word's own box — hovering blank space to
  // the right of a line must not silently pick the last word on it.
  function wordAt(x, y, strict) {
    var caret = caretAt(x, y);
    if (!caret) return null;
    var node = caret.startContainer;
    if (!node || node.nodeType !== 3) return null;
    if (!inScope(node.parentNode)) return null;

    var text = node.nodeValue || '';
    var i = Math.min(caret.startOffset, text.length - 1);
    if (i < 0) return null;
    if (!WORD_CHAR.test(text.charAt(i))) {
      if (i > 0 && WORD_CHAR.test(text.charAt(i - 1))) i--;
      else return null;
    }
    var s = i, e = i;
    while (s > 0 && WORD_CHAR.test(text.charAt(s - 1))) s--;
    while (e < text.length - 1 && WORD_CHAR.test(text.charAt(e + 1))) e++;

    var r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, e + 1);
    var rect = r.getBoundingClientRect();
    if (strict && (x < rect.left - 2 || x > rect.right + 2 ||
                   y < rect.top - 2 || y > rect.bottom + 2)) return null;

    var word = text.slice(s, e + 1);
    return /[A-Za-z]/.test(word) ? { word: word, rect: rect } : null;
  }

  /* Only exercise prose is lookupable. Form controls own their own gestures,
     and the Kazakh chrome (tags, buttons, badges) has nothing to translate. */
  var SKIP = 'input,textarea,button,select,.wl-pop,.tag,.type-tag,.status,.badge,.chip,.sub-num,.n,.wb-label';

  function inScope(node) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    if (!el || !el.closest) return false;
    if (el.closest(SKIP)) return false;
    return !!el.closest('[data-lookup]');
  }

  /* ================= triggers ================= */

  var hoverTimer = null;
  var lastPoint = { x: 0, y: 0 };

  document.addEventListener('mousemove', function (e) {
    lastPoint.x = e.clientX;
    lastPoint.y = e.clientY;
    if (!pref.hover) return;
    // Reaching for the popup must not kill it: cancel the pending check first,
    // or it fires over the popup, finds no word there, and hides it.
    if (pop && !pop.hidden && pop.contains(e.target)) { clearTimeout(hoverTimer); return; }

    clearTimeout(hoverTimer);
    if (!inScope(e.target)) {
      if (popFromHover) hide();
      return;
    }
    hoverTimer = setTimeout(function () {
      if (window.getSelection && String(window.getSelection()).trim()) return;
      var hit = wordAt(lastPoint.x, lastPoint.y, true);
      if (hit) open(hit.word, hit.rect, true);
      else if (popFromHover) hide();
    }, HOVER_DELAY);
  }, true);

  document.addEventListener('dblclick', function (e) {
    if (!inScope(e.target)) return;
    var hit = wordAt(e.clientX, e.clientY, false);
    if (hit) open(hit.word, hit.rect, false);
  });

  // Selecting is the deliberate gesture, so it also covers phrases.
  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var text = String(sel).trim().replace(/\s+/g, ' ');
      if (!text || !/[A-Za-z]/.test(text)) return;
      if (text.split(' ').length > MAX_PHRASE_WORDS) return;
      var range = sel.getRangeAt(0);
      if (!inScope(range.commonAncestorContainer)) return;
      var rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      open(text, rect, false);
    }, 180);
  });

  // Touch: press and hold. Moving a finger means scrolling, not reading.
  var pressTimer = null, pressAt = null;

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || !inScope(e.target)) return;
    var tt = e.touches[0];
    pressAt = { x: tt.clientX, y: tt.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      var hit = wordAt(pressAt.x, pressAt.y, false);
      if (hit) open(hit.word, hit.rect, false);
    }, PRESS_DELAY);
  }, { passive: true });

  function cancelPress(e) {
    if (e && e.touches && e.touches.length === 1 && pressAt) {
      var tt = e.touches[0];
      if (Math.abs(tt.clientX - pressAt.x) < 10 && Math.abs(tt.clientY - pressAt.y) < 10) return;
    }
    clearTimeout(pressTimer);
  }
  document.addEventListener('touchmove', cancelPress, { passive: true });
  document.addEventListener('touchend', cancelPress, { passive: true });

  /* ================= dismissal ================= */

  document.addEventListener('mousedown', function (e) {
    if (pop && !pop.hidden && !pop.contains(e.target)) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('resize', hide);
  // Any scrolling container, not just the window: the popup is positioned
  // against the viewport and would otherwise float away from its word.
  document.addEventListener('scroll', hide, true);

  /* ================= api ================= */

  window.WordLookup = {
    // Marks a rendered subtree as lookupable.
    attach: function (root) {
      if (root && root.setAttribute) root.setAttribute('data-lookup', '');
    },
    hide: hide,
    lookup: lookup,
    setHover: function (on) { pref.hover = !!on; savePref(); },
    hoverOn: function () { return pref.hover; }
  };
})();
