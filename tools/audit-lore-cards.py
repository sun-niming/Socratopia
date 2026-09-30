#!/usr/bin/env python3
"""审计两世界知识卡：schema、值域、来源可追溯性、cutoff 过滤。

阶段 A 的阶段门（04-minimal-verification.md §4）只要求「schema/data audit ＋
知识卡来源完整性」，故本脚本不测检索行为（T1 属阶段 B）。

cutoff 比较**复用 resources/server/lib/world-lore/version-order.js**，不另写一套
比较逻辑——这样轴的语义只有一个实现，审计跟着实现走。

用法：python3 tools/audit-lore-cards.py [-v]
退出码：0 = 全部通过；1 = 有 fail。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "resources" / "bundled-content" / "zh" / "world-lore"
COMPARATOR = ROOT / "resources" / "server" / "lib" / "world-lore" / "version-order.js"
MANIFEST = ROOT / "资料" / "索引" / "下载清单.json"

# canon -> 该世界卡片允许出现的角色 id（来自 07-pilot-roster.md §2）
CHAR_IDS = {
    "amphoreus": {"phainon", "aglaea", "anaxa", "mydei"},
    "teyvat": {"zhongli", "nahida", "furina", "raiden_shogun"},
}
# canon -> 资料/索引/下载清单.json 里的 world 名
WORLD_OF = {"amphoreus": "翁法罗斯", "teyvat": "提瓦特"}

TYPES = {"world", "location", "faction", "history", "person",
         "relation", "secret", "culture", "document"}
CLAIM_TYPES = {"source_canon", "derived_summary", "local_canon", "hypothesis"}
RELIABILITY = {"primary", "secondary", "tertiary"}
SCOPES = {"public", "restricted", "secret"}
COVERAGE_MIN = {"world": 1, "location": 4, "history": 2, "relation": 2,
                "secret": 2, "culture": 1, "faction": 1, "person": 1}

CARD_REQUIRED = ["schemaVersion", "cardId", "canon", "type", "title", "summary",
                 "evidence", "characters", "locations", "aliases", "timeRange",
                 "knowledgeScope", "claimType", "reliability", "spoilerLevel", "sources"]

# 标点与空白归一化：卡片的引文允许用不同引号／省略号，但字必须逐字一致。
_PUNCT = re.compile(r'[\s，。、；：「」『』（）()“”‘’"\'…—－\-·\[\]0-9]')
TEXT_DIR = ROOT / "资料"


def norm_quote(s):
    return _PUNCT.sub("", s)


_text_cache = {}


def source_text(sid, manifest):
    if sid not in _text_cache:
        p = TEXT_DIR / manifest[sid]["textPath"].replace("\\", "/")
        _text_cache[sid] = norm_quote(p.read_text(encoding="utf-8", errors="replace"))
    return _text_cache[sid]

fails, passes = [], []


def check(cond, label):
    (passes if cond else fails).append(label)
    return cond


def visible_at(axis, cutoff, values):
    """批量问 version-order.js：这些值是否 <= cutoff（即未超出截止点）。"""
    code = ("const V=require(process.argv[1]);const a=JSON.parse(process.argv[2]);"
            "console.log(JSON.stringify(a.values.map(v=>V.isVisibleAt(v,a.cutoff,a.axis))));")
    out = subprocess.run(["node", "-e", code, str(COMPARATOR),
                          json.dumps({"axis": axis, "cutoff": cutoff, "values": values})],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("version-order.js 调用失败: " + out.stderr.strip())
    return json.loads(out.stdout)


CONFLICT_ORDER = ROOT / "resources" / "server" / "lib" / "world-lore" / "conflict-order.js"


def conflict_rank(cards, sources):
    """问 conflict-order.js 要主副归属——排序只有一份实现，审计跟着它走。"""
    natures = {sid: s.get("sourceNature", "") for sid, s in sources.items()}
    code = ("const C=require(process.argv[1]);const a=JSON.parse(process.argv[2]);"
            "const g=C.rankGroup(a.cards,{sourceNatures:a.natures});"
            "console.log(JSON.stringify({primary:g.primary.cardId,reason:g.reason}));")
    out = subprocess.run(["node", "-e", code, str(CONFLICT_ORDER),
                          json.dumps({"cards": cards, "natures": natures})],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("conflict-order.js 调用失败: " + out.stderr.strip())
    return json.loads(out.stdout)


def main():
    sources = {s["id"]: s for s in json.loads(MANIFEST.read_text(encoding="utf-8"))["sources"]}

    for canon, world in WORLD_OF.items():
        cdir = PKG / canon / "lore"
        mpath, cpath, apath = cdir / "manifest.json", cdir / "cards.jsonl", cdir / "aliases.json"
        if not check(mpath.exists() and cpath.exists() and apath.exists(),
                     f"{canon}: lore/ 三个文件齐备"):
            continue
        man = json.loads(mpath.read_text(encoding="utf-8"))
        check(man.get("canon") == canon, f"{canon}: manifest.canon 自洽")
        cut = man.get("canonCutoff") or {}
        axis, cutoff = cut.get("axis"), cut.get("value")
        check(axis in {"hsr-version", "genshin-version", "genshin-chapter-act"},
              f"{canon}: manifest.canonCutoff.axis 合法 ({axis})")
        check(bool(cutoff), f"{canon}: manifest.canonCutoff.value 非空")
        if canon == "teyvat":
            check(cut.get("versionFloor"), "teyvat: manifest 带 versionFloor (D018)")
        aliases = json.loads(apath.read_text(encoding="utf-8"))

        raw = cpath.read_text(encoding="utf-8")
        check(raw.endswith("\n"), f"{canon}: cards.jsonl 以换行结尾")
        cards, bad_lines = [], []
        for i, ln in enumerate(raw.splitlines(), 1):
            if not ln.strip():
                continue
            try:
                cards.append(json.loads(ln))
            except json.JSONDecodeError as e:
                bad_lines.append(f"line {i}: {e}")
        check(not bad_lines, f"{canon}: 每行都是合法 JSON ({bad_lines[:2]})")
        check(len(cards) >= 30, f"{canon}: 卡片数 >=30 (实际 {len(cards)})")
        check(man.get("cardCount") == len(cards),
              f"{canon}: manifest.cardCount 与文件一致 ({man.get('cardCount')} vs {len(cards)})")

        seen, types, chars_used = set(), {}, set()
        vis_pairs, ver_pairs = [], []
        for c in cards:
            cid = c.get("cardId", "?")
            for f in CARD_REQUIRED:
                check(f in c, f"{canon}/{cid}: 缺字段 {f}")
            if any(f not in c for f in CARD_REQUIRED):
                continue
            check(re.match(rf"^{canon}\.[a-z_]+\.", cid) is not None,
                  f"{canon}/{cid}: cardId 前缀")
            check(cid not in seen, f"{canon}/{cid}: cardId 唯一")
            seen.add(cid)
            check(c["canon"] == canon, f"{canon}/{cid}: canon 自洽")
            check(c["type"] in TYPES, f"{canon}/{cid}: type 越界 ({c['type']})")
            check(c["claimType"] in CLAIM_TYPES, f"{canon}/{cid}: claimType 越界")
            check(c["reliability"] in RELIABILITY, f"{canon}/{cid}: reliability 越界")
            check(bool(c["summary"].strip()), f"{canon}/{cid}: summary 非空")
            check(isinstance(c["evidence"], list) and c["evidence"],
                  f"{canon}/{cid}: evidence 非空数组")
            check(c["knowledgeScope"].get("level") in SCOPES,
                  f"{canon}/{cid}: knowledgeScope.level 越界")
            # 私密默认拒绝、只有显式 allow 才可返回，故非 public 卡必须有人被 allow，
            # 否则这张卡谁都检索不到（等于死卡）。
            if c["knowledgeScope"].get("level") != "public":
                check(bool(c["knowledgeScope"].get("allow")),
                      f"{canon}/{cid}: 非 public 卡必须显式 allow，否则不可达")
            for k in ("allow", "deny"):
                ids = set(c["knowledgeScope"].get(k, []))
                check(ids <= CHAR_IDS[canon], f"{canon}/{cid}: knowledgeScope.{k} 角色 id")
            check(set(c["characters"]) <= CHAR_IDS[canon],
                  f"{canon}/{cid}: characters 无跨世界串用")
            check(set(c["characters"]) <= CHAR_IDS[canon] and
                  isinstance(c["characters"], list), f"{canon}/{cid}: characters 是数组")
            types[c["type"]] = types.get(c["type"], 0) + 1
            chars_used |= set(c["characters"])

            # 来源可追溯：sourceId 存在、url 相符、来源 world 相符、已核验
            check(isinstance(c["sources"], list) and c["sources"],
                  f"{canon}/{cid}: 至少一个来源")
            for s in c["sources"]:
                sid = s.get("sourceId")
                if not check(sid in sources, f"{canon}/{cid}: sourceId {sid} 在下载清单中"):
                    continue
                check(s.get("url") == sources[sid]["url"], f"{canon}/{cid}: {sid} url 相符")
                check(sources[sid]["world"] == world, f"{canon}/{cid}: {sid} world 相符")
                check(sources[sid]["verification"] == "已读取页面",
                      f"{canon}/{cid}: {sid} 已核验")
                check(bool(s.get("locator")), f"{canon}/{cid}: {sid} 带 locator")

            # 引文必须是**被引来源**里的逐字片段（可用 … 省略）。
            # 这条最要紧：来源 id 对得上不等于引文真在那份文件里。
            sids = [s["sourceId"] for s in c["sources"] if s.get("sourceId") in sources]
            for e in c["evidence"]:
                for seg in re.split(r"…|\.\.\.", e):
                    if len(norm_quote(seg)) < 6:
                        continue
                    check(any(norm_quote(seg) in source_text(s, sources) for s in sids),
                          f"{canon}/{cid}: 引文逐字在被引来源中 -> {seg.strip()[:40]}")

            vis_pairs.append((cid, c["spoilerLevel"]))
            if canon == "teyvat":
                vr = c.get("versionRange")
                check(isinstance(vr, dict) and "to" in vr, f"{canon}/{cid}: 带 versionRange.to")
                if isinstance(vr, dict) and vr.get("to"):
                    ver_pairs.append((cid, vr["to"]))

        if cutoff:
            for (cid, v), okv in zip(vis_pairs, visible_at(axis, cutoff, [v for _, v in vis_pairs])):
                check(okv, f"{canon}/{cid}: spoilerLevel {v} 未超 cutoff {cutoff}")
        if canon == "teyvat" and ver_pairs and cut.get("versionFloor"):
            for (cid, v), okv in zip(ver_pairs, visible_at("genshin-version", cut["versionFloor"],
                                                          [v for _, v in ver_pairs])):
                check(okv, f"teyvat/{cid}: versionRange.to {v} 未超 versionFloor")

        for t, lo in COVERAGE_MIN.items():
            check(types.get(t, 0) >= lo, f"{canon}: 类别 {t} >= {lo} (实际 {types.get(t,0)})")
        for cid in CHAR_IDS[canon]:
            check(cid in chars_used, f"{canon}: 角色 {cid} 至少出现在一张卡上")

        # conflictsWith 必须对称、同 canon、且指向存在的卡——单向声明会让冲突
        # 只在一半场景被看到（02：不静默合并，但也不许只连一头）。
        for c in cards:
            for t in c.get("conflictsWith") or []:
                check(t in seen, f"{canon}/{c['cardId']}: conflictsWith 指向存在的卡 ({t})")
                other = next((x for x in cards if x["cardId"] == t), None)
                if other is not None:
                    check(c["cardId"] in (other.get("conflictsWith") or []),
                          f"{canon}/{c['cardId']}: conflictsWith 与 {t} 对称")
                    # 同 type：否则"另说"会跨层（拿地点卡去补充历史卡）。
                    check(c["type"] == other["type"],
                          f"{canon}/{c['cardId']}: conflictsWith 两侧 type 相同")

        # 每个冲突对必须能被 conflict-order.js 排出**有意义**的主副（复用同一实现，
        # 不另写排序）。只落到 cardId 兜底说明两侧在来源层级与 reliability 上无从分辨，
        # 即"哪一说更接近原著"没被记下来。
        pairs = {}
        for c in cards:
            for t in c.get("conflictsWith") or []:
                key = tuple(sorted([c["cardId"], t]))
                pairs[key] = (c, next((x for x in cards if x["cardId"] == t), None))
        for key, (a, b) in sorted(pairs.items()):
            if b is None:
                continue
            got = conflict_rank([a, b], sources)
            check(got["reason"] != "cardId",
                  f"{canon}/{key[0]} <-> {key[1]}: 主副可由层级或 reliability 判定（实际 {got['reason']}）")
            check(got["primary"] in key,
                  f"{canon}/{key[0]} <-> {key[1]}: 主卡出自本对（实际 {got['primary']}）")
            print(f"  冲突对 {key[0]} <-> {key[1]}: 主={got['primary']} 依据={got['reason']}")

        # 别名表必须与卡片双向自洽：无空别名、不指向不存在的卡、卡片别名全被聚合。
        amap = aliases.get("aliases") or {}
        check(bool(amap), f"{canon}: aliases.json 非空")
        check(all(str(k).strip() for k in amap), f"{canon}: 无空别名")
        flat = [i for v in amap.values() for i in v]
        check(set(flat) <= seen, f"{canon}: 别名不指向不存在的 cardId")
        missing = [(c["cardId"], a) for c in cards for a in c["aliases"]
                   if c["cardId"] not in (amap.get(a) or [])]
        check(not missing, f"{canon}: 卡片别名全部聚合进 aliases.json (缺 {missing[:3]})")
        print(f"{canon}: {len(cards)} 卡, 类型分布 {dict(sorted(types.items()))}")

    print(f"\naudit-lore-cards: {'PASS' if not fails else 'FAIL'} "
          f"({len(passes)} passed, {len(fails)} failed)")
    if fails:
        for f in fails[:40]:
            print("  FAIL:", f)
        if len(fails) > 40:
            print(f"  ... 另有 {len(fails)-40} 条")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
