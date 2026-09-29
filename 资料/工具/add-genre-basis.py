#!/usr/bin/env python3
"""给翁法罗斯阅读物索引的体裁列补「依据」列（md + json 同步）。

依据取值只有两个：正文（读过后判定）、题名（仅凭书名判定）。
「正文」的两种来源都必须可重建：
  1. 归档正文：S020-S034、S219-S251 的 title 字段与本索引词条精确相交（47 条）；
  2. 临时抽查：tmp/genre-spotcheck/*.html 的文件名精确相交（17 条），清单写入前言，
     因为 tmp/ 被 gitignore，抽查件本身不进库。
其余为「题名」。

注意：索引树不受 .gitattributes 的 -text 约束，本脚本沿用 write_text 默认
（newline=None -> os.linesep，Windows 为 CRLF），与既有文件保持一致。
"""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 资料/工具/ 下多一级
DIR = ROOT / "资料" / "索引" / "储备书目"
MD = DIR / "翁法罗斯阅读物索引.md"
JS = DIR / "翁法罗斯阅读物索引.json"
SPOT = ROOT / "tmp" / "genre-spotcheck"

data = json.loads(JS.read_text(encoding="utf-8"))
assert len(data) == 153, len(data)
names = [e["name"] for e in data]

# --- 依据判定：只从可重建的证据推出，不手填 ---
archived = set()
for sid in list(range(20, 35)) + list(range(219, 252)):
    for f in (ROOT / "资料" / "可用文本" / "崩坏·星穹铁道").glob("*/*S%03d_*.md" % sid):
        m = re.search(r'^title: "(.+?)"', f.read_text(encoding="utf-8")[:800], re.M)
        if m:
            archived.add(m.group(1))
spot = {p.stem for p in SPOT.glob("*.html")}

basis = {}
for n in names:
    if n in archived:
        basis[n] = "正文"
    elif n in spot:
        basis[n] = "正文"
    else:
        basis[n] = "题名"

from_body = [n for n in names if basis[n] == "正文"]
assert not (spot - set(names)), f"抽查件未匹配索引词条: {spot - set(names)}"
assert len(from_body) == len([n for n in names if n in archived]) + len(spot), "依据计数不自洽"
spot_list = [n for n in names if n in spot]  # 保持索引顺序，供前言列出

# --- md 重写：加「依据」列 ---
md = MD.read_text(encoding="utf-8")
out, matched = [], 0
lead_re = re.compile(r"^\| \[(.+?)\]\((https://[^)]+)\) \| (.+?) \|$")
by_name = {e["name"]: e for e in data}
GENRES = set(e["genre"] for e in data)
walk = iter(data)  # json 是唯一真源；md 只提供行序与 URL
for ln in md.splitlines():
    m = lead_re.match(ln)
    if m:
        title, url, _rest = m.groups()
        e = next(walk)
        # md 与 json 顺序一致，否则下面的断言会立刻炸，而不是错位写出去。
        assert e["name"] == title, f"顺序错位: md={title} json={e['name']}"
        assert e["version"] and e["version"] not in GENRES, f"版本位被体裁污染: {title}"
        out.append(f"| [{title}]({url}) | {e['genre']} | {e['basis']} | {e['version']} |")
        matched += 1
    elif ln.strip() == "| 阅读物 | 体裁 | 收录版本 |":
        out.append("| 阅读物 | 体裁 | 依据 | 收录版本 |")
    elif ln.strip() == "|---|---|---|":
        out.append("|---|---|---|---|")
    else:
        out.append(ln)
assert matched == 153, matched
assert not (set(by_name) - {n for n in re.findall(r"^\| \[(.+?)\]", "\n".join(out), re.M)})

note = """## 体裁列与依据列说明（2026-09-29 补）

- 星铁 BWIKI 书架页**没有**体裁字段（信息框仅卷数／所属／实装版本／相关角色／相关任务／获取方式，wiki 分类只有「书籍」）。体裁列是整理方判定，非 wiki 原数据；提瓦特索引的体裁列才是 wiki 原字段。**两边性质不同，不要当作同等可信度比对。**
- 「依据」列只有两个取值：`正文`（读过正文后判定）、`题名`（仅凭书名判定）。当前为 **正文 64 条、题名 89 条**。
- `正文` 的两种来源都可重建，不依赖手填：

  | 来源 | 条数 | 重建方式 |
  |---|---:|---|
  | 归档正文 | 47 | `S020`–`S034`、`S219`–`S251` 的 `title` 字段与本索引词条精确相交 |
  | 临时抽查 | 17 | `tmp/genre-spotcheck/*.html` 的文件名精确相交（`tmp/` 被 gitignore，故清单如下） |

- **17 条临时抽查词条**（其体裁已读过正文，但证据件不入库，如需复核要重新取页）：

  %s

- 用法约束：沿用 2026-09-25 决定，卡片**不按体裁分级**，`reliability`／`claimType` 只依据来源本身。体裁列仅为把书名暗示的文体判断显式化，防止写作时套用未记录的隐含规则；不是可信度标签。
- 写卡引用时，`依据=题名` 的 89 条若需采信，应先读正文复核并把该条升为 `正文`。
- 生成方式（两个脚本都在 `资料/工具/`，随资料入库）：`资料/工具/apply-genre-column.py` 写体裁列与 json 的 `genre`；`资料/工具/add-genre-basis.py` 写「依据」列、json 的 `basis` 与本前言。两者**各自幂等、与先后顺序无关**（前言只由后者持有），可安全重跑。校验器按「末字段不得是体裁值」判定版本位，防止列错位静默写坏。

""" % ("\n  ".join("- " + n for n in spot_list))

start = next(i for i, l in enumerate(out) if l.startswith("## 体裁列"))
end = next(i for i in range(start, len(out)) if out[i].startswith("| 阅读物 |"))
out[start:end] = note.rstrip().splitlines() + [""]

MD.write_text("\n".join(out) + "\n", encoding="utf-8")

# --- json 同步 ---
for e in data:
    e["basis"] = basis[e["name"]]
JS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("rows:", matched, "正文:", len(from_body), "题名:", 153 - len(from_body))
print("正文来源拆分: 归档", len([n for n in names if n in archived]), "抽查", len(spot_list))
print("体裁分布:", dict(Counter(e["genre"] for e in data)))
