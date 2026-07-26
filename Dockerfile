# Railway build for the entitlement API (api/). The static site is not in here —
# it keeps going out to Pages, unchanged.
#
# A Dockerfile rather than Nixpacks autodetection, for one reason: what gets
# COPYed is written down. This repo is ~560 MB of PDFs and listening audio, none
# of which belongs in a service image, and an autodetected build would have to be
# talked out of them with ignore files. Here the default is "nothing", and the
# four COPY lines below are the whole deploy.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first, in their own layer: application code changes on every push,
# these change a few times a year, and Docker caches up to the first line that
# differs. Rebuilds after a code edit skip pip entirely.
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# The service, including api/content/ — the paid book JSON that split_content.py
# moved out of the public site. Under 4 MB, and the only copy that exists on a
# host anyone can reach.
COPY api/ api/

# tiers.json is the single source of truth for which books are paid, and it lives
# with the build tools that also read it. Copying it (rather than duplicating it
# into api/) is what keeps the server, the index builder and the split tool from
# ever disagreeing about what is behind the paywall.
COPY site/tools/tiers.py site/tools/tiers.json site/tools/

EXPOSE 8000

# Railway injects $PORT. The shell form is required for it to be expanded, and
# the default keeps `docker run` usable locally without setting anything.
CMD uvicorn main:app --app-dir api --host 0.0.0.0 --port ${PORT:-8000}
