#!/usr/bin/env python3
"""
app.template.html + exercises.json  ->  index.html

Деректі HTML ішіне ендіреді, сондықтан index.html-ді кез келген жерде,
интернетсіз, файл сұратпай ашуға болады (file:// режимінде де).

Қолданылуы:
    python3 build.py
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "app.template.html"
SRC_JSON = HERE / "exercises.json"
OUT = HERE / "index.html"

MARK_OPEN = '<script type="application/json" id="embedded-data">'
MARK_CLOSE = "</script>"


def main() -> int:
    for p in (TEMPLATE, SRC_JSON):
        if not p.exists():
            print(f"Табылмады: {p}", file=sys.stderr)
            return 1

    html = TEMPLATE.read_text(encoding="utf-8")
    data = json.loads(SRC_JSON.read_text(encoding="utf-8"))

    i = html.find(MARK_OPEN)
    if i == -1:
        print("app.template.html ішінен #embedded-data блогы табылмады", file=sys.stderr)
        return 1
    j = html.find(MARK_CLOSE, i)

    # </script> тізбегі JSON ішінде кездессе, HTML-ді бұзбау үшін экрандаймыз
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    OUT.write_text(html[: i + len(MARK_OPEN)] + payload + html[j:], encoding="utf-8")

    items = sum(len(e.get("items", [])) for u in data for e in u.get("exercises", []))
    print(f"✓ {OUT.name} жасалды — {len(data)} бөлім, {items} сұрақ, {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
