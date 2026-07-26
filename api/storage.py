"""Short-lived signed URLs for the big files (PDFs, listening audio).

Why not stream them through this service: they are 25–70 MB each and there are
~560 MB in total. Proxying them would put every byte through Railway's metered
egress and hold a worker open for the length of a phone download. A signed URL
costs one small JSON response and the transfer happens between the reader and
R2, whose egress is free.

The URL is the capability, so it is deliberately short-lived (R2_SIGN_TTL,
15 minutes by default). Long enough to open a book and read it, short enough
that a link pasted into a chat is dead before it spreads.

With R2 unconfigured every call raises Unconfigured and the API says so plainly;
the client then falls back to the public static path, which is the correct
behaviour for a free book and a visible failure for a paid one.
"""
import config

try:
    import boto3
    from botocore.config import Config as BotoConfig
except ImportError:                     # boto3 is only needed if R2 is in use
    boto3 = None

_s3 = None


class Unconfigured(Exception):
    pass


def ready() -> bool:
    return config.R2_READY and boto3 is not None


def _client():
    global _s3
    if _s3 is None:
        if not ready():
            raise Unconfigured('R2 is not configured')
        _s3 = boto3.client(
            's3',
            endpoint_url=config.R2_ENDPOINT,
            aws_access_key_id=config.R2_KEY_ID,
            aws_secret_access_key=config.R2_SECRET,
            # R2 speaks S3 but only with signature v4 and a fixed region name.
            config=BotoConfig(signature_version='s3v4', region_name='auto'),
        )
    return _s3


def signed_url(key: str) -> str:
    """A time-limited GET url for one object. `key` is trusted — callers must
    build it from a validated book id, never from raw request input."""
    return _client().generate_presigned_url(
        'get_object',
        Params={'Bucket': config.R2_BUCKET, 'Key': key},
        ExpiresIn=config.R2_SIGN_TTL,
    )
