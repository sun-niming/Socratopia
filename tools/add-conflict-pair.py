#!/usr/bin/env python3
"""把 amphoreus 的刻律德菈结局做成**对称**的一对冲突卡。

第一版把冲突挂在「第一次逐火之旅」整卡上，宽窄不对等——那一对里"另说"的首句讲的是
逐火之旅而非她的结局。改为同一 slug 的 001／002 两张窄卡成对，各只承担一种记载：

  001  残卷记载（`S021`，游戏内文献）           -> 主
  002  编年史记载（`S002`，社区设定汇总）        -> 另说

narrow 之后「第一次逐火之旅」卡不再是冲突成员，从它身上摘掉 `conflictsWith` 与那句
死亡引文（否则同一件事在三张卡上重复）。脚本收敛式、可重跑。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "resources" / "bundled-content" / "zh" / "world-lore" / "amphoreus" / "lore"
MAN = {s["id"]: s for s in json.loads(
    (ROOT / "资料" / "索引" / "下载清单.json").read_text(encoding="utf-8"))["sources"]}

ROLL = "amphoreus.history.kelvdeleijieju.001"
CHRON = "amphoreus.history.kelvdeleijieju.002"
NARRATIVE = "amphoreus.history.diyicizhuihuo.001"
DEATH_QUOTE = "「凯撒」刻律德菈遇刺身亡（实为自杀）"


def src(sid, locator):
    m = MAN[sid]
    return {"sourceId": sid, "url": m["url"], "work": m["title"], "locator": locator}


def main():
    mp = P / "manifest.json"
    man = json.loads(mp.read_text(encoding="utf-8"))
    cards = [json.loads(l) for l in (P / "cards.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    by_id = {c["cardId"]: c for c in cards}
    changed = 0

    # 001：残卷记载（已存在则只对齐 pairs）
    if ROLL in by_id:
        c = by_id[ROLL]
        if c.get("conflictsWith") != [CHRON]:
            c["conflictsWith"] = [CHRON]; changed += 1
    else:
        raise SystemExit("缺 " + ROLL)

    # 002：编年史记载
    if CHRON not in by_id:
        chron = {
            "schemaVersion": 1, "cardId": CHRON, "canon": "amphoreus", "type": "history",
            "title": "刻律德菈的结局（编年史记载）",
            "summary": "《翁法罗斯编年史》的记载：同年，「凯撒」刻律德菈遇刺身亡（实为自杀），"
                       "「金织」阿格莱雅接过统领职责。与残卷「彻底消失」之说互异，故单独建卡。",
            "evidence": [DEATH_QUOTE, "「金织」阿格莱雅接过统领职责"],
            "characters": ["aglaea"], "locations": [], "factions": [],
            "aliases": ["凯撒遇刺"],
            "timeRange": {"from": None, "to": "3.3"},
            "knowledgeScope": {"level": "public", "allow": [], "deny": []},
            "claimType": "derived_summary", "reliability": "secondary", "spoilerLevel": "3.3",
            "conflictsWith": [ROLL], "sources": [src("S002", "第二次逐火之旅前后")]}
        cards.insert(list(by_id).index(NARRATIVE) + 2, chron)
        changed += 1
        print("新增", CHRON)

    # 叙述卡退出冲突组，并摘掉重复的死亡引文
    nar = by_id[NARRATIVE]
    if nar.get("conflictsWith"):
        nar.pop("conflictsWith"); changed += 1
    if DEATH_QUOTE in (nar.get("evidence") or []):
        nar["evidence"] = [e for e in nar["evidence"] if e != DEATH_QUOTE]; changed += 1

    (P / "cards.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cards) + "\n",
        encoding="utf-8", newline="\n")
    man["cardCount"] = len(cards)
    mp.write_text(json.dumps(man, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"cardCount -> {man['cardCount']}（本次改动 {changed} 处）")


if __name__ == "__main__":
    main()
