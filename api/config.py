"""Environment for the entitlement API. Read once, validated once, at import.

Railway injects everything through the environment, so a typo in a variable name
is otherwise a 500 on the first paying customer rather than a message at boot.
`describe()` is what /health reports: which pieces are configured, never their
values.
"""
import os

# --- Supabase -------------------------------------------------------------
# SERVICE_KEY bypasses row-level security, which is exactly why the API needs it
# (it reads and writes other people's entitlement rows) and exactly why it must
# never reach the browser. It belongs in Railway's variables and nowhere else.
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# --- secrets --------------------------------------------------------------
ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', '')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')

# Who may run the admin panel inside the site, by the address they signed in
# with. Comma-separated, compared lower-case.
#
# An email rather than a role column, because the check has to survive the
# account being deleted and recreated, and because the list has to be readable
# by the person maintaining it a year from now. It is not a secret — it is a
# list of who is trusted, and trusting it is the server's job: the client is
# told "you are an admin" only so it can draw a menu item, and every endpoint
# re-derives the same answer from the verified token.
ADMIN_EMAILS = [e.strip().lower() for e in
                os.environ.get('ADMIN_EMAILS', '').split(',') if e.strip()]

# --- object storage (optional) -------------------------------------------
# PDFs and audio are hundreds of megabytes. They do not belong in the Railway
# image (slow deploys, ephemeral disk, metered egress); they belong in R2, whose
# egress is free, reached through short-lived signed URLs this service mints.
R2_ENDPOINT = os.environ.get('R2_ENDPOINT', '')
R2_BUCKET = os.environ.get('R2_BUCKET', '')
R2_KEY_ID = os.environ.get('R2_KEY_ID', '')
R2_SECRET = os.environ.get('R2_SECRET', '')
R2_SIGN_TTL = int(os.environ.get('R2_SIGN_TTL', '900'))     # seconds

# --- browser --------------------------------------------------------------
# The frontend is on another origin (Pages/Cloudflare), so CORS is not optional.
# Comma-separated, exact origins. '*' is refused when credentials are involved
# by the browser itself, so listing them is the only thing that works.
ALLOWED_ORIGINS = [o.strip() for o in
                   os.environ.get('ALLOWED_ORIGINS', '').split(',') if o.strip()]

SUPABASE_READY = bool(SUPABASE_URL and SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY)
R2_READY = bool(R2_ENDPOINT and R2_BUCKET and R2_KEY_ID and R2_SECRET)


def problems():
    """Misconfigurations that would make the service lie rather than fail loudly."""
    out = []
    if not SUPABASE_URL:
        out.append('SUPABASE_URL is unset — no token can be verified')
    if not SUPABASE_ANON_KEY:
        out.append('SUPABASE_ANON_KEY is unset — token verification will fail')
    if not SUPABASE_SERVICE_KEY:
        out.append('SUPABASE_SERVICE_KEY is unset — entitlements cannot be read')
    if not ALLOWED_ORIGINS:
        out.append('ALLOWED_ORIGINS is unset — every browser request will be blocked')
    if not ADMIN_TOKEN and not ADMIN_EMAILS:
        out.append('ADMIN_TOKEN and ADMIN_EMAILS are both unset — nobody can administer anything')
    if not WEBHOOK_SECRET:
        out.append('WEBHOOK_SECRET is unset — /v1/webhook/payment is disabled')
    return out


def describe():
    return {
        'supabase': SUPABASE_READY,
        'storage': R2_READY,
        'admin': bool(ADMIN_TOKEN),
        'admins': len(ADMIN_EMAILS),
        'webhook': bool(WEBHOOK_SECRET),
        'origins': len(ALLOWED_ORIGINS),
    }
