#!/usr/bin/env python3
"""阶段 A 守门：发布包整体审计（模板 + 卡片 + 绑定），并静态模拟权限过滤。

`tools/audit-lore-cards.py` 只管卡片。本脚本补上它没管的：模板文件、槽位→角色绑定、
出处可追溯、注入预算、截止点被模板真正写上，以及用**静态过滤模拟**逼近阶段 A 的
完成定义「同一秘密不会被无权限角色检索到」。

真正的检索器是阶段 B 的 `retriever.js`；这里只是按过滤规则算集合，
证明数据本身足以区分"谁知道／谁不知道"。

用法：python3 tools/audit-lore-package.py
退出码：0 = 全部通过；1 = 有 fail。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "resources" / "bundled-content" / "zh" / "world-lore"
MANIFEST = ROOT / "资料" / "索引" / "下载清单.json"

WORLD_OF = {"amphoreus": "翁法罗斯", "teyvat": "提瓦特"}
AXES = {"hsr-version", "genshin-version", "genshin-chapter-act"}
SLOTS = ["npc_a", "npc_b", "npc_c", "npc_d"]
STORY_BUDGET, NPC_BUDGET = 4000, 1800

# 各世界模板里不该出现的对方专名
FORBIDDEN = {
    "amphoreus": ["摩拉", "神之眼", "尘世七执政", "坎瑞亚", "神之心", "元素力"],
    "teyvat": ["火种", "黄金裔", "泰坦", "光历", "逐火", "半神", "永劫回归"],
}

fails, passes = [], []


def check(cond, label):
    (passes if cond else fails).append(label)
    return cond


def visible(card, speaker):
    """过滤规则：public 人人可见；否则必须显式 allow，deny 再逐出。"""
    ks = card["knowledgeScope"]
    if ks["level"] == "public":
        return True
    if speaker in (ks.get("deny") or []):
        return False
    allow = ks.get("allow") or []
    return speaker in allow if allow else False


def main():
    sources = {s["id"]: s for s in json.loads(MANIFEST.read_text(encoding="utf-8"))["sources"]}

    for canon, world in WORLD_OF.items():
        cdir = PKG / canon
        man = json.loads((cdir / "lore" / "manifest.json").read_text(encoding="utf-8"))
        slots = man.get("pilotSlots") or {}
        check(sorted(slots) == SLOTS, f"{canon}: pilotSlots 恰为 npc_a..npc_d")
        ids = {v["id"] for v in slots.values()}
        check(len(ids) == 4, f"{canon}: pilotSlots id 唯一")

        cut = man.get("canonCutoff") or {}
        check(cut.get("axis") in AXES, f"{canon}: cutoff.axis 合法")
        check(bool(cut.get("value")), f"{canon}: cutoff.value 非空")
        if canon == "teyvat":
            check(bool(cut.get("versionFloor")), "teyvat: 带 versionFloor（D018）")

        # --- 模板文件：齐备、H1 与绑定一致、出处可追溯、预算内、写上截止点 ---
        for f in ("story.md",) + tuple(s + ".md" for s in SLOTS):
            p = cdir / f
            if not check(p.exists(), f"{canon}/{f}: 存在"):
                continue
            txt = p.read_text(encoding="utf-8")
            check(len(txt) <= (STORY_BUDGET if f == "story.md" else NPC_BUDGET),
                  f"{canon}/{f}: 正文 <= {'4000' if f == 'story.md' else '1800'} 字符（注入预算）")
            h1 = re.search(r"^# (.+)$", txt, re.M)
            check(h1 is not None, f"{canon}/{f}: 有 H1")
            if f != "story.md" and h1:
                check(h1.group(1).strip() == slots[f[:-3]]["name"],
                      f"{canon}/{f}: H1 与该槽位绑定角色名一致（{slots[f[:-3]]['name']}）")
            for sid in set(re.findall(r"\bS\d{3}\b", txt)):
                if not check(sid in sources, f"{canon}/{f}: 出处 {sid} 存在"):
                    continue
                check(sources[sid]["verification"] == "已读取页面", f"{canon}/{f}: {sid} 已核验")
                check(sources[sid]["world"] == world, f"{canon}/{f}: {sid} 属本世界")
        story = (cdir / "story.md").read_text(encoding="utf-8")
        check(cut["value"] in story, f"{canon}: story.md 写明截止点 {cut['value']}")

        # 跨世界专名：S-id 的 world 检查管得住引用，管不住正文里手滑写出的对方名词。
        for f in ("story.md",) + tuple(s + ".md" for s in SLOTS):
            t = (cdir / f).read_text(encoding="utf-8")
            leaked = [w for w in FORBIDDEN[canon] if re.search(w, t)]
            check(not leaked, f"{canon}/{f}: 无对方世界专名（命中 {leaked}）")

        # --- 卡片：id 与绑定自洽 ---
        cards = [json.loads(l) for l in (cdir / "lore" / "cards.jsonl").read_text(
            encoding="utf-8").splitlines() if l.strip()]
        used = {i for c in cards for i in c["characters"]}
        check(used == ids, f"{canon}: 卡片用到的角色 id 恰为绑定的 4 个（差 {used ^ ids}）")

        # --- 完成定义「同一秘密不会被无权限角色检索到」的静态逼近 ---
        for c in cards:
            ks = c["knowledgeScope"]
            allow, deny = set(ks.get("allow") or []), set(ks.get("deny") or [])
            check(allow <= ids and deny <= ids, f"{canon}/{c['cardId']}: allow/deny 用本世界 id")
            check(not (allow & deny), f"{canon}/{c['cardId']}: allow 与 deny 不相交")
            can = [i for i in ids if visible(c, i)]
            if ks["level"] != "public":
                check(bool(can), f"{canon}/{c['cardId']}: 至少一个角色可检索到（非死卡）")
                check(len(can) < len(ids),
                      f"{canon}/{c['cardId']}: 至少一个角色检索不到（否则该标 public）")
        print(f"{canon}: 模板 5 份、卡片 {len(cards)} 张，"
              f"非 public 卡 {sum(1 for c in cards if c['knowledgeScope']['level'] != 'public')} 张")

    print(f"\naudit-lore-package: {'PASS' if not fails else 'FAIL'} "
          f"({len(passes)} passed, {len(fails)} failed)")
    for f in fails[:30]:
        print("  FAIL:", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
