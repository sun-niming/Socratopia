#!/usr/bin/env python3
"""为审计失败的引文定位真实原文，输出可粘贴的替换候选。

对每条失败引文：在被引来源（找不到则全库）里按「最长公共子串」找到最贴近的原文片段，
把该片段连同前后各 20 字打印出来，供人工判定"是压缩、换词，还是引错了来源"。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "resources" / "bundled-content" / "zh" / "world-lore"
MAN = {s["id"]: s for s in json.loads(
    (ROOT / "资料" / "索引" / "下载清单.json").read_text(encoding="utf-8"))["sources"]}

_P = re.compile(r'[\s，。、；：「」『』（）()“”‘’"\'…—－\-·\[\]0-9]')
norm = lambda s: _P.sub("", s)


def raw(sid):
    return (ROOT / "资料" / MAN[sid]["textPath"].replace("\\", "/")).read_text(
        encoding="utf-8", errors="replace")


def best(q, text):
    """返回 (匹配长度, 原文片段)。按 q 的前 5 个归一化字符定位再向两侧扩展。"""
    nq = norm(q)
    if len(nq) < 5:
        return 0, ""
    key = nq[:5]
    nt = norm(text)
    idx = nt.find(key)
    if idx == -1:
        return 0, ""
    # 在归一化序列上向前后扩展
    start = idx
    while start > 0 and nt[start - 1] == nq[idx - (idx - start)] if False else True:
        break
    lo = idx
    while lo > 0:
        cand = nt[lo - 1:lo + len(nq)]
        if cand and nq.startswith(cand[:min(len(cand), len(nq))]) and len(cand) <= len(nq) + 6:
            lo -= 1
        else:
            break
    hi = idx + len(key)
    while hi < len(nt) and nq.startswith(nt[idx:hi + 1]):
        hi += 1
    return hi - lo, nt[lo:hi]


def snippet(text, norm_piece):
    """把归一化片段映射回原文（含标点的原句）。"""
    nt = norm(text)
    i = nt.find(norm_piece[:8]) if len(norm_piece) >= 8 else nt.find(norm_piece)
    if i == -1:
        return ""
    # 粗略：在原文里滑窗，找归一化后覆盖 [i, i+len) 的区间
    target = norm_piece
    j = 0
    start = end = None
    for k, ch in enumerate(text):
        if norm(ch):
            j += 1
            if start is None and j == i + 1:
                start = k
            if start is not None and j == i + len(target):
                end = k + 1
                break
    if start is None or end is None:
        return ""
    return text[max(0, start - 25):min(len(text), end + 25)].replace("\n", " ")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for canon in ("amphoreus", "teyvat"):
        if only and canon != only:
            continue
        for ln in (PKG / canon / "lore" / "cards.jsonl").read_text(encoding="utf-8").splitlines():
            if not ln.strip():
                continue
            c = json.loads(ln)
            sids = [s["sourceId"] for s in c["sources"]]
            for e in c["evidence"]:
                for seg in re.split(r"…|\.\.\.", e):
                    seg = seg.strip()
                    if len(norm(seg)) < 6:
                        continue
                    if any(norm(seg) in norm(raw(s)) for s in sids):
                        continue
                    print(f"\n### {c['cardId']}  引 {sids}")
                    print(f"  卡片: {seg}")
                    found = False
                    for s in sids + [k for k in MAN if k not in sids]:
                        t = raw(s)
                        n, piece = best(seg, t)
                        if n >= 6:
                            print(f"  原文[{s}]: {snippet(t, piece)}")
                            found = True
                            if s in sids:
                                break
                    if not found:
                        print("  !! 全库都找不到近似片段")


if __name__ == "__main__":
    main()
