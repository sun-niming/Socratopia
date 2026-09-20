#!/usr/bin/env python3
"""Download the curated BWIKI sources and build purpose/origin indexes."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html as html_stdlib
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

from lxml import etree, html


ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "资料"
INDEX_ROOT = DATA_ROOT / "索引"
MANIFEST_PATH = INDEX_ROOT / "精选来源.json"
DOWNLOAD_MANIFEST_PATH = INDEX_ROOT / "下载清单.json"


def safe_name(value: str) -> str:
    value = value.replace("/", "／").replace("\\", "＼")
    value = re.sub(r'[:*?"<>|]', "_", value)
    value = re.sub(r"\s+", " ", value).strip().rstrip(".")
    return value or "未命名"


def game_name(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    if path.startswith("/sr/"):
        return "崩坏·星穹铁道"
    if path.startswith("/ys/"):
        return "原神"
    return "其他"


def material_type(title: str) -> str:
    if "语音" in title:
        return "人物语音"
    if "NPC" in title:
        return "NPC目录"
    if title in {"角色图鉴", "角色一览"}:
        return "人物目录"
    if "编年史" in title:
        return "历史编年"
    if "任务" in title:
        return "剧情任务"
    if title.endswith("／资料") or title == "钟离":
        return "人物档案"
    if title in {"翁法罗斯世界设定", "北陆图书馆"}:
        return "世界设定"
    return "世界文献"


def source_nature(title: str) -> str:
    kind = material_type(title)
    if kind in {"世界设定", "历史编年"}:
        return "社区设定汇总（引用游戏内容）"
    if kind in {"人物目录", "NPC目录"}:
        return "社区资料索引"
    if kind in {"人物档案", "人物语音"}:
        return "游戏内人物资料（BWIKI镜像）"
    if kind == "剧情任务":
        return "游戏内任务资料（BWIKI整理／镜像）"
    if title == "翁法罗斯剧情阅读物":
        return "游戏内文献聚合（BWIKI整理）"
    return "游戏内文献（BWIKI镜像）"


def local_paths(source: dict) -> tuple[Path, Path]:
    game = game_name(source["url"])
    kind = material_type(source["title"])
    stem = safe_name(f'{source["id"]}_{source["title"]}')
    raw = DATA_ROOT / "来源原文" / "BWIKI" / game / kind / f"{stem}.html"
    text = DATA_ROOT / "可用文本" / game / kind / f"{stem}.md"
    return raw, text


def fetch_one(source: dict, refresh: bool) -> dict:
    raw_path, text_path = local_paths(source)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.parent.mkdir(parents=True, exist_ok=True)

    if raw_path.exists() and raw_path.stat().st_size > 1000 and not refresh:
        return {
            **source,
            "game": game_name(source["url"]),
            "materialType": material_type(source["title"]),
            "sourceNature": source_nature(source["title"]),
            "rawPath": raw_path.relative_to(DATA_ROOT).as_posix(),
            "textPath": text_path.relative_to(DATA_ROOT).as_posix(),
            "curlExit": 0,
            "httpStatus": 200,
            "effectiveUrl": source["url"],
            "retrievedAt": dt.datetime.fromtimestamp(
                raw_path.stat().st_mtime, dt.timezone.utc
            ).isoformat(),
            "cached": True,
        }

    encoded_url = urllib.parse.quote(source["url"], safe=":/?=&%")
    command = [
        "curl.exe",
        "-L",
        "-sS",
        "--max-time",
        "60",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "--retry-all-errors",
        "-A",
        "Mozilla/5.0 (Socratopia local research archive)",
        "-w",
        "\n%{http_code}\t%{url_effective}",
        encoded_url,
    ]
    result = subprocess.run(command, capture_output=True)
    payload = result.stdout
    marker = payload.rfind(b"\n")
    body = payload[:marker] if marker >= 0 else b""
    metadata = payload[marker + 1 :].decode("utf-8", "replace") if marker >= 0 else ""
    status_text, _, effective_url = metadata.partition("\t")
    try:
        http_status = int(status_text)
    except ValueError:
        http_status = 0
    success = result.returncode == 0 and http_status == 200 and len(body) > 1000
    if success:
        raw_path.write_bytes(body)
    return {
        **source,
        "game": game_name(source["url"]),
        "materialType": material_type(source["title"]),
        "sourceNature": source_nature(source["title"]),
        "rawPath": raw_path.relative_to(DATA_ROOT).as_posix(),
        "textPath": text_path.relative_to(DATA_ROOT).as_posix(),
        "curlExit": result.returncode,
        "httpStatus": http_status,
        "effectiveUrl": effective_url or source["url"],
        "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "cached": False,
        "error": result.stderr.decode("utf-8", "replace").strip() if not success else "",
    }


def normalized_visible_text(raw: bytes) -> tuple[str, str]:
    document = html.fromstring(raw)
    page_title = ""
    title_nodes = document.xpath("//title")
    if title_nodes:
        page_title = " ".join(title_nodes[0].itertext()).strip()
    roots = document.xpath(
        './/*[contains(concat(" ", normalize-space(@class), " "), " mw-parser-output ")]'
    )
    content = roots[0] if roots else document

    for node in content.xpath(".//script|.//style|.//noscript|.//button|.//form"):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)
    for node in content.xpath(
        './/*[contains(concat(" ", normalize-space(@class), " "), " mw-editsection ")]'
        '|.//*[contains(concat(" ", normalize-space(@class), " "), " noprint ")]'
    ):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)

    for heading in content.xpath(".//h1|.//h2|.//h3|.//h4|.//h5|.//h6"):
        level = int(heading.tag[1])
        heading.text = "\n" + ("#" * min(level + 1, 6)) + " " + (heading.text or "")
    for item in content.xpath(".//li"):
        item.text = "\n- " + (item.text or "")
    for br in content.xpath(".//br"):
        br.tail = "\n" + (br.tail or "")
    block_tags = {
        "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt",
        "figcaption", "figure", "footer", "header", "hr", "main", "nav", "ol",
        "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead",
        "tr", "ul",
    }
    for node in content.iterdescendants():
        if isinstance(node.tag, str) and node.tag.lower() in block_tags:
            node.tail = "\n" + (node.tail or "")

    value = html_stdlib.unescape(content.text_content()).replace("\xa0", " ")
    lines = []
    blank = False
    for original_line in value.splitlines():
        line = re.sub(r"[ \t\r\f\v]+", " ", original_line).strip()
        if line:
            lines.append(line)
            blank = False
        elif not blank and lines:
            lines.append("")
            blank = True
    text = "\n".join(lines).strip() + "\n"
    return page_title, text


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def write_text_copy(entry: dict) -> dict:
    raw_path = DATA_ROOT / entry["rawPath"]
    text_path = DATA_ROOT / entry["textPath"]
    if not raw_path.exists():
        return {**entry, "downloaded": False, "rawBytes": 0, "textBytes": 0}
    raw = raw_path.read_bytes()
    try:
        page_title, body = normalized_visible_text(raw)
    except (etree.ParserError, ValueError) as exc:
        return {
            **entry,
            "downloaded": False,
            "rawBytes": len(raw),
            "textBytes": 0,
            "error": f"HTML extraction failed: {exc}",
        }
    sha256 = hashlib.sha256(raw).hexdigest()
    frontmatter = [
        "---",
        f'source_id: {yaml_string(entry["id"])}',
        f'title: {yaml_string(entry["title"])}',
        f'page_title: {yaml_string(page_title)}',
        f'world: {yaml_string(entry["world"])}',
        f'game: {yaml_string(entry["game"])}',
        f'material_type: {yaml_string(entry["materialType"])}',
        f'source_origin: {yaml_string("BWIKI")}',
        f'source_nature: {yaml_string(entry["sourceNature"])}',
        f'source_url: {yaml_string(entry["url"])}',
        f'effective_url: {yaml_string(entry["effectiveUrl"])}',
        f'retrieved_at: {yaml_string(entry["retrievedAt"])}',
        f'raw_sha256: {yaml_string(sha256)}',
        f'template_targets: {json.dumps(entry["templateTargets"], ensure_ascii=False)}',
        f'fields: {json.dumps(entry["fields"], ensure_ascii=False)}',
        f'priority: {yaml_string(entry["priority"])}',
        f'verification: {yaml_string(entry["verification"])}',
        "---",
        "",
        f'# {entry["title"]}',
        "",
        f'> 来源：[{entry["url"]}]({entry["url"]})  ',
        f'> 本地原始网页：[{Path(entry["rawPath"]).name}](../../../来源原文/BWIKI/{entry["game"]}/{entry["materialType"]}/{Path(entry["rawPath"]).name})  ',
        f'> 抓取状态：{entry["verification"]}。自动提取文本不替代对原网页的复核。',
        "",
        "## 网页正文（自动提取）",
        "",
    ]
    text_path.write_text("\n".join(frontmatter) + body, encoding="utf-8")
    return {
        **entry,
        "downloaded": True,
        "rawBytes": len(raw),
        "textBytes": text_path.stat().st_size,
        "rawSha256": sha256,
        "textSha256": hashlib.sha256(text_path.read_bytes()).hexdigest(),
    }


def relative_link(from_file: Path, target: Path) -> str:
    import os

    return Path(os.path.relpath(target, from_file.parent)).as_posix()


def index_table(index_path: Path, entries: list[dict]) -> str:
    lines = [
        "| ID | 世界 | 类型 | 来历 | 资料 | 模板用途 | 优先级 | 核验状态 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for entry in entries:
        text_path = DATA_ROOT / entry["textPath"]
        raw_path = DATA_ROOT / entry["rawPath"]
        if entry.get("downloaded"):
            local = f'[{entry["title"]}]({relative_link(index_path, text_path)})'
            raw = f'[HTML]({relative_link(index_path, raw_path)})'
        else:
            local = entry["title"]
            raw = "下载失败"
        origin = f'[原址]({entry["url"]})'
        lines.append(
            f'| {entry["id"]} | {entry["world"]} | {entry["materialType"]} | {entry["sourceNature"]} | '
            f'{local} · {raw} · {origin} | {"、".join(entry["templateTargets"])} | '
            f'{entry["priority"]} | {entry["verification"]} |'
        )
    return "\n".join(lines)


def build_indexes(entries: list[dict]) -> None:
    INDEX_ROOT.mkdir(parents=True, exist_ok=True)
    downloaded = [entry for entry in entries if entry.get("downloaded")]
    failed = [entry for entry in entries if not entry.get("downloaded")]
    total_raw = sum(entry.get("rawBytes", 0) for entry in downloaded)
    total_text = sum(entry.get("textBytes", 0) for entry in downloaded)

    total_path = INDEX_ROOT / "总索引.md"
    total_intro = f"""# 资料总索引

生成时间：{dt.datetime.now(dt.timezone.utc).isoformat()}  
精选来源：{len(entries)}；下载成功：{len(downloaded)}；失败：{len(failed)}。  
原始 HTML：{total_raw:,} 字节；可用 Markdown：{total_text:,} 字节。

同一来源只保存一份原文和一份提取文本。表格同时提供本地 Markdown、本地 HTML 和原始网页地址。

"""
    total_path.write_text(total_intro + index_table(total_path, entries) + "\n", encoding="utf-8")

    for target, filename, description in [
        ("人物", "人物模板索引.md", "用于身份、性格、动机、语气、关系、经历及知识边界。"),
        ("世界", "世界模板索引.md", "用于规则、地理、历史、组织、社会生活及开场状态。"),
    ]:
        path = INDEX_ROOT / filename
        chosen = [entry for entry in entries if target in entry["templateTargets"]]
        path.write_text(
            f"# {filename.removesuffix('.md')}\n\n{description}\n\n"
            + index_table(path, chosen)
            + "\n",
            encoding="utf-8",
        )

    origin_path = INDEX_ROOT / "来源索引-BWIKI.md"
    lines = [
        "# 来源索引：BWIKI",
        "",
        "全部精选资料来自 `wiki.biligame.com`。以下按游戏和资料类型归档；原始网址仍逐条保留。",
        "",
    ]
    for game in sorted({entry["game"] for entry in entries}):
        lines.extend([f"## {game}", ""])
        for kind in sorted({entry["materialType"] for entry in entries if entry["game"] == game}):
            lines.extend([f"### {kind}", ""])
            subset = [
                entry for entry in entries
                if entry["game"] == game and entry["materialType"] == kind
            ]
            lines.append(index_table(origin_path, subset))
            lines.append("")
    origin_path.write_text("\n".join(lines), encoding="utf-8")

    DOWNLOAD_MANIFEST_PATH.write_text(
        json.dumps(
            {
                "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "downloadedCount": len(downloaded),
                "failedCount": len(failed),
                "rawBytes": total_raw,
                "textBytes": total_text,
                "sources": entries,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="download existing pages again")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if not MANIFEST_PATH.exists():
        print(f"Missing manifest: {MANIFEST_PATH}", file=sys.stderr)
        return 2
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    sources = manifest["sources"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        fetched = list(pool.map(lambda item: fetch_one(item, args.refresh), sources))
    entries = [write_text_copy(entry) for entry in fetched]
    entries.sort(key=lambda entry: entry["id"])
    build_indexes(entries)
    failed = [entry for entry in entries if not entry.get("downloaded")]
    for entry in entries:
        state = "OK" if entry.get("downloaded") else "FAIL"
        print(f'{state} {entry["id"]} {entry["title"]} HTTP {entry["httpStatus"]}')
    if failed:
        print(f"{len(failed)} download(s) failed", file=sys.stderr)
        return 1
    print(f"Archived {len(entries)} sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
