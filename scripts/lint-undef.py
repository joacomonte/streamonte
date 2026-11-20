"""Nombres sin definir en la UI (2026-11-17): lee `deno lint --json --rules-include=no-undef` por stdin.
`no-undef` no conoce los globales del navegador: se ignoran solo esos. Lo usa scripts/check.sh."""
import json
import re
import sys

BROWSER = {"document", "matchMedia", "innerWidth", "innerHeight", "requestAnimationFrame", "Node", "localStorage", "getComputedStyle", "ClipboardItem", "IntersectionObserver", "cancelAnimationFrame", "NodeFilter"}
bad = []
for d in json.load(sys.stdin)["diagnostics"]:
    name = re.match(r"(\S+)", d["message"]).group(1)
    if d["code"] == "no-undef" and name not in BROWSER:
        bad.append(f'{d["filename"].rsplit("/", 1)[-1]}:{d["range"]["start"]["line"]} {d["message"]}')
print("\n".join(bad))
sys.exit(1 if bad else 0)
