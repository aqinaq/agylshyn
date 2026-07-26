Paid book JSON lives here — moved out of site/data/ by tools/split_content.py.

Nothing in this folder is ever served raw: api/main.py reads it only after an
entitlement check. It is deployed to Railway and to nowhere else.
