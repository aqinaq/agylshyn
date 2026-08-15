#!/usr/bin/env python3
"""Pushes site/audio/ and site/pdf/ to object storage.

    python3 site/tools/upload_media.py                # everything missing
    python3 site/tools/upload_media.py --force        # everything, again
    python3 site/tools/upload_media.py audio          # one folder
    python3 site/tools/upload_media.py --check        # is it all up there?
    python3 site/tools/upload_media.py --plan         # what would go, and how big

These two folders are ~550 MB and they are why a clone of this repository used
to be 700 MB: git stores a binary whole, forever, in every copy. They live in a
bucket now and the app reaches them through AUDIO_BASE and PDF_BASE in
site/media.config.js.

CREDENTIALS come from the environment or from .env (gitignored):

    R2_ACCOUNT_ID=…            # Cloudflare only; sets the endpoint for you
    R2_ENDPOINT=…              # or name the S3 endpoint yourself (B2, S3, …)
    R2_BUCKET=agylshyn-media
    R2_ACCESS_KEY_ID=…
    R2_SECRET_ACCESS_KEY=…

There is no boto3 here and none is needed: this speaks S3 over urllib with a
SigV4 signature, which is ~70 lines and no dependency — the same trade the
tests make by driving Chrome over raw CDP instead of installing puppeteer.

--check is the one to run before believing a deploy. It asks the bucket for
every file the data actually names — every `audio` block in every book, every
`pdf` in books.js — rather than for whatever happens to be on this disk, so a
recording that was never uploaded is reported as missing rather than as fine.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiers as tiers_mod

ROOT = tiers_mod.ROOT
SITE = os.path.join(ROOT, 'site')
ENV_FILE = os.path.join(ROOT, '.env')
FOLDERS = ('audio', 'pdf')

CONTENT_TYPE = {
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf',
}


# ---------------------------------------------------------------- settings

def env(name, default=None):
    v = os.environ.get(name)
    if v:
        return v
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('export '):
                    line = line[7:]
                if '=' in line and line.split('=', 1)[0].strip() == name:
                    return line.split('=', 1)[1].strip().strip('"\'')
    return default


def settings():
    endpoint = env('R2_ENDPOINT')
    account = env('R2_ACCOUNT_ID')
    if not endpoint and account:
        endpoint = 'https://%s.r2.cloudflarestorage.com' % account
    bucket = env('R2_BUCKET')
    key = env('R2_ACCESS_KEY_ID')
    secret = env('R2_SECRET_ACCESS_KEY')
    missing = [n for n, v in [('R2_ENDPOINT or R2_ACCOUNT_ID', endpoint),
                              ('R2_BUCKET', bucket),
                              ('R2_ACCESS_KEY_ID', key),
                              ('R2_SECRET_ACCESS_KEY', secret)] if not v]
    if missing:
        sys.exit('missing: ' + ', '.join(missing) + '\n'
                 'Put them in .env (gitignored) or in the environment. '
                 'See the docstring at the top of this file.')
    return endpoint.rstrip('/'), bucket, key, secret


def public_base(kind):
    """AUDIO_BASE / PDF_BASE as media.config.js has them, for --check."""
    try:
        with open(os.path.join(SITE, 'media.config.js'), encoding='utf-8') as f:
            src = f.read()
    except IOError:
        return ''
    name = 'AUDIO_BASE' if kind == 'audio' else 'PDF_BASE'
    m = re.search(r"window\.%s\s*=\s*'([^']*)'" % name, src)
    return (m.group(1) if m else '').rstrip('/')


# ---------------------------------------------------------------- signing

def sigv4(method, endpoint, bucket, path, key, secret, payload_sha, length=None):
    """Headers for one S3 request. Region is 'auto', which R2 requires and
    every other implementation accepts."""
    host = urllib.parse.urlsplit(endpoint).netloc
    now = datetime.now(timezone.utc)
    stamp = now.strftime('%Y%m%dT%H%M%SZ')
    day = now.strftime('%Y%m%d')
    canonical_uri = '/' + bucket + '/' + urllib.parse.quote(path)

    headers = {'host': host, 'x-amz-content-sha256': payload_sha, 'x-amz-date': stamp}
    if length is not None:
        headers['content-length'] = str(length)
    signed = ';'.join(sorted(headers))
    canonical_headers = ''.join('%s:%s\n' % (k, headers[k]) for k in sorted(headers))
    canonical = '\n'.join([method, canonical_uri, '', canonical_headers, signed, payload_sha])

    scope = '%s/auto/s3/aws4_request' % day
    to_sign = '\n'.join(['AWS4-HMAC-SHA256', stamp, scope,
                         hashlib.sha256(canonical.encode()).hexdigest()])
    k = ('AWS4' + secret).encode()
    for part in (day, 'auto', 's3', 'aws4_request'):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()

    out = dict(headers)
    out['Authorization'] = ('AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
                            % (key, scope, signed, sig))
    return out


def put(endpoint, bucket, path, body, ctype, key, secret):
    sha = hashlib.sha256(body).hexdigest()
    headers = sigv4('PUT', endpoint, bucket, path, key, secret, sha, len(body))
    headers['content-type'] = ctype
    req = urllib.request.Request(endpoint + '/' + bucket + '/' + urllib.parse.quote(path),
                                 data=body, headers=headers, method='PUT')
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.status


def head(endpoint, bucket, path, key, secret):
    """Size of an object, or None when it is not there."""
    empty = hashlib.sha256(b'').hexdigest()
    headers = sigv4('HEAD', endpoint, bucket, path, key, secret, empty)
    req = urllib.request.Request(endpoint + '/' + bucket + '/' + urllib.parse.quote(path),
                                 headers=headers, method='HEAD')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get('content-length') or 0)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


# ------------------------------------------------- what the data asks for

def referenced():
    """Every media path the site actually names, as site-relative paths.

    Read out of the data rather than off the disk, because those are two
    different questions. The disk answers "what did I happen to build"; the data
    answers "what will a reader ask for", and only the second one can catch a
    recording that never made it into the bucket.
    """
    paths = set()

    def walk(o):
        if isinstance(o, dict):
            if 'audio' in o:
                a = o['audio']
                files = (a.get('files') if isinstance(a, dict) else
                         [a] if isinstance(a, str) else [])
                for f in files or []:
                    paths.add(str(f).lstrip('./'))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for home in (os.path.join(SITE, 'data'), tiers_mod.CONTENT):
        if not os.path.isdir(home):
            continue
        for name in sorted(os.listdir(home)):
            if not name.endswith('.json'):
                continue
            try:
                with open(os.path.join(home, name), encoding='utf-8') as f:
                    walk(json.load(f))
            except (ValueError, IOError):
                pass

    try:
        with open(os.path.join(SITE, 'books.js'), encoding='utf-8') as f:
            for m in re.finditer(r"pdf:\s*'([^']+)'", f.read()):
                paths.add(m.group(1).lstrip('./'))
    except IOError:
        pass
    return paths


def on_disk(folders):
    out = {}
    for folder in folders:
        base = os.path.join(SITE, folder)
        for dirpath, _dirs, files in os.walk(base):
            for name in sorted(files):
                if name.startswith('.'):
                    continue
                full = os.path.join(dirpath, name)
                out[os.path.relpath(full, SITE).replace(os.sep, '/')] = full
    return out


def human(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return '%.1f %s' % (n, unit)
        n /= 1024.0


# ---------------------------------------------------------------- commands

def cmd_plan(folders):
    files = on_disk(folders)
    total = sum(os.path.getsize(p) for p in files.values())
    print('%d files, %s' % (len(files), human(total)))
    want = referenced()
    here = set(files)
    missing = sorted(p for p in want if p.split('/')[0] in folders and p not in here)
    for p in missing:
        print('  named by the data but not on this disk: ' + p)
    return 1 if missing else 0


def public_probe(folder, sample):
    """Fetch one file the way a reader's browser would: no credentials, over the
    URL in media.config.js.

    The authenticated HEAD above proves the bytes are in the bucket. It does not
    prove a reader can have them — a private bucket answers the signed request
    perfectly and gives the browser a 401, which is the single likeliest way for
    this migration to go wrong. So one file is asked for the way the app asks.

    Reported, not fatal, when there is no base yet: uploading before switching
    the app over is a sensible order to do this in.
    """
    base = public_base(folder)
    if not base:
        print('  ! media.config.js has no base for %s/ — the app will still '
              'look for it next to the site' % folder)
        return True
    url = base + '/' + sample
    req = urllib.request.Request(url, method='GET', headers={'Range': 'bytes=0-63'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ranged = r.status == 206 or (r.headers.get('accept-ranges') == 'bytes')
            print('  %s: public read OK (%s)' % (folder, url))
            if not ranged:
                print('  ! %s: the bucket did not answer a range request. Audio will '
                      'play but not seek, and pdf.js will pull whole books.' % folder)
            if folder == 'pdf' and not r.headers.get('access-control-allow-origin'):
                print('  ! pdf: no Access-Control-Allow-Origin. pdf.js reads the bytes '
                      'itself, so the phone viewer will render nothing. See media.config.js.')
            return True
    except urllib.error.HTTPError as e:
        print('  PUBLIC READ FAILED: %s -> HTTP %d. The file is in the bucket but a '
              'reader cannot fetch it; the bucket or its public URL is not public.'
              % (url, e.code))
    except Exception as e:                     # noqa: BLE001 — any network fault
        print('  PUBLIC READ FAILED: %s -> %s' % (url, e))
    return False


def cmd_check(folders):
    endpoint, bucket, key, secret = settings()
    want = sorted(p for p in referenced() if p.split('/')[0] in folders)
    if not want:
        print('nothing in the data names ' + ' or '.join(folders))
        return 0
    missing, empty = [], []
    for p in want:
        size = head(endpoint, bucket, p, key, secret)
        if size is None:
            missing.append(p)
        elif size == 0:
            empty.append(p)
    print('%d files named by the data, %d in the bucket' % (len(want), len(want) - len(missing)))
    for p in missing:
        print('  MISSING: ' + p)
    for p in empty:
        print('  EMPTY: ' + p)

    public = True
    for folder in folders:
        sample = next((p for p in want if p.split('/')[0] == folder and p not in missing), None)
        if sample:
            public = public_probe(folder, sample) and public
    return 1 if (missing or empty or not public) else 0


def cmd_upload(folders, force):
    endpoint, bucket, key, secret = settings()
    files = on_disk(folders)
    if not files:
        sys.exit('nothing in ' + ', '.join('site/' + f for f in folders))
    done = skipped = 0
    for i, path in enumerate(sorted(files), 1):
        full = files[path]
        size = os.path.getsize(full)
        if not force:
            there = head(endpoint, bucket, path, key, secret)
            # Same size is treated as same file. These are built artefacts that
            # never change in place; a re-encode changes the length.
            if there == size:
                skipped += 1
                continue
        ctype = CONTENT_TYPE.get(os.path.splitext(path)[1].lower(), 'application/octet-stream')
        with open(full, 'rb') as f:
            body = f.read()
        sys.stderr.write('[%d/%d] %s  %s\n' % (i, len(files), path, human(size)))
        put(endpoint, bucket, path, body, ctype, key, secret)
        done += 1
    print('uploaded %d, already there %d' % (done, skipped))
    print('now run: python3 site/tools/upload_media.py --check')
    return 0


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    flags = {a for a in argv if a.startswith('--')}
    bad = flags - {'--check', '--plan', '--force'}
    if bad:
        sys.exit('unknown flag: ' + ', '.join(sorted(bad)))
    folders = tuple(a for a in args if a in FOLDERS) or FOLDERS
    unknown = [a for a in args if a not in FOLDERS]
    if unknown:
        sys.exit('unknown folder: ' + ', '.join(unknown) + ' (expected: ' + ', '.join(FOLDERS) + ')')

    if '--plan' in flags:
        return cmd_plan(folders)
    if '--check' in flags:
        return cmd_check(folders)
    return cmd_upload(folders, '--force' in flags)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
