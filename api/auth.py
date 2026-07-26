"""Who is calling, and what have they bought.

Token verification asks Supabase (`GET /auth/v1/user`) instead of checking the
JWT signature locally. Local verification is faster and needs no network, but it
needs the project's JWT secret and it has to know which algorithm the project
signs with — and Supabase has been migrating projects from a shared HS256 secret
to per-project asymmetric keys. Asking the issuer is correct under both, needs
one fewer secret in Railway, and honours a token revoked by a sign-out that a
signature check would happily still accept.

The cost is a round trip per call, so both answers are cached briefly. The TTLs
are the deliberate part: they bound how long a revoked session or a lapsed
subscription keeps working, and 60 seconds of staleness on a language-practice
app is not worth a cache-invalidation protocol.
"""
import time
from typing import Optional

import httpx

import config

TOKEN_TTL = 60.0            # how long a verified token is trusted without re-asking
ENTITLEMENT_TTL = 30.0      # how long a purchase list is reused
CACHE_MAX = 2000            # entries; a pruning threshold, not a hard limit

_tokens: dict = {}          # access_token -> (user_id, cached_at)
_grants: dict = {}          # user_id -> (skus dict, cached_at)

_client: Optional[httpx.AsyncClient] = None


def client() -> httpx.AsyncClient:
    """One connection pool for the process. Supabase is the only host called."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


async def aclose():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _prune(cache: dict, ttl: float):
    """Drop expired entries once the cache has grown enough to be worth it.

    Without this the token cache is an unbounded dict keyed by a value the
    caller controls, which is a slow memory leak on a long-lived process and a
    fast one if anybody decides to send junk tokens in a loop.
    """
    if len(cache) < CACHE_MAX:
        return
    now = time.monotonic()
    for k in [k for k, (_, at) in cache.items() if now - at > ttl]:
        cache.pop(k, None)
    if len(cache) >= CACHE_MAX:        # all still fresh — this is not normal traffic
        cache.clear()


async def user_id_for(token: str) -> Optional[str]:
    """Verify a Supabase access token. Returns the user id, or None."""
    if not token or not config.SUPABASE_READY:
        return None

    hit = _tokens.get(token)
    if hit and time.monotonic() - hit[1] < TOKEN_TTL:
        return hit[0]

    try:
        res = await client().get(
            config.SUPABASE_URL + '/auth/v1/user',
            headers={'apikey': config.SUPABASE_ANON_KEY,
                     'Authorization': 'Bearer ' + token},
        )
    except httpx.HTTPError:
        # Supabase unreachable. Returning None would read as "not signed in" and
        # tell a paying reader their purchase is gone; the caller turns this into
        # a 503 instead, which is honest and retryable.
        raise Upstream('auth')

    if res.status_code != 200:
        # A negative result is cached too, briefly: a stale tab retrying with a
        # dead token should not become a request amplifier.
        _prune(_tokens, TOKEN_TTL)
        _tokens[token] = (None, time.monotonic())
        return None

    uid = (res.json() or {}).get('id')
    _prune(_tokens, TOKEN_TTL)
    _tokens[token] = (uid, time.monotonic())
    return uid


async def skus_for(user_id: str) -> dict:
    """-> {sku: expires_at or None} for entitlements that have not expired.

    Read with the service key, which bypasses RLS. That is intentional and is
    the whole reason this service exists: the browser can read its own rows to
    draw a lock icon, but the decision that releases content has to be made
    somewhere the reader cannot reach.
    """
    if not user_id or not config.SUPABASE_READY:
        return {}

    hit = _grants.get(user_id)
    if hit and time.monotonic() - hit[1] < ENTITLEMENT_TTL:
        return hit[0]

    try:
        res = await client().get(
            config.SUPABASE_URL + '/rest/v1/entitlements',
            params={'user_id': 'eq.' + user_id, 'select': 'sku,expires_at'},
            headers={'apikey': config.SUPABASE_SERVICE_KEY,
                     'Authorization': 'Bearer ' + config.SUPABASE_SERVICE_KEY},
        )
    except httpx.HTTPError:
        raise Upstream('entitlements')

    if res.status_code != 200:
        raise Upstream('entitlements')

    now = time.time()
    live = {}
    for row in res.json() or []:
        exp = row.get('expires_at')
        if exp is None:
            live[row['sku']] = None                  # bought outright
            continue
        ts = parse_ts(exp)
        # An unparseable timestamp is treated as expired. The other way round —
        # trusting a date nobody could read — hands out content for free, and a
        # reader who was wrongly locked out will say so, while one wrongly let
        # in never will.
        if ts is not None and ts > now:
            live[row['sku']] = exp

    _prune(_grants, ENTITLEMENT_TTL)
    _grants[user_id] = (live, time.monotonic())
    return live


def forget(user_id: str):
    """Drop a cached purchase list — called right after a grant, so a reader who
    has just paid does not stare at a lock for another half minute."""
    _grants.pop(user_id, None)


def parse_ts(value: str):
    """PostgREST hands back ISO-8601; Python before 3.11 will not take a 'Z'."""
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


class Upstream(Exception):
    """Supabase failed to answer. Distinct from "the answer was no"."""

    def __init__(self, what):
        super().__init__(what)
        self.what = what
