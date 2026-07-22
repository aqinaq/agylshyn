import json, io, os

SRC = '/Users/akbopebakytkeldy/Downloads/exercises-8.json'
TPL = '/private/tmp/claude-501/-Users-akbopebakytkeldy-vocab-upint/d95e0a3a-9513-4450-affa-30d904612ab2/scratchpad/template.html'
OUT = '/Users/akbopebakytkeldy/vocab-upint/vocab.html'

data = json.load(io.open(SRC, encoding='utf-8'))

# Compact JSON, then make it safe inside a <script> element.
# Every '<' in valid JSON sits inside a string literal, so < is a legal swap
# and it guarantees no "</script" sequence can appear.
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
payload = payload.replace('<', '\\u003c')

tpl = io.open(TPL, encoding='utf-8').read()
assert '__DATA__' in tpl
html = tpl.replace('__DATA__', payload)

with io.open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

print('wrote', OUT, round(os.path.getsize(OUT) / 1024), 'KB')
print('contains </script inside payload:', '</script' in payload.lower())
back = json.loads(payload)
print('round-trip units:', len(back['units']))
