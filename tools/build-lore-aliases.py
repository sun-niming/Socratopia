#!/usr/bin/env python3
"""由 cards.jsonl 派生 aliases.json（唯一真源是卡片本身，别名表不许手填）。

键序按卡片在 cards.jsonl 中的出现顺序，值按出现顺序去重——两次运行结果一致。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "resources" / "bundled-content" / "zh" / "world-lore"


def main():
    for canon in ("amphoreus", "teyvat"):
        p = PKG / canon / "lore" / "cards.jsonl"
        cards = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
        amap = {}
        for c in cards:
            for a in c.get("aliases") or []:
                if not str(a).strip():
                    continue
                amap.setdefault(a, [])
                if c["cardId"] not in amap[a]:
                    amap[a].append(c["cardId"])
        out = PKG / canon / "lore" / "aliases.json"
        out.write_text(json.dumps({"schemaVersion": 1, "aliases": amap},
                                  ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{canon}: {len(amap)} 条别名 -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
