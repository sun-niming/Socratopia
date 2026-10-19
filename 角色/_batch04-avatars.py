# -*- coding: utf-8 -*-
"""按实际宽高比（优先正方形）重新指定 5 张头图，贴合 README「优先现有方形角色图」。"""
import json
import os
import struct

LIB = r"E:\huanjing\sogeladi\Socratopia\角色"
IDS = ["028", "029", "030", "031", "032"]


def size(p):
    with open(p, "rb") as f:
        b = f.read(32)
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", b[16:24])
            return w, h
        # JPEG
        f.seek(2)
        while True:
            m = f.read(1)
            while m and m != b"\xff":
                m = f.read(1)
            while m == b"\xff":
                m = f.read(1)
            if not m:
                return 0, 0
            if m[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                f.read(3)
                h, w = struct.unpack(">HH", f.read(4))
                return w, h
            seg = struct.unpack(">H", f.read(2))[0]
            f.seek(seg - 2, 1)


idx = json.load(open(os.path.join(LIB, "templates-index.json"), encoding="utf8"))
for t in idx["templates"]:
    if t["id"] not in IDS:
        continue
    d = os.path.join(LIB, t["personaPath"].split("/")[0], "图片")
    best, bs = None, -1
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            continue
        w, h = size(os.path.join(d, f))
        if w < 300:
            continue
        ratio = min(w, h) / max(w, h)          # 越接近 1 越方
        score = ratio * 100 - abs(w - 900) / 200  # 略偏好大图
        if score > bs:
            bs, best = score, f
        print(f"   {t['id']} {f} {w}x{h} 方形度{ratio:.2f}")
    if best:
        old = t["avatarSourcePath"].split("/")[-1]
        t["avatarSourcePath"] = f"{t['personaPath'].split('/')[0]}/图片/{best}"
        print(f"  -> {t['id']} {t['name']} 头图 {old} 改为 {best}\n")

json.dump(idx, open(os.path.join(LIB, "templates-index.json"), "w", encoding="utf8"),
          ensure_ascii=False, indent=2)
open(os.path.join(LIB, "templates-index.json"), "a", encoding="utf8").write("\n")
print("done")
