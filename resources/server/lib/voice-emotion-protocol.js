"use strict";

// 【语音表达协议 v1】: the assistant may wrap speakable paragraphs in
//   <voice emotion="happy">…</voice>
// This module owns both halves of that contract:
//   * buildPromptBlock() — the trusted runtime prompt fragment (auto mode only)
//   * VoiceEmotionParser — an incremental parser that turns the tagged stream into clean
//     display text plus per-segment emotion, without waiting for the whole reply.
//
// The parser must be usable on a stream that is split at ANY character boundary, so every
// prefix of a control tag is buffered rather than emitted, and plain '<' in prose, code or
// comparisons stays literal.
//
// 【内联朗读标注 v1】 (`<say>…</say>`, opt-in via `sayProtocol`) rides the SAME single scan:
// emitting the clean text in two passes would give the two protocols different offset bases.
// Its state machine lives here so there is exactly one scanner; the say-specific surface
// (prompt block, SaySpeechParser) is ./say-speech-protocol.js.

const sealPolicy = require("./math-speech/seal-policy");

const DEFAULT_MAX_CANDIDATE = 128;
const TAG_NAME = "voice";

// Delimiters the model may close a math run with.  `$` and `$$` are tracked by _scanMathEnd
// (not by _updateProtection, whose protection semantics predate inline math).  The longest is
// two characters, which is what makes a one-character lookahead scan correct.
const MATH_MAX_DELIM = 2;
// Longest protection marker; a code fence needs two characters of lookahead to be identified.
const FENCE_MARK = "```";

const SAY_PROTOCOL = "say-protocol-v1";
const DEFAULT_MAX_SAY_CHARS = 120;
const DEFAULT_MAX_SAY_HINTS = 16;
const SAY_NAME = "say";
const SAY_OPEN = "<" + SAY_NAME;
const SAY_CLOSE = "</" + SAY_NAME;

const FORBIDDEN_TAG_TEXT = "厌恶、disgust、disgusted、angry、生气";

function escapeForPrompt(value) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
}

// Runtime prompt fragment.  Variables are supplied by the caller; user input must never be
// concatenated into this block.
function buildPromptBlock(options) {
  const o = options || {};
  const displayName = escapeForPrompt(o.displayName);
  const allowed = (o.allowedEmotionIds || ["default"]).map(escapeForPrompt).join(", ");
  const defaultDescription = escapeForPrompt(o.defaultEmotionDescription || "默认音色");
  const playful = (o.allowedEmotionIds || []).includes("playful_angry");
  // 赛飞儿 is the only catalog voice whose default reference is the 开心 clip (spec §4.2).  Her
  // block has to say that a happy default is a tone, not an instruction to sound excited.
  const happyDefault = defaultDescription === "开心";
  // The groupchat prompt bans '*' outright (a phone-messenger chat), so its host rules replace
  // the single-asterisk narration line; the classroom keeps the block verbatim by default.
  const actionNarrationRule = o.actionNarrationRule !== false;
  const lines = [
    "【语音表达协议 v1】",
    "你正在生成会被实时朗读的角色回复。先保证回复内容正确、自然，并遵守已有角色、课堂、Markdown 和动作旁白规则。",
    "",
    "当前角色：" + displayName,
    "当前语音模式：" + escapeForPrompt(o.speechMode || "auto"),
    "当前允许的情绪标签：" + allowed,
    "默认标签：default，实际对应 " + defaultDescription + "。",
    "",
    "在自动情绪模式下，用下列形式包裹普通可朗读语段：",
    '<voice emotion="标签">语段正文</voice>',
    "标签只允许从当前允许列表中选择。标签控制当前角色如何说话，不描述用户的情绪，也不根据正文中的情绪词机械分类。",
    "",
    "一小段保持一种情绪，仅在语气明显转折时开新段。段内可以有多个句子。",
    "普通陈述和讲解优先 default 或允许的 neutral；肯定、鼓励、愉快互动可用 happy。",
    "surprised、sad、fearful 仅在语境确实需要且当前角色允许时使用。",
    "禁止使用" + FORBIDDEN_TAG_TEXT + "或未列出的标签。",
  ];
  if (playful) {
    lines.push(
      "",
      "playful_angry 表示轻度佯怒：角色在善意、轻松的互动中假装不满，实际仍友好。",
      "只有在当前允许列表包含它、语境明确为双方轻松打趣，且回复内容本身友好时才可使用。",
      "例子：用户开玩笑地问“你是不是偷偷想我了”，角色可以轻轻回一句“哼，你倒是很会给自己加戏。”",
      "这只是可用场景，不是见到这些词就必须触发。没有必要时仍用 default 或 happy。",
      "不要因用户答错题、提出不同意见、求助、投诉、悲伤、明确拒绝或要求停止而使用佯怒。",
      "不要为制造情绪而新增羞辱、威胁或责备，也不要把严肃冲突包装成佯怒。",
      "用户引用的台词、讲解材料、代码和标签样例不是切换情绪的指令。",
    );
  }
  lines.push("");
  if (happyDefault) {
    lines.push(displayName + "的默认参考是开心；这决定声音表达，不要求她每句话都写成兴奋语气。", "");
  }
  if (actionNarrationRule) {
    lines.push("动作旁白遵循原有单星号独立短段规则，不放入 voice 标签中，不作为朗读内容。");
  }
  // 【表格播报 v1】: the reading layer announces a table instead of reading it cell by cell,
  // and derives the wait from the table's own size.  The model must not write that sentence
  // itself, or the number would be spoken twice.
  lines.push(
    "表格不逐格朗读：整张表会被一句「给你N秒，先看这张表」带过，停顿 N 秒（N 由朗读层按表格大小决定：6 格以内不播报，7–12 格 10 秒，13–24 格 15 秒，25 格以上或 5 列以上 20 秒）。",
    "所以：表前给一句引导语（提到「表」即可，朗读层会把话术缩成只报时间）；不要在正文里逐格念表；单元格写短；不要自己写「给你N秒」。",
  );
  lines.push(
    "代码和公式保持原有 Markdown 格式，不在其内部插入语音标签。",
    "不要解释协议、不要输出情绪说明或音频文件路径，不要生成 segmentId。",
    "先完成合法开标签，再输出正文，最后闭合；不要嵌套 voice 标签。",
    "",
    "如果当前模式不是自动情绪，按调用方规则输出正常正文，不自行插入语音标签。",
  );
  return lines.join("\n");
}

function lower(s) {
  return s.toLowerCase();
}

const OPEN_PREFIX = "<" + TAG_NAME;

// Longest suffix of `text` that is a proper prefix of `<voice`, i.e. how much must be held
// back in case the next chunk completes a control tag.
function pendingPrefixLength(text) {
  return pendingPrefixOf(text, OPEN_PREFIX);
}

function pendingPrefixOf(text, prefix) {
  const max = Math.min(text.length, prefix.length - 1);
  for (let len = max; len >= 1; len--) {
    if (prefix.startsWith(lower(text.slice(text.length - len)))) return len;
  }
  return 0;
}

// A trailing fragment that is already recognisably the start of a control tag: it is control
// syntax, never user-visible content, so end() drops it instead of printing it.
function isPartialVoiceTag(pending) {
  const p = lower(pending);
  if (!p.startsWith("<")) return false;
  if (["<voice", "</voice"].some((tag) => tag.startsWith(p))) return true;
  return /^<\/?\s*voice\b/.test(p);
}

function isPartialSayTag(pending) {
  const p = lower(pending);
  if (!p.startsWith("<")) return false;
  return [SAY_OPEN, SAY_CLOSE].some((tag) => tag.startsWith(p));
}

// The model-authored speech for one formula must be plain, readable prose: no LaTeX, no
// markdown structure, no second level of tags.  seal-policy already rejects `\cmd`, `$`, `{}`
// and `<tag>`; the extra `<` test is what keeps `</say>` from hiding inside the content.
function validateSaySpeech(speech, maxChars) {
  if (typeof speech !== "string") return { ok: false, reason: "type" };
  const text = speech.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > (maxChars || DEFAULT_MAX_SAY_CHARS)) return { ok: false, reason: "too_long" };
  if (text.includes("<")) return { ok: false, reason: "angle" };
  if (sealPolicy.containsForbiddenSpeech(text)) return { ok: false, reason: "forbidden" };
  return { ok: true, speech: text };
}

class VoiceEmotionParser {
  constructor(options) {
    const o = options || {};
    this.allowed = new Set((o.allowedEmotionIds || ["default"]).map(lower));
    this.defaultTag = o.defaultEmotion || "default";
    this.maxCandidate = Number.isFinite(o.maxCandidate) ? o.maxCandidate : DEFAULT_MAX_CANDIDATE;
    this.notices = [];
    this.buffer = "";
    this.emotion = null;        // active segment emotion, null until the first tag
    this.inSegment = false;     // inside an explicitly opened <voice> element
    this.fence = null;          // active code fence marker (``` or ~~~) while inside one
    this.inlineCode = false;
    this.mathDelim = null;      // $$ while inside a fenced-off math run
    this.finished = false;

    // 【内联朗读标注 v1】 — inert unless the caller opts in, so groupchat is untouched.
    this.sayEnabled = Boolean(o.sayProtocol);
    this.maxSayChars = Number.isFinite(o.maxSayChars) ? o.maxSayChars : DEFAULT_MAX_SAY_CHARS;
    this.maxSayHints = Number.isFinite(o.maxSayHints) ? o.maxSayHints : DEFAULT_MAX_SAY_HINTS;
    this.cleanOffset = 0;       // length of clean text emitted so far — the offset base
    this.pendingMathEnd = null; // clean offset just past the most recent math close
    this.mathOpen = null;       // open math delimiter, or null
    this.scanBuffer = "";       // every clean-text char emitted so far, scanned exactly once
    this.scanBase = 0;
    this.mathCursor = 0;
    this.protectCursor = 0;
    this.sayOpen = false;
    this.straySay = false;   // the open say had no math anchor: swallow content, publish nothing
    this.sayBuffer = "";
    this.saySwallowClose = false; // content overflowed: eat the next `</say>` instead of printing it
    this.saySwallowSkip = 0;     // spilled content that must still be printed before that close
    this.hintCount = 0;
    this.hintAnchors = new Set();
  }

  _notice(code, detail) {
    this.notices.push({ code, detail: detail == null ? null : String(detail).slice(0, 80) });
  }

  // Remember where the math run that just closed ended: that offset is the only legal anchor
  // for a `<say>` (§3.1).  Runs on emitted text only, so offsets are clean-text offsets.
  //
  // Unless `settled`, the final character is left unscanned: a delimiter may need it as its
  // second half ("1$" then "$\n"), and only a settled position (a following '<', or end of
  // stream) proves the text can no longer grow.  Returns how many characters were consumed.
  _scanMathEnd(text, baseOffset, from, settled) {
    let i = from;
    const limit = settled ? text.length : text.length - (MATH_MAX_DELIM - 1);
    while (i < limit) {
      if (this.mathOpen === null) {
        if (text[i] === "\\" && text[i - 1] !== "\\" && (text[i + 1] === "(" || text[i + 1] === "[")) {
          this.mathOpen = text[i + 1] === "(" ? "\\)" : "\\]";
          i += 2;
          continue;
        }
        if (text[i] === "$" && text[i - 1] !== "\\") {
          if (text[i + 1] === "$") { this.mathOpen = "$$"; i += 2; continue; }
          this.mathOpen = "$";
          i++;
          continue;
        }
        i++;
        continue;
      }
      const closer = this.mathOpen;
      if (text.startsWith(closer, i)) {
        this.mathOpen = null;
        this.pendingMathEnd = baseOffset + i + closer.length;
        i += closer.length;
        continue;
      }
      i++;
    }
    return i;
  }

  // A `<say>` may only follow whitespace after the math close (one newline is tolerated for a
  // block formula); anything else retires the anchor.
  _clearPendingMath(text, baseOffset) {
    if (this.pendingMathEnd === null) return;
    const start = this.pendingMathEnd - baseOffset;
    const tail = start <= 0 ? text : text.slice(start);
    if (!tail) return;
    if (/^[ \t\r\n]*$/.test(tail) && !/\n[^\n]*\n/.test(tail)) return;
    this.pendingMathEnd = null;
  }

  // Retire the previous anchor, scan what has not been scanned yet, then retire again: a run
  // may carry both the closing delimiter and the prose behind it ("$x$。" arrives as one run).
  // Every character is scanned exactly once — the whole clean text is kept so the scan cursor
  // never has to be rewound, whatever boundaries the chunks fall on.  Both scanners share it.
  _advanceMath() {
    this._clearPendingMath(this.scanBuffer, this.scanBase);
    this._settleMath(false);
    this._clearPendingMath(this.scanBuffer, this.scanBase);
  }

  // Emitted text is settled at a '<': nothing after it can complete a delimiter that starts
  // before it, so both cursors can move to the very end before the tag is examined.
  _flushScanHolds() {
    this._scanProtection(true);
    this._settleMath(true);
    this._clearPendingMath(this.scanBuffer, this.scanBase);
  }

  _settleMath(settled) {
    const from = this.mathCursor;
    if (from >= this.scanBuffer.length) return;
    this.mathCursor = this._scanMathEnd(this.scanBuffer, this.scanBase, from, settled);
  }

  // Content that outgrew the hard cap is dropped; the spill goes back into the stream so the
  // result is byte-identical however the stream was chunked (§5.1).
  _sayOverflow() {
    if (this.sayBuffer.length <= this.maxSayChars) return false;
    this._notice("say_overflow", this.sayBuffer.slice(0, 24));
    const spill = this.sayBuffer.slice(this.maxSayChars);
    this.sayBuffer = "";
    this.sayOpen = false;
    this.straySay = false;
    this.saySwallowClose = true;
    this.saySwallowSkip = spill.length;
    this.buffer = spill + this.buffer;
    return true;
  }

  _emitHint(speech, hints) {
    const verdict = validateSaySpeech(speech, this.maxSayChars);
    if (!verdict.ok) { this._notice("malformed_say", speech.slice(0, 24)); return; }
    const anchorEnd = this.pendingMathEnd;
    if (anchorEnd == null || anchorEnd > this.cleanOffset) {
      this._notice("orphan_hint", speech.slice(0, 24));
      return;
    }
    if (this.hintCount >= this.maxSayHints) {
      this._notice("say_hint_overflow", speech.slice(0, 24));
      return;
    }
    // A second annotation on the same formula is legal: it overwrites the earlier one.
    if (this.hintAnchors.has(anchorEnd)) this._notice("duplicate_hint", speech.slice(0, 24));
    this.hintAnchors.add(anchorEnd);
    this.hintCount++;
    hints.push({ anchorEnd, speech: verdict.speech });
  }

  _normalizeEmotion(raw) {
    const value = lower(String(raw || "").trim());
    if (!value) return { ok: false, reason: "empty" };
    if (value === "default") return { ok: true, emotion: this.defaultTag };
    if (!this.allowed.has(value)) return { ok: false, reason: "not_allowed" };
    return { ok: true, emotion: value };
  }

  // A partially received tag name that could still complete into a live control tag.
  _nameCandidate(partial) {
    return TAG_NAME.startsWith(partial) || (this.sayEnabled && SAY_NAME.startsWith(partial));
  }

  // Attempt to parse a complete control tag at position 0 of this.buffer.
  // Returns {consumed, emotion?, close?, malformed?} or null when more input is needed.
  _tryControl() {
    const buf = this.buffer;
    if (buf[0] !== "<") return null;
    if (buf.length < 2) return null;
    const isClose = buf[1] === "/";
    const nameStart = isClose ? 2 : 1;
    const need = nameStart + TAG_NAME.length;

    // <say> is only control syntax directly after a math close.  An unanchored <say> can never
    // publish a hint, so it is swallowed whole (tag + content) instead of leaking into the
    // display; the model still cannot inject it into prose because nothing is emitted.
    if (this.sayEnabled && !isClose && this.pendingMathEnd === null && !lower(buf).startsWith("</")) {
      const sayNeed = 1 + SAY_NAME.length;
      const sayHead = lower(buf.slice(1, Math.min(buf.length, sayNeed)));
      if (SAY_NAME.startsWith(sayHead) && !TAG_NAME.startsWith(sayHead)) {
        if (buf.length < sayNeed) return null;
        const after = buf[sayNeed];
        if (after === undefined) return null;
        if (after === ">") return { consumed: sayNeed + 1, straySayOpen: true };
        if (/[\s/>]/.test(after)) {
          const sayGt = buf.indexOf(">", sayNeed);
          if (sayGt < 0) return null;
          // `<say >` is accepted; an attribute form is not, and stays literal.
          if (buf.slice(sayNeed, sayGt).trim() === "") return { consumed: sayGt + 1, straySayOpen: true };
          return { consumed: 0, literal: true };
        }
      }
    }
    // A `</say>` that reaches here closed nothing (the sayOpen branch consumes real closes):
    // drop it rather than printing a stray close tag.
    if (this.sayEnabled && isClose) {
      const sayCloseNeed = 2 + SAY_NAME.length;
      const sayCloseHead = lower(buf.slice(2, Math.min(buf.length, sayCloseNeed)));
      if (SAY_NAME.startsWith(sayCloseHead) && !TAG_NAME.startsWith(sayCloseHead)) {
        if (buf.length < sayCloseNeed) return null;
        const after = buf[sayCloseNeed];
        if (after === undefined) return null;
        if (after === ">" || /[\s/>]/.test(after)) {
          const sayGt = buf.indexOf(">", sayCloseNeed);
          if (sayGt < 0) return null;
          if (buf.slice(sayCloseNeed, sayGt).trim() === "") {
            this._notice("stray_say_close", buf.slice(0, sayGt + 1));
            return { consumed: sayGt + 1, straySayClose: true };
          }
        }
      }
    }
    if (this.sayEnabled && !isClose && this.pendingMathEnd !== null && !lower(buf).startsWith("</")) {
      const sayNeed = 1 + SAY_NAME.length;
      const sayHead = lower(buf.slice(1, Math.min(buf.length, sayNeed)));
      if (SAY_NAME.startsWith(sayHead) && !TAG_NAME.startsWith(sayHead)) {
        if (buf.length < sayNeed) return null;
        const after = buf[sayNeed];
        if (after === undefined) return null;
        if (after === ">") return { consumed: sayNeed + 1, sayOpen: true };
        if (/[\s/>]/.test(after)) {
          const sayGt = buf.indexOf(">", sayNeed);
          if (sayGt < 0) return null;
          // `<say >` is accepted; an attribute form is not, and stays literal.
          if (buf.slice(sayNeed, sayGt).trim() === "") return { consumed: sayGt + 1, sayOpen: true };
          return { consumed: 0, literal: true };
        }
      }
    }

    if (buf.length < need) {
      // Still a candidate while it matches the expected prefix; otherwise it is ordinary text
      // such as `<3` or `<b>`, which must stay literal.
      if (this._nameCandidate(lower(buf.slice(nameStart)))) return null;
      return { consumed: 0, literal: true };
    }
    const name = lower(buf.slice(nameStart, need));
    if (name !== TAG_NAME) return { consumed: 0, literal: true };
    const afterName = buf[need];
    if (afterName !== undefined && !/[\s/>]/.test(afterName)) return { consumed: 0, literal: true };

    const gt = buf.indexOf(">", need);
    if (gt < 0) return null; // incomplete; the caller applies the candidate length cap
    // A tag that never closes within the cap is not a tag: hand it to the bounded recovery
    // rule instead of swallowing the prose that follows as if it were an attribute value.
    if (gt - need > this.maxCandidate) return null;
    const inner = buf.slice(need, gt);
    const raw = buf.slice(0, gt + 1);

    if (isClose) {
      if (inner.trim() !== "") { this._notice("malformed_close", raw); return { consumed: gt + 1, close: true, malformed: true }; }
      return { consumed: gt + 1, close: true };
    }
    const match = /^\s+emotion\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))\s*$/.exec(inner);
    if (!match) {
      this._notice("malformed_open", raw);
      return { consumed: gt + 1, malformed: true, emotion: this.defaultTag };
    }
    const value = match[2] != null ? match[2] : match[3] != null ? match[3] : match[4];
    const norm = this._normalizeEmotion(value);
    if (!norm.ok) {
      this._notice(norm.reason === "empty" ? "empty_emotion" : "unknown_emotion", value);
      return { consumed: gt + 1, malformed: true, emotion: this.defaultTag };
    }
    return { consumed: gt + 1, emotion: norm.emotion, open: true };
  }

  // Fenced code / inline code / `$$` protection.  Shares the append-only buffer and the cursor
  // discipline of _scanMathEnd: a delimiter split across two emits ("1$" then "$\n") must still
  // be seen, or the state machine sticks open and every later control tag is swallowed literal.
  _scanProtection(settled) {
    const text = this.scanBuffer;
    let i = this.protectCursor;
    const limit = settled ? text.length : text.length - (FENCE_MARK.length - 1);
    while (i < limit) {
      if (this.fence) {
        if (text.startsWith(this.fence, i)) { this.fence = null; i += 3; continue; }
        i++;
        continue;
      }
      if (this.mathDelim === "$$") {
        if (text.startsWith("$$", i)) { this.mathDelim = null; i += 2; continue; }
        i++;
        continue;
      }
      if (this.inlineCode) {
        if (text[i] === "`") { this.inlineCode = false; }
        i++;
        continue;
      }
      if (text.startsWith("```", i) || text.startsWith("~~~", i)) { this.fence = text.slice(i, i + 3); i += 3; continue; }
      if (text.startsWith("$$", i)) { this.mathDelim = "$$"; i += 2; continue; }
      if (text[i] === "`") { this.inlineCode = true; i++; continue; }
      i++;
    }
    this.protectCursor = i;
  }

  _protected() {
    return Boolean(this.fence || this.inlineCode || this.mathDelim);
  }

  // Feed one stream chunk.  Returns { text, segments, hints } where `text` is the clean display
  // text, `segments` is the list of [emotion, text] runs carried by this chunk and `hints` is
  // the say annotations closed by this chunk (already anchored in clean-text offsets).
  push(chunk) {
    if (this.finished) throw new Error("parser already finished");
    this.buffer += String(chunk == null ? "" : chunk);
    const segments = [];
    const hints = [];
    let clean = "";

    const emit = (text) => {
      if (!text) return;
      const emotion = this.emotion || this.defaultTag;
      const base = this.cleanOffset;
      clean += text;
      this.cleanOffset += text.length;
      const last = segments[segments.length - 1];
      if (last && last.emotion === emotion) last.text += text;
      else segments.push({ emotion, text });
      if (!this.scanBuffer.length) this.scanBase = base;
      this.scanBuffer += text;
      this._scanProtection(false);
      this._advanceMath();
    };

    while (this.buffer.length) {
      if (this.sayOpen) {
        // Content never reaches the display text, so prose inside an unclosed <say> would
        // vanish for good; the cap keeps the loss bounded and recovery deterministic.
        const close = this.buffer.indexOf(SAY_CLOSE);
        const avail = close < 0 ? this.buffer.length - pendingPrefixOf(this.buffer, SAY_CLOSE) : close;
        if (this.sayBuffer.length > this.maxSayChars) { this._sayOverflow(); continue; }
        if (this.sayBuffer.length + avail > this.maxSayChars) {
          const take = Math.min(avail, this.maxSayChars + 1 - this.sayBuffer.length);
          this.sayBuffer += this.buffer.slice(0, take);
          this.buffer = this.buffer.slice(take);
          continue;
        }
        if (avail > 0) {
          this.sayBuffer += this.buffer.slice(0, avail);
          this.buffer = this.buffer.slice(avail);
          if (close < 0) continue;
        } else if (close !== 0) break;
        const gt = this.buffer.indexOf(">");
        if (gt < 0) { if (this.buffer.length <= this.maxCandidate) break; }
        const inner = gt < 0 ? this.buffer.slice(SAY_CLOSE.length) : this.buffer.slice(SAY_CLOSE.length, gt);
        this.buffer = this.buffer.slice(gt < 0 ? this.buffer.length : gt + 1);
        const speech = this.sayBuffer;
        this.sayBuffer = "";
        this.sayOpen = false;
        if (this.straySay) {
          // No anchor, no hint: the whole annotation vanishes from the display (stray_say).
          this.straySay = false;
          this._notice("stray_say", speech.slice(0, 24));
          continue;
        }
        // The anchor survives a closed say, so a second annotation on the same formula is a
        // duplicate that overwrites rather than a stray.
        if (inner.trim() !== "" || speech.includes("<")) this._notice("malformed_say", speech.slice(0, 24));
        else this._emitHint(speech, hints);
        continue;
      }
      if (this.saySwallowClose) {
        // The overflow spill is ordinary text again; only the tag that was closing the say is
        // dropped, so an over-long annotation does not leave a stray `</say>` in the display.
        if (this.saySwallowSkip > 0) {
          const take = Math.min(this.saySwallowSkip, this.buffer.length);
          this.saySwallowSkip -= take;
          emit(this.buffer.slice(0, take));
          this.buffer = this.buffer.slice(take);
          continue;
        }
        const buf = this.buffer;
        if (buf.length < SAY_CLOSE.length && SAY_CLOSE.startsWith(buf)) break;
        if (buf.startsWith(SAY_CLOSE)) {
          const gt = buf.indexOf(">");
          if (gt < 0 && buf.length <= this.maxCandidate) break;
          const inner = gt < 0 ? buf.slice(SAY_CLOSE.length) : buf.slice(SAY_CLOSE.length, gt);
          if (inner.trim() === "") {
            this.buffer = buf.slice(gt < 0 ? buf.length : gt + 1);
            this.saySwallowClose = false;
            continue;
          }
        }
        this.saySwallowClose = false;
        continue;
      }
      const lt = this.buffer.indexOf("<");
      if (lt > 0) {
        const text = this.buffer.slice(0, lt);
        this.buffer = this.buffer.slice(lt);
        emit(text);
        continue;
      }
      if (lt < 0) {
        // Hold back a trailing partial tag prefix, flush the rest.
        const hold = this.sayEnabled
          ? Math.max(pendingPrefixLength(this.buffer), pendingPrefixOf(this.buffer, SAY_CLOSE))
          : pendingPrefixLength(this.buffer);
        const cut = this.buffer.length - hold;
        if (cut <= 0) break;
        emit(this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut);
        break;
      }
      // buffer starts with '<': no future text can extend the emitted prefix, so the scan cursors
      // can be settled before deciding whether this is control syntax or ordinary prose.
      this._flushScanHolds();
      if (this._protected()) {
        // Inside a fence / inline code / math every '<' is literal — but only until the text
        // behind it has closed the protection, so re-evaluate at each one instead of dumping
        // the rest of the buffer (which would swallow a tag that follows the closing marker).
        emit("<");
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const control = this._tryControl();
      if (control === null) {
        if (this.buffer.length > this.maxCandidate) {
          // Deterministic recovery: stop waiting.  Recognised control syntax is discarded (the
          // control part is never user-visible content); anything else is ordinary text.
          const oversize = this.buffer.slice(0, this.maxCandidate);
          this._notice("candidate_overflow", oversize.slice(0, 24));
          const drop = isPartialVoiceTag(oversize) || (this.sayEnabled && isPartialSayTag(oversize));
          this.buffer = this.buffer.slice(drop ? this.maxCandidate : 1);
          if (!drop) emit(oversize[0]);
          continue;
        }
        break; // wait for more input
      }
      if (control.literal) {
        const head = lower(this.buffer.slice(0, 8));
        // A `<say>` that is not anchored to a formula is prose the user must still see.
        this._notice(/^<say[\s/>]/.test(head) ? "stray_say" : "literal_lt", this.buffer.slice(0, 12));
        this.buffer = this.buffer.slice(1);
        emit("<");
        continue;
      }
      this.buffer = this.buffer.slice(control.consumed);
      if (control.sayOpen) {
        this.sayOpen = true;
        this.sayBuffer = "";
        continue;
      }
      if (control.straySayOpen) {
        this.straySay = true;
        this.sayOpen = true;
        this.sayBuffer = "";
        continue;
      }
      if (control.straySayClose) continue;
      if (control.close) {
        if (!this.inSegment) this._notice("close_without_open");
        this.inSegment = false;
        this.emotion = null;
        continue;
      }
      if (this.inSegment) this._notice("nested_open");
      this.inSegment = true;
      this.emotion = control.emotion || this.defaultTag;
    }
    return { text: clean, segments, hints };
  }

  // Flush at end of stream.  A trailing partial control tag is dropped (it is a control
  // fragment, never user-visible content); any other pending text is emitted literally.
  end() {
    this.finished = true;
    const segments = [];
    const hints = [];
    let clean = "";
    const emit = (text) => {
      if (!text) return;
      const emotion = this.emotion || this.defaultTag;
      const base = this.cleanOffset;
      clean += text;
      this.cleanOffset += text.length;
      const last = segments[segments.length - 1];
      if (last && last.emotion === emotion) last.text += text;
      else segments.push({ emotion, text });
      if (!this.scanBuffer.length) this.scanBase = base;
      this.scanBuffer += text;
    };
    let pending = this.buffer;
    this.buffer = "";
    this._flushScanHolds();
    // An unclosed <say> has no anchor to publish: the formula falls back to the deterministic
    // pipeline and the swallowed content is gone.  Safe direction — display is unaffected.
    if (this.sayOpen) {
      this._notice("unclosed_say", (this.sayBuffer + pending).slice(0, 24));
      this.sayBuffer = "";
      this.sayOpen = false;
      this.straySay = false;
      pending = "";
    } else if (this.saySwallowClose) {
      this.saySwallowClose = false;
      if (pending.startsWith(SAY_CLOSE)) pending = "";
    }
    if (pending) {
      if (isPartialVoiceTag(pending) || (this.sayEnabled && isPartialSayTag(pending))) {
        this._notice("unterminated_tag", pending.slice(0, 24));
      } else emit(pending);
    }
    if (this.inSegment) this._notice("unclosed_segment");
    const lastEmotion = this.emotion || this.defaultTag;
    this.inSegment = false;
    this.emotion = null;
    return { text: clean, segments, hints, lastEmotion, notices: this.notices.slice() };
  }
}

// Server-side segment bookkeeping: assigns stable ids and echoes the clean text range.
function createSegmentTracker(options) {
  const o = options || {};
  const messageId = o.messageId;
  const speakerId = o.speakerId || null;
  const voiceId = o.voiceId || null;
  const protocol = "voice-protocol-v1";
  const parser = new VoiceEmotionParser(o);
  let index = 0;
  let offset = 0;
  let open = null;
  let hintIndex = 0;

  // Hints ride the SAME event array as the segment events, which the route dispatches before
  // the text delta of the frame — that is what guarantees a hint is registered before the
  // sentence punctuation that releases its formula reaches the fragmenter (§5.2).
  const hintEvents = (hints) => (hints || []).map((h) => ({
    type: "speech_hint", messageId, hintId: messageId + ":h" + hintIndex++,
    anchorEnd: h.anchorEnd, speech: h.speech, protocol: SAY_PROTOCOL,
  }));

  return {
    parser,
    get protocol() { return protocol; },
    // -> [{type:"speech_segment_start"|"speech_segment_delta"|"speech_segment_end"|"speech_hint", ...}]
    push(chunk) {
      const events = [];
      const { text, segments, hints } = parser.push(chunk);
      for (const seg of segments) {
        if (!open || open.emotion !== seg.emotion) {
          if (open) events.push({ type: "speech_segment_end", messageId, segmentId: open.id, start: open.start, end: offset });
          open = { id: messageId + ":s" + index++, emotion: seg.emotion, start: offset };
          events.push({
            type: "speech_segment_start", messageId, segmentId: open.id, speakerId,
            voiceId, emotion: seg.emotion, protocol,
          });
        }
        events.push({
          type: "speech_segment_delta", messageId, segmentId: open.id, text: seg.text,
          start: offset, end: offset + seg.text.length,
        });
        offset += seg.text.length;
      }
      events.push(...hintEvents(hints));
      return { text, events };
    },
    end() {
      const { text, segments, hints, notices } = parser.end();
      const events = [];
      let clean = "";
      for (const seg of segments) {
        if (!open || open.emotion !== seg.emotion) {
          if (open) events.push({ type: "speech_segment_end", messageId, segmentId: open.id, start: open.start, end: offset });
          open = { id: messageId + ":s" + index++, emotion: seg.emotion, start: offset };
          events.push({
            type: "speech_segment_start", messageId, segmentId: open.id, speakerId,
            voiceId, emotion: seg.emotion, protocol,
          });
        }
        events.push({
          type: "speech_segment_delta", messageId, segmentId: open.id, text: seg.text,
          start: offset, end: offset + seg.text.length,
        });
        offset += seg.text.length;
        clean += seg.text;
      }
      if (open) events.push({ type: "speech_segment_end", messageId, segmentId: open.id, start: open.start, end: offset });
      open = null;
      events.push(...hintEvents(hints));
      return { text: clean === text ? text : clean, events, notices, totalLength: offset };
    },
  };
}

module.exports = {
  DEFAULT_MAX_CANDIDATE,
  DEFAULT_MAX_SAY_CHARS,
  DEFAULT_MAX_SAY_HINTS,
  SAY_PROTOCOL,
  buildPromptBlock,
  validateSaySpeech,
  VoiceEmotionParser,
  createSegmentTracker,
};
