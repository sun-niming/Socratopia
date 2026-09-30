#!/usr/bin/env python3
"""由 cards.jsonl 派生 aliases.json 与 source-layers.json（真源是卡片与下载清单）。

别名表：键序按卡片在 cards.jsonl 中的出现顺序，值按出现顺序去重——两次运行结果一致。

source-layers.json（sid -> sourceNature）是给**运行时**用的：`retriever` 里冲突主副要靠
来源层级判（世界观内 > 社区整理），而账户世界里没有 `资料/索引/下载清单.json`。缺这张表
时冲突仍能排（退回 reliability／cardId），但会与审计算出的主副不一致。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "resources" / "bundled-content" / "zh" / "world-lore"
MAN = {s["id"]: s for s in json.loads(
    (ROOT / "资料" / "索引" / "下载清单.json").read_text(encoding="utf-8"))["sources"]}


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

        cited = sorted({s["sourceId"] for c in cards for s in c.get("sources") or []})
        missing = [sid for sid in cited if sid not in MAN]
        assert not missing, f"{canon}: 卡片引用了清单里没有的来源 {missing}"
        layers = {sid: MAN[sid].get("sourceNature", "") for sid in cited}
        lp = PKG / canon / "lore" / "source-layers.json"
        lp.write_text(json.dumps({"schemaVersion": 1, "sourceNatures": layers},
                                 ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        from collections import Counter
        print(f"{canon}: {len(layers)} 条来源层级 -> {lp.name} "
              f"{dict(Counter('社区' if '社区' in v else ('游戏内' if '游戏内' in v else '未定') for v in layers.values()))}")


if __name__ == "__main__":
    main()
