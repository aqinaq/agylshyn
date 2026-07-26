"""agylshyn entitlement API.

The static site stays static — free books, the shell, the dictionary, all of it
served from Pages exactly as before. This service exists for the one thing a
static host cannot do: decide, per reader, whether to hand something over.

    GET  /health                     what is configured (no secrets)
    GET  /v1/me                      the caller's live purchases
    GET  /v1/content/{book_id}       a paid book's JSON, if they hold the sku
    GET  /v1/file/{book_id}/{kind}   a signed R2 url for the pdf/audio
    POST /v1/admin/grant             give someone a sku (ADMIN_TOKEN)
    POST /v1/admin/revoke            take it back  (ADMIN_TOKEN)
    POST /v1/webhook/payment         a provider says money arrived (WEBHOOK_SECRET)

Two rules run through all of it:

1. tiers.json is read here, on the server. The copy stamped into the client's
   index.json is a hint for drawing lock icons; it is never trusted as input.
2. A free book is never served from this service. If tiers.json says free, the
   answer is a redirect to the public file — so a misconfiguration cannot
   quietly put free content behind a paywall.
"""
import json
import os
import secrets
import sys
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

import auth
import config
import storage

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'site', 'tools'))
import tiers as tiers_mod                                   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(HERE, 'content')

# tiers.json is read once. It ships with the deploy and cannot change under a
# running process, so re-reading it per request would only buy the chance of
# serving two different answers during a rollout.
TIERS = tiers_mod.load()

_books: dict = {}          # book_id -> raw json bytes, filled on first request


@asynccontextmanager
async def lifespan(_: FastAPI):
    for line in config.problems():
        print('config: ' + line, file=sys.stderr)
    print('config: ' + json.dumps(config.describe()), file=sys.stderr)
    print('tiers: %d paid books' % len(TIERS['books']), file=sys.stderr)
    yield
    await auth.aclose()


app = FastAPI(title='agylshyn', docs_url=None, redoc_url=None, lifespan=lifespan)

# Credentials are not used — the access token rides in an Authorization header,
# not a cookie — so origins could be '*'. They are listed anyway: it keeps a
# stranger's page from quietly spending this service's rate budget.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS or ['http://localhost:8777'],
    allow_methods=['GET', 'POST'],
    allow_headers=['Authorization', 'Content-Type'],
    max_age=3600,
)


# ---------------------------------------------------------------- helpers ---

def bearer(header: Optional[str]) -> str:
    if not header or not header.lower().startswith('bearer '):
        raise HTTPException(401, 'sign in first')
    return header[7:].strip()


async def caller(header: Optional[str]) -> str:
    """The verified user id, or the right HTTP error."""
    try:
        uid = await auth.user_id_for(bearer(header))
    except auth.Upstream as e:
        # 503, not 401: the reader did nothing wrong and should retry, and the
        # client must not react by signing them out.
        raise HTTPException(503, 'cannot reach %s right now' % e.what)
    if not uid:
        raise HTTPException(401, 'session expired')
    return uid


def allows(skus: dict, needed: str) -> bool:
    return needed in skus or tiers_mod.WILDCARD in skus


def safe_book_id(book_id: str) -> str:
    """Book ids reach the filesystem, so they are checked against the catalogue
    rather than sanitised. An id that is not in tiers.json or on disk never
    becomes a path — which rules out traversal by construction, not by regex."""
    if not book_id or '/' in book_id or '\\' in book_id or book_id.startswith('.'):
        raise HTTPException(404, 'no such book')
    return book_id


def book_bytes(book_id: str) -> bytes:
    """The private copy of a paid book, held in memory after the first read.

    All thirteen books together are under 4 MB, so caching them is cheaper than
    the syscalls and keeps a cold Railway container from doing disk work on the
    request that a reader is watching.
    """
    if book_id in _books:
        return _books[book_id]
    path = os.path.join(CONTENT, book_id + '.json')
    if not os.path.isfile(path):
        # Paid according to tiers.json but not deployed: a split_content.py step
        # was skipped. Loud, because the reader has paid and cannot read.
        print('missing content: %s' % path, file=sys.stderr)
        raise HTTPException(503, 'that book is not available yet')
    with open(path, 'rb') as f:
        _books[book_id] = f.read()
    return _books[book_id]


def require_supabase():
    """Fail cleanly rather than in httpx.

    Without SUPABASE_URL every outbound call is made against a URL with no
    scheme, which raises deep inside the client and surfaces as a 500 with a
    stack trace. The reader-facing routes never get that far — they check a
    token first, and an unconfigured service cannot verify one — but the admin
    routes are reached by the token alone, so the check belongs here too.
    """
    if not config.SUPABASE_READY:
        raise HTTPException(503, 'Supabase is not configured on this service')


def admin(header: Optional[str]):
    if not config.ADMIN_TOKEN:
        raise HTTPException(404, 'not enabled')
    # compare_digest, not ==: a plain comparison returns as soon as two bytes
    # differ, which leaks the prefix to anyone willing to time the responses.
    if not header or not secrets.compare_digest(header, config.ADMIN_TOKEN):
        raise HTTPException(401, 'bad admin token')


async def service_post(path: str, body, params=None, prefer: str = ''):
    headers = {'apikey': config.SUPABASE_SERVICE_KEY,
               'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY,
               'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    res = await auth.client().post(config.SUPABASE_URL + path,
                                   json=body, params=params, headers=headers)
    if res.status_code >= 300:
        print('supabase %s -> %s %s' % (path, res.status_code, res.text), file=sys.stderr)
        raise HTTPException(502, 'could not write the entitlement')
    return res


# ----------------------------------------------------------------- routes ---

@app.get('/health')
def health():
    """Deliberately says what is configured, never what it is configured with.
    Enough to tell a broken deploy from a broken client, useless to a stranger."""
    return {'ok': config.SUPABASE_READY, 'config': config.describe(),
            'paid_books': len(TIERS['books'])}


@app.get('/v1/me')
async def me(authorization: Optional[str] = Header(None)):
    """What this reader has bought — the client draws the library from it."""
    uid = await caller(authorization)
    try:
        skus = await auth.skus_for(uid)
    except auth.Upstream as e:
        raise HTTPException(503, 'cannot reach %s right now' % e.what)
    return {
        'skus': skus,
        'books': sorted(b for b, sku in TIERS['books'].items() if allows(skus, sku)),
        'features': sorted(f for f, sku in TIERS['features'].items() if allows(skus, sku)),
    }


@app.get('/v1/content/{book_id}')
async def content(book_id: str, authorization: Optional[str] = Header(None)):
    book_id = safe_book_id(book_id)
    sku = tiers_mod.sku_of(book_id, TIERS)

    # A free book is not this service's business. Saying so with a 404 rather
    # than serving it keeps exactly one copy of every free book in the world —
    # the public one the service worker already caches for offline use.
    if sku == tiers_mod.FREE:
        raise HTTPException(404, 'free book — read it from data/%s.json' % book_id)

    uid = await caller(authorization)
    try:
        skus = await auth.skus_for(uid)
    except auth.Upstream as e:
        raise HTTPException(503, 'cannot reach %s right now' % e.what)

    if not allows(skus, sku):
        # 402 Payment Required is the honest code and the client keys its
        # "unlock this book" screen off it — distinct from 401 (sign in) and
        # 403 (signed in, and no amount of paying will help).
        raise HTTPException(402, sku)

    return Response(
        content=book_bytes(book_id),
        media_type='application/json',
        # no-store, not private: the service worker must not keep a paid book on
        # a device whose subscription can lapse. Offline for paid content needs
        # a leased-key design, and pretending otherwise with a cache header
        # would mean cancelling a subscription changes nothing.
        headers={'Cache-Control': 'no-store'},
    )


@app.get('/v1/file/{book_id}/{kind}')
async def file_url(book_id: str, kind: str, name: str = '',
                   authorization: Optional[str] = Header(None)):
    """A signed R2 url for one of a paid book's audio tracks.

    Not for PDFs. The textbook is public for every book, paid or not — somebody
    weighing up a purchase gets to read the book first, and the exercises are
    what they are paying for. Refusing here rather than quietly signing a url
    keeps that decision in one place: if the PDF ever does become gated, this
    404 is what will fail loudly and point at everything that has to change.
    """
    book_id = safe_book_id(book_id)
    if kind == 'pdf':
        raise HTTPException(404, 'the textbook is public — use pdf/%s.pdf' % book_id)
    if kind != 'audio':
        raise HTTPException(404, 'unknown file kind')

    sku = tiers_mod.sku_of(book_id, TIERS)
    if sku == tiers_mod.FREE:
        raise HTTPException(404, 'free book — use the public path')

    uid = await caller(authorization)
    try:
        skus = await auth.skus_for(uid)
    except auth.Upstream as e:
        raise HTTPException(503, 'cannot reach %s right now' % e.what)
    if not allows(skus, sku):
        raise HTTPException(402, sku)

    # A track name comes from the request, so it is whitelisted to a shape
    # rather than escaped: letters, digits, dash, underscore, dot, and no
    # dot-dot. Anything else is a 404 before it can reach a key.
    if (not name or '..' in name or '/' in name or '\\' in name
            or not all(c.isalnum() or c in '-_.' for c in name)):
        raise HTTPException(404, 'bad track name')
    key = 'audio/%s/%s' % (book_id, name)

    if not storage.ready():
        raise HTTPException(501, 'file storage is not configured')
    try:
        return {'url': storage.signed_url(key), 'ttl': config.R2_SIGN_TTL}
    except storage.Unconfigured:
        raise HTTPException(501, 'file storage is not configured')
    except Exception as e:                                  # noqa: BLE001
        print('sign failed for %s: %s' % (key, e), file=sys.stderr)
        raise HTTPException(502, 'could not sign the file url')


@app.post('/v1/admin/grant')
async def grant(req: Request, x_admin_token: Optional[str] = Header(None)):
    """Give a reader an sku. This is the whole payment system on day one:
    they pay by Kaspi transfer, send the receipt, and this call runs.

    Doing it by hand first is not a shortcut to skip later — it is how the
    entitlement path gets exercised by real purchases before a provider
    integration is written against guesses about what those purchases look like.

    Body: {"email" | "user_id", "sku", "days"?, "note"?}
      days omitted → never expires (a one-off purchase)
      days present → expires that many days from now (a subscription period)
    """
    admin(x_admin_token)
    require_supabase()
    body = await req.json()
    return await _grant(body, source=body.get('source') or 'manual')


@app.post('/v1/webhook/payment')
async def webhook(req: Request, x_webhook_secret: Optional[str] = Header(None)):
    """A payment provider reports a completed payment.

    Providers differ too much to guess at — Kaspi, Freedom Pay and ePay each
    have their own body and their own signature scheme — so this takes the
    normalised shape and checks a shared secret. When a provider is chosen, the
    translation from their body to this one goes here, and everything below it
    stays as it is.

    Note what this does NOT do: trust an amount or a price sent by the caller.
    The sku decides what was bought; money is reconciled in the provider's own
    dashboard, which is the only place it is authoritative anyway.
    """
    if not config.WEBHOOK_SECRET:
        raise HTTPException(404, 'not enabled')
    if not x_webhook_secret or not secrets.compare_digest(x_webhook_secret,
                                                          config.WEBHOOK_SECRET):
        raise HTTPException(401, 'bad webhook secret')
    require_supabase()
    body = await req.json()
    return await _grant(body, source=body.get('source') or 'webhook')


async def _grant(body: dict, source: str):
    sku = (body.get('sku') or '').strip()
    if not sku:
        raise HTTPException(400, 'sku is required')

    uid = (body.get('user_id') or '').strip()
    if not uid:
        email = (body.get('email') or '').strip()
        if not email:
            raise HTTPException(400, 'user_id or email is required')
        uid = await _lookup_by_email(email)
        if not uid:
            # A real case, not an edge case: somebody pays before they have made
            # an account. Saying so precisely is what lets the answer be "tell
            # them to sign up with that address" instead of a shrug.
            raise HTTPException(404, 'no account for %s' % email)

    expires = None
    if body.get('days') is not None:
        try:
            days = int(body['days'])
        except (TypeError, ValueError):
            raise HTTPException(400, 'days must be a number')
        if days <= 0:
            raise HTTPException(400, 'days must be positive')
        from datetime import datetime, timedelta, timezone
        base = datetime.now(timezone.utc)
        # Renewing early extends the term rather than truncating it; charging
        # somebody and shortening their access is the one outcome that turns a
        # renewal into a support ticket.
        current = (await auth.skus_for(uid)).get(sku)
        if current:
            have = auth.parse_ts(current)
            if have and have > base.timestamp():
                base = datetime.fromtimestamp(have, timezone.utc)
        expires = (base + timedelta(days=days)).isoformat()

    row = {'user_id': uid, 'sku': sku, 'expires_at': expires,
           'source': source, 'note': body.get('note') or None}
    await service_post('/rest/v1/entitlements', [row],
                       params={'on_conflict': 'user_id,sku'},
                       prefer='resolution=merge-duplicates')
    auth.forget(uid)
    return {'ok': True, 'user_id': uid, 'sku': sku, 'expires_at': expires}


@app.post('/v1/admin/revoke')
async def revoke(req: Request, x_admin_token: Optional[str] = Header(None)):
    """Remove an sku — a refund, a chargeback, or a mistaken grant."""
    admin(x_admin_token)
    require_supabase()
    body = await req.json()
    uid = (body.get('user_id') or '').strip()
    if not uid:
        email = (body.get('email') or '').strip()
        uid = await _lookup_by_email(email) if email else ''
        if not uid:
            raise HTTPException(404, 'no such account')
    sku = (body.get('sku') or '').strip()
    if not sku:
        raise HTTPException(400, 'sku is required')

    res = await auth.client().delete(
        config.SUPABASE_URL + '/rest/v1/entitlements',
        params={'user_id': 'eq.' + uid, 'sku': 'eq.' + sku},
        headers={'apikey': config.SUPABASE_SERVICE_KEY,
                 'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY},
    )
    if res.status_code >= 300:
        raise HTTPException(502, 'could not revoke')
    auth.forget(uid)
    return {'ok': True, 'user_id': uid, 'sku': sku}


@app.get('/v1/admin/users')
async def list_users(page: int = 1, x_admin_token: Optional[str] = Header(None)):
    """Everyone who has signed up, with what they currently hold.

    Two calls, not one per user: GoTrue for the accounts, one PostgREST read for
    every entitlement row, joined here. A per-user query would turn a hundred
    accounts into a hundred round trips and make the page unusable exactly when
    it starts being worth having.
    """
    admin(x_admin_token)
    require_supabase()

    res = await auth.client().get(
        config.SUPABASE_URL + '/auth/v1/admin/users',
        params={'page': max(1, page), 'per_page': 200},
        headers={'apikey': config.SUPABASE_SERVICE_KEY,
                 'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY},
    )
    if res.status_code != 200:
        raise HTTPException(502, 'could not list accounts')
    users = (res.json() or {}).get('users', [])

    ent = await auth.client().get(
        config.SUPABASE_URL + '/rest/v1/entitlements',
        params={'select': 'user_id,sku,expires_at,source,note,created_at'},
        headers={'apikey': config.SUPABASE_SERVICE_KEY,
                 'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY},
    )
    if ent.status_code != 200:
        raise HTTPException(502, 'could not read entitlements')

    held: dict = {}
    for row in ent.json() or []:
        held.setdefault(row['user_id'], []).append(row)

    now = time.time()

    def shape(u):
        rows = held.get(u.get('id'), [])
        for r in rows:
            exp = r.get('expires_at')
            ts = auth.parse_ts(exp) if exp else None
            # "expired" is computed here so the page never has to reimplement
            # the same date arithmetic and reach a different answer than the
            # endpoint that actually serves content.
            r['live'] = exp is None or (ts is not None and ts > now)
        return {
            'id': u.get('id'),
            'email': u.get('email'),
            'name': ((u.get('user_metadata') or {}).get('name') or ''),
            'created_at': u.get('created_at'),
            'last_sign_in_at': u.get('last_sign_in_at'),
            'entitlements': sorted(rows, key=lambda r: r['sku']),
        }

    return {
        'users': [shape(u) for u in users],
        'page': max(1, page),
        # Distinct skus actually in use, so the page's buttons come from
        # tiers.json rather than from a list somebody has to remember to update.
        'skus': sorted(set(TIERS['books'].values()) | set(TIERS['features'].values())),
    }


@app.get('/admin')
def admin_page():
    """The panel itself. The HTML is public — it is a login form and some
    script; every byte of data behind it needs the admin token, which is asked
    for in the browser and kept in sessionStorage, so it is gone when the tab
    closes and never written to disk."""
    path = os.path.join(HERE, 'admin.html')
    if not os.path.isfile(path):
        raise HTTPException(404, 'admin page not deployed')
    with open(path, 'rb') as f:
        body = f.read()
    return Response(content=body, media_type='text/html; charset=utf-8',
                    headers={'X-Robots-Tag': 'noindex, nofollow',
                             'Cache-Control': 'no-store'})


async def _lookup_by_email(email: str) -> Optional[str]:
    """GoTrue's admin API, reachable only with the service key."""
    res = await auth.client().get(
        config.SUPABASE_URL + '/auth/v1/admin/users',
        params={'page': 1, 'per_page': 200},
        headers={'apikey': config.SUPABASE_SERVICE_KEY,
                 'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY},
    )
    if res.status_code != 200:
        raise HTTPException(502, 'could not look up that address')
    want = email.strip().lower()
    for u in (res.json() or {}).get('users', []):
        if (u.get('email') or '').lower() == want:
            return u.get('id')
    return None


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    """One error shape for the client: {"error": "..."} plus the status.

    402 carries the sku in `detail`, so the unlock screen can name what has to
    be bought without a second request.
    """
    return JSONResponse(status_code=exc.status_code, content={'error': exc.detail})
