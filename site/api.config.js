/* Entitlement API — where the paid half of the library is served from.

   THIS VALUE IS PUBLIC. It is a URL, nothing more; every decision behind it is
   made server-side against a verified Supabase session (see api/main.py). There
   is no key here and there must never be one.

   Leave it empty and the app is exactly what it was before this file existed:
   every book that is actually present in data/ opens, no lock icons, no network
   call beyond the ones already there. That is the intended state for a fork, for
   local work, and for the site as it stands today — paid books simply are not in
   data/, so an unconfigured build shows the free library and nothing is broken.

   Setup (once, after deploying api/ to Railway):
     1. Railway → your service → Settings → Networking → Generate Domain.
     2. Paste it below, without a trailing slash.
     3. Railway → Variables → ALLOWED_ORIGINS must list the site's origin, or
        the browser blocks every call before it leaves the page:
          https://aqinaq.github.io,http://localhost:8777
     4. Check it: open <base>/health — it reports what is configured, and
        "supabase": true is the one that matters.

   Local work against a local API:
     window.API_BASE = 'http://localhost:8000'; */
window.API_BASE = 'https://agylshyn-production.up.railway.app';
