#!/usr/bin/env python3
"""Pushes the paid books into Supabase, where the subscription check happens.

    export SUPABASE_SERVICE_KEY=…            # Settings -> API -> service_role
    python3 site/tools/upload_content.py     # every paid book
    python3 site/tools/upload_content.py vocab-adv ielts-21
    python3 site/tools/upload_content.py --list

Run it after any rebuild of a paid book. Nothing else reads content/ — the app
asks Supabase, so a book that has been rebuilt but not uploaded is a book whose
subscribers are still on last week's copy.

THE KEY. service_role bypasses row-level security, which is exactly why the
upload needs it and exactly why it must never be in the repository or in
site/supabase.config.js. It lives in the environment (or in .env, which is
gitignored). The anon key that ships in the client cannot write here.

Sizes are why this is a table and not a bucket: the largest book is ~650 KB of
JSON, all thirteen together are under 4 MB, and a jsonb row that PostgREST
serves under RLS needs no signed urls, no expiry, and no second service.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiers as tiers_mod

CONFIG_JS = os.path.join(tiers_mod.ROOT, 'site', 'supabase.config.js')
ENV_FILE = os.path.join(tiers_mod.ROOT, '.env')


def project_url():
    """The project URL, from the environment or from supabase.config.js.

    Read from the config the app itself uses so the two cannot point at
    different projects — the failure that looks like "the upload worked and the
    site still says locked".
    """
    env = os.environ.get('SUPABASE_URL')
    if env:
        return env.rstrip('/')
    try:
        with open(CONFIG_JS, encoding='utf-8') as f:
            m = re.search(r"url:\s*'([^']+)'", f.read())
    except IOError:
        m = None
    if not m or not m.group(1):
        sys.exit('No Supabase URL. Set SUPABASE_URL, or fill in site/supabase.config.js.')
    return m.group(1).rstrip('/')


def service_key():
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key and os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding='utf-8') as f:
            for line in f:
                m = re.match(r'\s*(?:export\s+)?SUPABASE_SERVICE(?:_ROLE)?_KEY\s*=\s*(.+)', line)
                if m:
                    key = m.group(1).strip().strip('"').strip("'")
                    break
    if not key:
        sys.exit('No service key. Supabase dashboard -> Settings -> API -> service_role,\n'
                 'then:  export SUPABASE_SERVICE_KEY=…')
    return key


def post(url, key, path, body, prefer=None):
    headers = {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(url + path, data=json.dumps(body).encode('utf-8'),
                                 headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')
        # 404 on the table is the one error with an obvious fix, so say the fix
        # rather than the status code.
        if e.code == 404:
            sys.exit('The book_content table does not exist yet.\n'
                     'Run site/tools/supabase_schema.sql in the SQL editor first.')
        sys.exit('HTTP %d from Supabase: %s' % (e.code, detail))


def upload(url, key, book_id):
    src = os.path.join(tiers_mod.CONTENT, book_id + '.json')
    if not os.path.exists(src):
        # A paid book still sitting in site/data/ is the common case right after
        # editing tiers.json, and the fix is one command away.
        alt = os.path.join(tiers_mod.DATA, book_id + '.json')
        if os.path.exists(alt):
            sys.exit('%s is still in site/data/. Run split_content.py first.' % book_id)
        print('  %-20s missing — not built yet, skipped' % book_id)
        return 0
    with open(src, encoding='utf-8') as f:
        data = json.load(f)
    kb = os.path.getsize(src) // 1024
    post(url, key, '/rest/v1/book_content', [{
        'book_id': book_id,
        'data': data,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }], prefer='resolution=merge-duplicates,return=minimal')
    print('  %-20s %4d KB  %3d units' % (book_id, kb, len(data.get('units') or [])))
    return 1


def main(argv):
    paid = sorted(tiers_mod.load())
    if '--list' in argv:
        for b in paid:
            where = tiers_mod.source_of(b, set(paid))
            print('%-20s %s' % (b, os.path.relpath(where, tiers_mod.ROOT) if where else '— not built'))
        return 0

    wanted = [a for a in argv if not a.startswith('-')] or paid
    unknown = [b for b in wanted if b not in paid]
    if unknown:
        sys.exit('Not paid books (see tools/tiers.json): ' + ', '.join(unknown))

    url, key = project_url(), service_key()
    print('%s  ->  %s' % (', '.join(wanted) if len(wanted) < 4 else '%d books' % len(wanted), url))
    n = sum(upload(url, key, b) for b in wanted)
    print('%d uploaded' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
