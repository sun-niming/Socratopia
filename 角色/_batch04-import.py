# -*- coding: utf-8 -*-
"""把批次04的 5 个龙族角色写入账户自定义伙伴数据（对齐既有存储规格）。"""
import json
import os
import random
import shutil
import string
from datetime import datetime, timezone

from PIL import Image

LIB = r"E:\huanjing\sogeladi\Socratopia\角色"
ACC = r"C:\Users\ASUS\AppData\Roaming\socratopia\project-data\accounts\local\profiles"
CC = os.path.join(ACC, "custom_companions")
BATCH = ["028-绘梨衣", "029-诺诺", "030-夏弥", "031-零", "032-帕西"]

# 1) 备份
ts = datetime.now().strftime("%Y%m%d-%H%M%S")
bak = os.path.join(ACC, "template-backups", f"batch04-longzu-{ts}")
shutil.copytree(CC, bak)
print("备份 ->", bak, f"({len(os.listdir(bak))} 个文件)")

idx_path = os.path.join(CC, "index.json")
idx = json.load(open(idx_path, encoding="utf-8-sig"))
names = {e["name"] for e in idx}
lib = json.load(open(os.path.join(LIB, "templates-index.json"), encoding="utf-8"))


def new_id():
    return "ct_" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))


now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
added = []

for dirname in BATCH:
    t = next(x for x in lib["templates"] if x["personaPath"].startswith(dirname + "/"))
    if t["name"] in names:
        print("  已存在，跳过", t["name"]); continue
    src_md = os.path.join(LIB, dirname, "模板.md")
    src_img = os.path.join(LIB, t["avatarSourcePath"].replace("/", os.sep))

    # md：逐字复制，LF，保留末尾换行
    body = open(src_md, encoding="utf-8").read().replace("\r\n", "\n")
    if not body.endswith("\n"):
        body += "\n"
    if "- **年龄**：" in body:
        raise SystemExit(f"{t['name']} 模板含年龄行，与批次约定（省略）不符")

    cid = new_id()
    while os.path.exists(os.path.join(CC, cid + ".md")):
        cid = new_id()
    with open(os.path.join(CC, cid + ".md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(body)

    # 头像：居中裁剪成方形再缩到 400x400 RGB PNG
    im = Image.open(src_img)
    im = im.convert("RGB")
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((400, 400), Image.LANCZOS)
    im.save(os.path.join(CC, cid + ".png"), "PNG")

    idx.append({
        "name": t["name"], "gender": t["gender"], "age": None,
        "identity": t["identity"], "personality": t["personality"],
        "id": cid, "createdAt": now, "updatedAt": now,
    })
    added.append((t["name"], cid, len(body), len(im.getbands())))

with open(idx_path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(idx, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n写入 {len(added)} 个：")
for n, c, L, _ in added:
    print(f"  {n:4s} {c}  人设{L}字符")
print("索引条目:", len(idx))
