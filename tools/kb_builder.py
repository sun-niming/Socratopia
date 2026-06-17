#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
kb_builder.py — Socratopia 离线知识库构建脚本(阶段 0 / PoC)

设计原则:
  * 完全独立运行,不触碰任何已编译 bundle(零运行时风险)。
  * 软编码:模型 / 端点 / key 全部从 resources/settings.json 的 active провайдер块动态读取,
    不在脚本里写死任何凭据或模型名。
  * 用强模型(settings.json 选中的 openai 块 = gpt-5.4)做"理解+结构化",
    把贵活儿一次性挪到离线;运行时只消费成品卡片。
  * 简体中文输出(其余语言暂不处理)。
  * 联网核实采用方案 A:仅当模型自评不确定时,给该卡片打 needs_verification 标记
    并写出 verify_query,供后续(人工 / WebSearch)核实回填。脚本本身不联网。

运行环境:miniconda `code` 环境 (E:/Py/MiniConda/envs/code) — 已含 pymupdf / requests。

用法示例:
  python tools/kb_builder.py --selftest
  python tools/kb_builder.py --start-page 60 --end-page 100 --dry-run
  python tools/kb_builder.py --start-page 60 --end-page 100 --max-chunks 3
  python tools/kb_builder.py --start-page 60 --end-page 100        # 全量该范围
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

# ----------------------------------------------------------------------------
# 路径解析(全部相对推导,不写死绝对路径之外的常量)
# ----------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
SETTINGS_PATH = os.path.join(REPO_ROOT, "resources", "settings.json")
SET_PATH = os.path.join(REPO_ROOT, "resources", "set.json")

# 默认目标教材:Linux.pdf (KUbm)。可用 --pdf / --out 覆盖。
DEFAULT_PDF = os.path.join(
    os.environ.get("APPDATA", ""),
    "socratopia", "project-data", "accounts", "local", "profiles",
    "uolmzgq8", "worlds", "KU", "textbooks", "KUbm", "Linux.pdf",
)


# ----------------------------------------------------------------------------
# 软编码配置:从 settings.json 读取当前激活 provider 的 baseUrl/apiKey/model
# 逻辑镜像运行时 mx():apiType 指定激活块;model 取 block.models[apiType]。
# ----------------------------------------------------------------------------
def load_llm_config(settings_path=SETTINGS_PATH, force_provider=None):
    with open(settings_path, "r", encoding="utf-8") as f:
        s = json.load(f)
    provider = force_provider or s.get("apiType") or s.get("Base_API") or "openai"
    block = s.get(provider)
    if not block:
        raise RuntimeError(f"settings.json 中找不到 provider 块: {provider!r}")
    base_url = (block.get("baseUrl") or "").rstrip("/")
    api_key = block.get("apiKey") or ""
    models = block.get("models") or {}
    # 与运行时一致:models[apiType];回退到块里任意一个
    model = models.get(provider) or (next(iter(models.values())) if models else None)
    if not (base_url and api_key and model):
        raise RuntimeError(
            f"provider {provider!r} 配置不完整: baseUrl={bool(base_url)} "
            f"apiKey={bool(api_key)} model={model!r}"
        )
    return {
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
    }


# ----------------------------------------------------------------------------
# 视觉模型配置:从 set.json 的 vision 块读取(多模态预处理图片密集页面)
# ----------------------------------------------------------------------------
def load_vision_config(set_path=SET_PATH):
    """加载 set.json 中的 vision 块。缺失则返回 None(跳过视觉预处理)。"""
    try:
        with open(set_path, "r", encoding="utf-8") as f:
            s = json.load(f)
        v = s.get("vision")
        if not v:
            return None
        base_url = (v.get("baseUrl") or "").rstrip("/")
        api_key = v.get("apiKey") or ""
        model = v.get("model") or ""
        if not (base_url and api_key and model):
            return None
        return {"base_url": base_url, "api_key": api_key, "model": model}
    except Exception:
        return None


# ----------------------------------------------------------------------------
# 视觉模型调用:OpenAI-compatible multimodal /chat/completions
# 将页面图片(base64 PNG)发送给多模态模型,返回转录文本
# ----------------------------------------------------------------------------
VISION_PROMPT = """你是一名教材内容转录专家。请将这张教材页面图片中的所有文字和内容精确转录为纯文本。
要求:
- 保留原文的段落结构和层次
- 代码/命令保持原格式
- 表格用文本形式表示
- 图表/流程图用简洁文字描述其内容和含义
- 公式用文本表示
- 忽略页眉、页脚、页码
- 只输出转录文本,不加任何额外说明或标记
- 只用简体中文输出(英文术语/代码保持原文)"""


def call_vision(vision_cfg, image_b64, page_num, timeout=120, retries=1):
    """调用多模态模型转录单页图片。返回转录文本;失败返回 None。"""
    url = vision_cfg["base_url"] + "/chat/completions"
    payload = {
        "model": vision_cfg["model"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VISION_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}",
                        },
                    },
                ],
            }
        ],
        "max_tokens": 4096,
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + vision_cfg["api_key"],
    }
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers,
                                         method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            return content.strip() if content else None
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            last_err = f"HTTP {e.code}: {detail}"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        if attempt < retries:
            time.sleep(2)
    print(f"    !! 视觉转录 p.{page_num} 失败: {last_err}")
    return None


# ----------------------------------------------------------------------------
# LLM 调用:普通 /chat/completions(与运行时核心一致),requests 不可用时退回 urllib
# ----------------------------------------------------------------------------
def call_llm(cfg, system, user, max_tokens=4096, json_mode=True, timeout=180,
             retries=2):
    url = cfg["base_url"] + "/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg["api_key"],
    }
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers,
                                         method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            last_err = f"HTTP {e.code}: {detail}"
        except Exception as e:  # noqa
            last_err = f"{type(e).__name__}: {e}"
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"LLM 调用失败({retries + 1} 次尝试): {last_err}")


# ----------------------------------------------------------------------------
# PDF 文本抽取(PyMuPDF / fitz) + 视觉预处理(图片密集页面)
# ----------------------------------------------------------------------------
# 阈值:单页 PyMuPDF 提取字符数 < SPARSE_TEXT_THRESHOLD 且页面非空白 → 疑似图片密集页
SPARSE_TEXT_THRESHOLD = 80


def render_page_to_b64(page):
    """将 fitz page 渲染为 PNG base64 字符串(分辨率 150 DPI,平衡质量与传输大小)。"""
    import base64
    pix = page.get_pixmap(dpi=150)
    png_bytes = pix.tobytes("png")
    return base64.b64encode(png_bytes).decode("ascii")


def extract_pages(pdf_path, start_page, end_page, vision_cfg=None):
    import fitz  # noqa
    doc = fitz.open(pdf_path)
    n = doc.page_count
    s = max(1, start_page)
    e = min(n, end_page)
    pages = []
    vision_used = 0
    for pn in range(s, e + 1):  # 1-based 书页号
        page = doc[pn - 1]
        text = page.get_text().strip()

        # 检测图片密集页:文本过少但页面有内容(图片/绘图)
        if vision_cfg and len(text) < SPARSE_TEXT_THRESHOLD:
            # 确认页面确实有可视内容(非空白页)
            has_images = len(page.get_images()) > 0
            has_drawings = len(page.get_drawings()) > 0
            if has_images or has_drawings:
                print(f"    [vision] p.{pn} 文本仅 {len(text)} 字,检测到图片,"
                      f"启用视觉转录...", flush=True)
                img_b64 = render_page_to_b64(page)
                transcribed = call_vision(vision_cfg, img_b64, pn)
                if transcribed:
                    text = transcribed
                    vision_used += 1
                elif not text:
                    # 视觉也失败且无文本,跳过此页
                    continue

        if text:
            pages.append({"page": pn, "text": text})
    doc.close()
    if vision_used:
        print(f"    [vision] 共 {vision_used} 页使用了视觉转录")
    return pages, n


def chunk_pages(pages, pages_per_chunk=4):
    """把连续页面按固定页数分块,保留页码区间用于 citation。"""
    chunks = []
    for i in range(0, len(pages), pages_per_chunk):
        group = pages[i:i + pages_per_chunk]
        start = group[0]["page"]
        end = group[-1]["page"]
        # 给每页加页码标记,方便模型在 citation 里引用具体页
        body = "\n\n".join(f"[第{p['page']}页]\n{p['text']}" for p in group)
        chunks.append({"start_page": start, "end_page": end, "text": body})
    return chunks


# ----------------------------------------------------------------------------
# 提示词(简体中文;要求结构化 JSON;不确定项自标 needs_verification + verify_query)
# ----------------------------------------------------------------------------
SYSTEM_PROMPT = """你是一名严谨的学科知识库构建专家,正在把一本教材的原文整理成"已核实知识卡片"。
这些卡片将来会被一个能力较弱、较廉价的大模型直接用于教学,因此卡片必须:
1. 准确——只依据给定原文,不臆造原文没有的内容;
2. 自足——弱模型不读原文也能照卡片把这个知识点讲清楚;
3. 可核实——凡是你对某条事实没有十足把握(可能是教材笔误、版本差异、记忆模糊),
   必须把该卡片的 needs_verification 置为 true,并在 verify_query 写出用于联网核实的检索式。

只用简体中文输出。"""

USER_TEMPLATE = """下面是教材《{title}》第 {start}-{end} 页的原文(含页码标记)。
请从中抽取**独立的知识点**,每个知识点产出一张卡片。忽略目录、页眉页脚、纯插图说明。

严格输出如下 JSON(不要加 markdown 代码块标记,不要任何额外文字):
{{
  "cards": [
    {{
      "title": "知识点名称(简短)",
      "definition": "准确、自足的定义/说明,弱模型据此即可讲解",
      "key_points": ["要点1", "要点2"],
      "examples": ["来自或贴合原文的示例,代码用文本表示"],
      "misconceptions": ["学习者常见的错误理解(如能从原文推断)"],
      "qa_pairs": [{{"q": "考察该点的问题", "a": "标准答案"}}],
      "difficulty": 1,
      "prerequisites": ["前置知识点名称"],
      "source_pages": [起始页, 结束页],
      "needs_verification": false,
      "verify_query": ""
    }}
  ]
}}

要求:
- difficulty 取 1-3(1 入门 / 2 进阶 / 3 综合)。
- source_pages 必须落在 {start}-{end} 范围内,指向该知识点实际出现的页。
- 对任何你不确定的事实,把该卡片 needs_verification 设为 true,并写出 verify_query。
- 没有内容可抽取时返回 {{"cards": []}}。

原文如下:
----------------
{body}
----------------"""


def slugify(title, idx):
    base = re.sub(r"[^\w\u4e00-\u9fff]+", "_", title).strip("_").lower()
    base = base[:40] if base else "concept"
    return f"{idx:03d}_{base}"


# ----------------------------------------------------------------------------
# 教学地图生成:把全部卡片按教学逻辑排成阶段性序列
# ----------------------------------------------------------------------------
TEACHING_MAP_SYSTEM = """你是课程设计专家。给定一组知识卡片(来自同一教材的连续页面),
请将它们按教学逻辑组织为 2-5 个阶段(phase),使得前序阶段是后续阶段的前置知识。

只用简体中文输出。"""

TEACHING_MAP_USER = """下面是从教材《{title}》第 {start}-{end} 页提取出的知识卡片列表(标题+难度):
{card_list}

请输出如下 JSON(不要 markdown 标记,不要额外文字):
{{
  "teaching_sequence": [
    {{
      "phase": 1,
      "label": "阶段名(简短)",
      "card_ids": ["卡片title1", "卡片title2"],
      "teach_goal": "本阶段教学目标(一句话)",
      "branches": ["可延伸方向(选填)"]
    }}
  ]
}}

规则:
- 每阶段包含 2-4 张卡片(若总数 ≤4 则仅 1 个阶段)。
- card_ids 使用卡片的 title 字段(精确匹配)。
- 所有卡片必须恰好出现一次,不遗漏不重复。
- 前序阶段的知识是后续阶段的前置条件。
- difficulty 低的卡片优先放前面。"""


def build_teaching_map(cfg, all_cards, args):
    """全部卡片生成后,调用 LLM 产出 teaching_map.json。"""
    if not all_cards:
        return None

    # 按 source_pages 分段:每个连续 window 生成一个 segment
    # 简化处理:按 _chunk_pages 分组为大段(每段 ≤ 20 张卡片)
    segments = []
    # 按页码排序
    sorted_cards = sorted(all_cards, key=lambda c: (c.get("source_pages") or [0])[0])

    # 分段:每 ~16 张卡片一组(或按 pages_per_chunk 边界)
    seg_size = 16
    for i in range(0, len(sorted_cards), seg_size):
        seg_cards = sorted_cards[i:i + seg_size]
        seg_start = min((c.get("source_pages") or c["_chunk_pages"])[0]
                        for c in seg_cards)
        seg_end = max((c.get("source_pages") or c["_chunk_pages"])[-1]
                      for c in seg_cards)
        segments.append({
            "cards": seg_cards,
            "start": seg_start,
            "end": seg_end,
        })

    results = []
    for si, seg in enumerate(segments, 1):
        card_list = "\n".join(
            f"- {c.get('title', '?')} (difficulty={c.get('difficulty', '?')}, "
            f"pages={c.get('source_pages', '?')})"
            for c in seg["cards"]
        )
        user = TEACHING_MAP_USER.format(
            title=args.title, start=seg["start"], end=seg["end"],
            card_list=card_list,
        )
        print(f"[map] 生成教学地图 段 {si}/{len(segments)} "
              f"(p.{seg['start']}-{seg['end']}, {len(seg['cards'])} 张) ...",
              flush=True)
        try:
            raw = call_llm(cfg, TEACHING_MAP_SYSTEM, user,
                           max_tokens=2048, json_mode=True)
            obj = json.loads(raw)
            seq = obj.get("teaching_sequence", [])
            results.append({
                "page_range": [seg["start"], seg["end"]],
                "sequence": seq,
            })
            print(f"    + {len(seq)} 个阶段")
        except Exception as e:
            print(f"    !! 教学地图段 {si} 失败: {e}")

    return {"segments": results} if results else None


def build(args):
    cfg = load_llm_config(force_provider=args.provider)
    print(f"[cfg] provider={cfg['provider']} model={cfg['model']} "
          f"base_url={cfg['base_url']}")

    vision_cfg = None
    if not args.no_vision:
        vision_cfg = load_vision_config()
        if vision_cfg:
            print(f"[vision] model={vision_cfg['model']} "
                  f"base_url={vision_cfg['base_url']}")
        else:
            print("[vision] 未配置或配置不完整,跳过图片页视觉转录")

    pages, total = extract_pages(args.pdf, args.start_page, args.end_page,
                                 vision_cfg=vision_cfg)
    print(f"[pdf] {os.path.basename(args.pdf)} 共 {total} 页;"
          f"抽到正文页 {len(pages)} 页 (范围 {args.start_page}-{args.end_page})")
    chunks = chunk_pages(pages, args.pages_per_chunk)
    if args.max_chunks:
        chunks = chunks[:args.max_chunks]
    print(f"[chunk] 切成 {len(chunks)} 块,每块 ~{args.pages_per_chunk} 页")

    if args.dry_run:
        for c in chunks:
            print(f"  - p.{c['start_page']}-{c['end_page']}  "
                  f"({len(c['text'])} 字)")
        print("[dry-run] 未调用 LLM,结束。")
        return

    out_dir = args.out
    cards_dir = os.path.join(out_dir, "cards")
    os.makedirs(cards_dir, exist_ok=True)

    all_cards = []
    idx = 0
    for ci, c in enumerate(chunks, 1):
        print(f"[llm] 处理块 {ci}/{len(chunks)} (p.{c['start_page']}-{c['end_page']}) ...",
              flush=True)
        user = USER_TEMPLATE.format(
            title=args.title, start=c["start_page"], end=c["end_page"],
            body=c["text"],
        )
        try:
            raw = call_llm(cfg, SYSTEM_PROMPT, user, max_tokens=args.max_tokens)
            obj = json.loads(raw)
            cards = obj.get("cards", [])
        except Exception as e:  # noqa
            print(f"    !! 块 {ci} 失败: {e}")
            continue
        for card in cards:
            idx += 1
            cid = slugify(card.get("title", ""), idx)
            card["concept_id"] = cid
            card.setdefault("needs_verification", False)
            card.setdefault("verify_query", "")
            card["_chunk_pages"] = [c["start_page"], c["end_page"]]
            with open(os.path.join(cards_dir, cid + ".json"), "w",
                      encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)
            all_cards.append(card)
        print(f"    + 本块产出 {len(cards)} 张卡片(累计 {len(all_cards)})")

    # 索引
    index = {
        "textbook": os.path.basename(args.pdf),
        "title": args.title,
        "lang": "zh",
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "model": cfg["model"],
        "page_range": [args.start_page, args.end_page],
        "card_count": len(all_cards),
        "needs_verification_count": sum(
            1 for c in all_cards if c.get("needs_verification")),
        "cards": [
            {
                "concept_id": c["concept_id"],
                "title": c.get("title", ""),
                "difficulty": c.get("difficulty"),
                "source_pages": c.get("source_pages"),
                "needs_verification": c.get("needs_verification", False),
            }
            for c in all_cards
        ],
    }
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"\n[done] 卡片 {len(all_cards)} 张 → {out_dir}")
    print(f"[done] 需联网核实: {index['needs_verification_count']} 张")
    nv = [c for c in all_cards if c.get("needs_verification")]
    if nv:
        print("[verify] 待核实卡片及检索式:")
        for c in nv:
            print(f"  - {c['concept_id']}: {c.get('verify_query', '')}")

    # 教学地图生成
    if not args.no_map:
        tmap = build_teaching_map(cfg, all_cards, args)
        if tmap:
            tmap_path = os.path.join(out_dir, "teaching_map.json")
            with open(tmap_path, "w", encoding="utf-8") as f:
                json.dump(tmap, f, ensure_ascii=False, indent=2)
            print(f"[done] 教学地图 → {tmap_path} "
                  f"({len(tmap['segments'])} 个段)")
        else:
            print("[map] 教学地图生成失败或无卡片,跳过")


def selftest(args):
    cfg = load_llm_config(force_provider=args.provider)
    print(f"[selftest] provider={cfg['provider']} model={cfg['model']} "
          f"base_url={cfg['base_url']}")
    try:
        out = call_llm(
            cfg,
            "你是测试助手,只输出 JSON。",
            '请输出 {"ok": true, "msg": "pong"}',
            max_tokens=50, json_mode=True, timeout=60, retries=1,
        )
        print("[selftest] LLM 响应:", out.strip()[:200])
        print("[selftest] OK — 端点可用")
    except Exception as e:  # noqa
        print("[selftest] 失败:", e)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="Socratopia 离线知识库构建(阶段0)")
    ap.add_argument("--pdf", default=DEFAULT_PDF, help="教材 PDF 路径")
    ap.add_argument("--title", default="Linux", help="教材标题(进提示词)")
    ap.add_argument("--out", default=None,
                    help="输出目录,默认 = PDF 同级 knowledge_base/")
    ap.add_argument("--start-page", type=int, default=60)
    ap.add_argument("--end-page", type=int, default=100)
    ap.add_argument("--pages-per-chunk", type=int, default=4)
    ap.add_argument("--max-chunks", type=int, default=0,
                    help="只处理前 N 块(0=全部),控制成本")
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--provider", default=None,
                    help="强制使用某 provider 块(默认按 settings.json apiType)")
    ap.add_argument("--no-vision", action="store_true",
                    help="禁用视觉预处理(即使 set.json 配置了 vision)")
    ap.add_argument("--no-map", action="store_true",
                    help="跳过教学地图生成(只产出卡片)")
    ap.add_argument("--dry-run", action="store_true",
                    help="只抽取并分块,不调用 LLM")
    ap.add_argument("--selftest", action="store_true",
                    help="只验证端点连通性")
    args = ap.parse_args()

    if args.out is None:
        args.out = os.path.join(os.path.dirname(args.pdf), "knowledge_base")

    if args.selftest:
        selftest(args)
        return
    build(args)


if __name__ == "__main__":
    main()
