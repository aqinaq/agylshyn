/* An in-page PDF reader, for the phones that have none.

   A phone browser cannot embed a PDF. iOS Safari paints the first page as a
   flat picture — no scrolling, no page two, and it ignores `#page=14`, so the
   reader was shown page one of a 400-page book whatever unit they were on;
   Android Chrome offers a download instead. Both make the IELTS books, whose
   questions exist only on the page, impossible to work through on a phone.

   So where the browser has no viewer we draw the book ourselves: pdf.js in a
   worker, one <canvas> per page, rendered as it scrolls into view. Where the
   browser does have a viewer (every desktop) app.js keeps the <iframe> — it is
   faster, it is what the reader already knows, and it costs nothing to load.

   The library is ~1.8 MB, so nothing here is fetched until a reader actually
   opens a book; after that the service worker keeps it.

   Public surface, all of it used from app.js:
     PDFVIEW.supported()            can this browser run it at all
     PDFVIEW.open(box, url, page)   → Promise, resolves once page N is drawn
     PDFVIEW.goto(page)             jump within the open document
     PDFVIEW.close()                tear down, free the worker
*/
(function () {
  'use strict';

  /* Absolute, and resolved against the document rather than left relative.
     The import below runs inside a Function body, which has no base URL of its
     own, so a relative specifier there is read as a bare module name ("resolve
     the package `vendor/pdfjs/pdf.min.js`") and fails. Going through
     document.baseURI also keeps this correct under the /agylshyn/ prefix the
     site is deployed at. */
  function asset(name) {
    try { return new URL('vendor/pdfjs/' + name, document.baseURI).href; }
    catch (e) { return 'vendor/pdfjs/' + name; }
  }
  var lib = null;          // the pdf.js module, once imported
  var libPromise = null;

  /* Dynamic import written through Function so that a browser too old to parse
     `import()` fails here, at call time, instead of throwing a SyntaxError
     that would take this whole file — and with it the rest of the app — down
     on load. */
  var dynImport = null;
  try {
    dynImport = new Function('u', 'return import(u);');
  } catch (e) {
    dynImport = null;
  }

  function loadLib() {
    if (libPromise) return libPromise;
    if (!dynImport) return Promise.reject(new Error('no dynamic import'));
    libPromise = dynImport(asset('pdf.min.js')).then(function (m) {
      // The worker is what makes this usable: parsing and rasterising a page
      // of a 44 MB book on the main thread would freeze the answer boxes.
      m.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.js');
      lib = m;
      return m;
    });
    return libPromise;
  }

  // ---- state of the one document that can be open at a time ----
  var doc = null;          // PDFDocumentProxy
  var docUrl = null;
  var box = null;          // the scroller we were handed
  var pages = [];          // one entry per page: { el, canvas, task, done }
  var ratio = 1.414;       // page height / width; page 1 sets the real value
  var zoom = 1;            // multiplier on top of fit-to-width
  var io = null;           // IntersectionObserver driving the lazy render
  var generation = 0;      // bumped by close(), so late callbacks stand down

  // A phone cannot hold 400 rasterised pages. Anything outside this many
  // pages of the viewport gives its canvas back.
  var KEEP = 4;

  function supported() {
    return !!dynImport && typeof Promise !== 'undefined' &&
           typeof IntersectionObserver !== 'undefined';
  }

  function pageWidth() {
    var w = box ? box.clientWidth : 0;
    return Math.max(120, w - 8) * zoom;   // 8px so a shadow is not clipped
  }

  /* Placeholders first, canvases later. Asking pdf.js for all 400 page objects
     up front would stall on the network; every book here prints one page size
     throughout, so page 1's shape stands in for the rest and each page fixes
     its own height when it is really drawn. */
  function buildPlaceholders() {
    var w = pageWidth();
    pages = [];
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= doc.numPages; i++) {
      var d = document.createElement('div');
      d.className = 'pv-page';
      // Both, always. Width is what zoom actually changes — leave the page to
      // fill the column and "+" only buys a sharper raster of the same size.
      d.style.width = Math.round(w) + 'px';
      d.style.height = Math.round(w * ratio) + 'px';
      d.setAttribute('data-page', String(i));
      frag.appendChild(d);
      pages.push({ el: d, canvas: null, task: null, done: false });
    }
    box.appendChild(frag);
  }

  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var n = Number(en.target.getAttribute('data-page'));
        if (en.isIntersecting) render(n);
      });
      prune();
    }, { root: box, rootMargin: '200% 0px' });
    pages.forEach(function (p) { io.observe(p.el); });
  }

  // Free canvases far from the viewport; their placeholders keep the height
  // they were rendered at, so nothing jumps when they go.
  function prune() {
    var first = visiblePage();
    pages.forEach(function (p, i) {
      var n = i + 1;
      if (p.canvas && Math.abs(n - first) > KEEP) {
        if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } }
        p.task = null;
        p.canvas.remove();
        p.canvas = null;
        p.done = false;
      }
    });
  }

  function render(n) {
    var p = pages[n - 1];
    if (!p || p.canvas || !doc) return;
    var gen = generation;
    var w = pageWidth();
    var canvas = document.createElement('canvas');
    canvas.className = 'pv-canvas';
    p.canvas = canvas;
    p.el.appendChild(canvas);

    doc.getPage(n).then(function (page) {
      if (gen !== generation || p.canvas !== canvas) return;
      var base = page.getViewport({ scale: 1 });
      if (n === 1) ratio = base.height / base.width;
      var scale = w / base.width;
      var vp = page.getViewport({ scale: scale });

      // Draw at the device's real pixel density, then let CSS scale it back
      // down, or the text is a blur on any phone. Capped: at dpr 3 a full page
      // is ~24 MB of canvas and iOS starts dropping them.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = '100%';
      p.el.style.width = Math.round(vp.width) + 'px';
      p.el.style.height = Math.round(vp.height) + 'px';

      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.scale(dpr, dpr);
      p.task = page.render({ canvasContext: ctx, viewport: vp });
      return p.task.promise.then(function () {
        if (gen === generation) p.done = true;
      });
    }).catch(function () {
      // A cancelled render is the normal way we stop work; anything else and
      // the page simply stays blank rather than taking the reader down with it.
      if (gen === generation && p.canvas === canvas) {
        canvas.remove();
        p.canvas = null;
      }
    });
  }

  function visiblePage() {
    if (!box || !pages.length) return 1;
    var top = box.scrollTop + box.clientHeight / 2;
    var acc = 0;
    for (var i = 0; i < pages.length; i++) {
      acc += pages[i].el.offsetHeight;
      if (acc >= top) return i + 1;
    }
    return pages.length;
  }

  function goto(page) {
    var n = Math.max(1, Math.min(pages.length || 1, Number(page) || 1));
    var p = pages[n - 1];
    if (!p) return;
    render(n);
    box.scrollTop = p.el.offsetTop;
    if (onPage) onPage(n, doc ? doc.numPages : 0);
  }

  var onPage = null;

  function open(container, url, page, opts) {
    box = container;
    var want = String(url).split('#')[0];
    onPage = (opts && opts.onPage) || null;

    // Same book, different unit: just move.
    if (doc && docUrl === want) {
      goto(page);
      return Promise.resolve(doc.numPages);
    }
    close();
    var gen = ++generation;

    return loadLib().then(function (m) {
      if (gen !== generation) return 0;
      var task = m.getDocument({
        url: want,
        // These books are 2–44 MB. Fetch the bytes a page needs, not the file:
        // GitHub Pages answers Range requests, and the service worker is told
        // to leave ranged PDF requests alone so they reach it.
        //
        // Both switches are needed and they do different things. Without
        // `disableStream` pdf.js keeps a full-file download running alongside
        // the range requests, so the phone pays for the book twice over;
        // without `disableAutoFetch` it range-fetches the rest of the file in
        // the background once it can. Measured on the 44 MB IELTS 21: 74 MB
        // pulled with only autoFetch off, 3 MB with both.
        disableAutoFetch: true,
        disableStream: true,
        rangeChunkSize: 262144
      });
      return task.promise.then(function (d) {
        if (gen !== generation) { d.destroy(); return 0; }
        doc = d;
        docUrl = want;
        return d.getPage(1).then(function (p1) {
          var v = p1.getViewport({ scale: 1 });
          ratio = v.height / v.width;
          buildPlaceholders();
          observe();
          goto(page);
          return d.numPages;
        });
      });
    });
  }

  function setZoom(mult) {
    if (!doc) return;
    var at = visiblePage();
    zoom = Math.max(.6, Math.min(3, mult));
    // Drop everything and lay it out again at the new width.
    pages.forEach(function (p) {
      if (p.task) { try { p.task.cancel(); } catch (e) { /* done */ } }
      p.task = null;
      if (p.canvas) { p.canvas.remove(); p.canvas = null; }
      p.done = false;
      p.el.style.width = Math.round(pageWidth()) + 'px';
      p.el.style.height = Math.round(pageWidth() * ratio) + 'px';
    });
    goto(at);
  }

  function zoomLevel() { return zoom; }

  function close() {
    generation++;
    if (io) { io.disconnect(); io = null; }
    pages.forEach(function (p) {
      if (p.task) { try { p.task.cancel(); } catch (e) { /* done */ } }
    });
    pages = [];
    if (box) box.textContent = '';
    if (doc) { try { doc.destroy(); } catch (e) { /* already gone */ } }
    doc = null;
    docUrl = null;
    zoom = 1;
    onPage = null;
  }

  // The fit-to-width scale depends on the container, which the reader can drag
  // wider or turn sideways.
  function relayout() {
    if (!doc) return;
    setZoom(zoom);
  }

  window.PDFVIEW = {
    supported: supported,
    open: open,
    goto: goto,
    close: close,
    setZoom: setZoom,
    zoomLevel: zoomLevel,
    relayout: relayout,
    page: visiblePage,
    count: function () { return doc ? doc.numPages : 0; }
  };
})();
