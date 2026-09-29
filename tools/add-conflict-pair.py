#!/usr/bin/env python3
"""给 amphoreus 建立第一对 `conflictsWith`（阶段 A 要求"校验冲突字段"）。

分歧是真实的、两说都在资料里：
  S002 编年史 —— 「凯撒」刻律德菈遇刺身亡（实为自杀）
  S021 残卷   —— 性情大变、一意孤行，最后从众人视野中彻底消失
原先两种记载被合并在同一张卡里且摘要径称"她死"，按 02「冲突资料分别建卡并通过
conflictsWith 关联，不静默合并」拆开。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "resources" / "bundled-content" / "zh" / "world-lore" / "amphoreus" / "lore"
MAN = {s["id"]: s for s in json.loads(
    (ROOT / "资料" / "索引" / "下载清单.json").read_text(encoding="utf-8"))["sources"]}

NEW_ID = "amphoreus.history.kelvdeleijieju.001"
SIBLING = "amphoreus.history.diyicizhuihuo.001"


def src(sid, locator):
    m = MAN[sid]
    return {"sourceId": sid, "url": m["url"], "work": m["title"], "locator": locator}


def main():
    mp = P / "manifest.json"
    man = json.loads(mp.read_text(encoding="utf-8"))
    cards = [json.loads(l) for l in (P / "cards.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    have = {c["cardId"] for c in cards}

    if NEW_ID not in have:
        cards.insert(next(i for i, c in enumerate(cards) if c["cardId"] == SIBLING) + 1, {
            "schemaVersion": 1, "cardId": NEW_ID, "canon": "amphoreus", "type": "history",
            "title": "刻律德菈的结局（残卷记载）",
            "summary": "《第一次逐火之旅史》残卷的记载：逐火军遭遇惨败后，原本贤明的刻律德菈性情大变、一意孤行，最后从众人视野中彻底消失；政局直到阿格莱雅站出来拨乱反正才脱离混乱。与编年史「遇刺身亡」之说互异，故单独建卡。",
            "evidence": ["自那以后，原本贤明的刻律德菈性情大变、一意孤行，最后从众人视野中彻底消失",
                         "直到「金织」阿格莱雅站出来拨乱反正"],
            "characters": ["aglaea"], "locations": [], "factions": [],
            "aliases": ["刻律德菈之死"],
            "timeRange": {"from": None, "to": "3.3"}, "versionRange": None,
            "knowledgeScope": {"level": "public", "allow": [], "deny": []},
            "claimType": "source_canon", "reliability": "secondary", "spoilerLevel": "3.3",
            "conflictsWith": [SIBLING],
            "sources": [src("S021", "逐火军惨败后段")]})
        cards[cards.index(next(c for c in cards if c["cardId"] == NEW_ID))].pop("versionRange", None)
        print("新增", NEW_ID)

    sib = next(c for c in cards if c["cardId"] == SIBLING)
    if SIBLING not in [NEW_ID] and not sib.get("conflictsWith"):
        sib["conflictsWith"] = [NEW_ID]
        sib["summary"] = ("第一次逐火之旅以惨败收场：阳雷骑士塞涅俄丝弑艾格勒揭开帷幕，"
                          "刻律德菈组建逐火军猎杀泰坦夺火种；霸业告终后统领之责由阿格莱雅接任，"
                          "同年第二次逐火之旅开启。")
        quote = "『凯撒』刻律德菈遇刺身亡（实为自杀）"
        if all(quote not in e for e in sib["evidence"]):
            sib["evidence"].append(quote)
        print("互链", SIBLING, "->", NEW_ID)

    (P / "cards.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cards) + "\n", encoding="utf-8", newline="\n")
    man["cardCount"] = len(cards)
    mp.write_text(json.dumps(man, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("cardCount ->", man["cardCount"])


if __name__ == "__main__":
    main()
