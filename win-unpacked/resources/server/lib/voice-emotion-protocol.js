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

const DEFAULT_MAX_CANDIDATE = 128;
const TAG_NAME = "voice";

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
  const max = Math.min(text.length, OPEN_PREFIX.length - 1);
  for (let len = max; len >= 1; len--) {
    if (OPEN_PREFIX.startsWith(lower(text.slice(text.length - len)))) return len;
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
    this.mathDelim = null;      // $$ or $ while inside math
    this.finished = false;
  }

  _notice(code, detail) {
    this.notices.push({ code, detail: detail == null ? null : String(detail).slice(0, 80) });
  }

  _normalizeEmotion(raw) {
    const value = lower(String(raw || "").trim());
    if (!value) return { ok: false, reason: "empty" };
    if (value === "default") return { ok: true, emotion: this.defaultTag };
    if (!this.allowed.has(value)) return { ok: false, reason: "not_allowed" };
    return { ok: true, emotion: value };
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

    if (buf.length < need) {
      // Still a candidate while it matches the expected prefix; otherwise it is ordinary text
      // such as `<3` or `<b>`, which must stay literal.
      if (TAG_NAME.startsWith(lower(buf.slice(nameStart)))) return null;
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

  _updateProtection(text) {
    // Track code fences / inline code / math so tags inside them stay literal.
    let i = 0;
    while (i < text.length) {
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
  }

  _protected() {
    return Boolean(this.fence || this.inlineCode || this.mathDelim);
  }

  // Feed one stream chunk.  Returns { text, segments } where `text` is the clean display text
  // and `segments` is the list of [emotion, text] runs carried by this chunk.
  push(chunk) {
    if (this.finished) throw new Error("parser already finished");
    this.buffer += String(chunk == null ? "" : chunk);
    const segments = [];
    let clean = "";

    const emit = (text) => {
      if (!text) return;
      const emotion = this.emotion || this.defaultTag;
      clean += text;
      const last = segments[segments.length - 1];
      if (last && last.emotion === emotion) last.text += text;
      else segments.push({ emotion, text });
      this._updateProtection(text);
    };

    while (this.buffer.length) {
      if (this._protected()) {
        const chunkText = this.buffer;
        this.buffer = "";
        emit(chunkText);
        break;
      }
      const lt = this.buffer.indexOf("<");
      if (lt < 0) {
        // Hold back a trailing partial tag prefix, flush the rest.
        const hold = pendingPrefixLength(this.buffer);
        const cut = this.buffer.length - hold;
        if (cut <= 0) break;
        emit(this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut);
        break;
      }
      if (lt > 0) {
        const text = this.buffer.slice(0, lt);
        this.buffer = this.buffer.slice(lt);
        emit(text);
        continue;
      }
      // buffer starts with '<'
      const control = this._tryControl();
      if (control === null) {
        if (this.buffer.length > this.maxCandidate) {
          // Deterministic recovery: stop waiting.  Recognised control syntax is discarded (the
          // control part is never user-visible content); anything else is ordinary text.
          const oversize = this.buffer.slice(0, this.maxCandidate);
          this._notice("candidate_overflow", oversize.slice(0, 24));
          const drop = isPartialVoiceTag(oversize);
          this.buffer = this.buffer.slice(drop ? this.maxCandidate : 1);
          if (!drop) emit(oversize[0]);
          continue;
        }
        break; // wait for more input
      }
      if (control.literal) {
        this._notice("literal_lt", this.buffer.slice(0, 12));
        const literal = this.buffer[0];
        this.buffer = this.buffer.slice(1);
        emit(literal);
        continue;
      }
      this.buffer = this.buffer.slice(control.consumed);
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
    return { text: clean, segments };
  }

  // Flush at end of stream.  A trailing partial control tag is dropped (it is a control
  // fragment, never user-visible content); any other pending text is emitted literally.
  end() {
    this.finished = true;
    const segments = [];
    let clean = "";
    const emit = (text) => {
      if (!text) return;
      const emotion = this.emotion || this.defaultTag;
      clean += text;
      const last = segments[segments.length - 1];
      if (last && last.emotion === emotion) last.text += text;
      else segments.push({ emotion, text });
    };
    const pending = this.buffer;
    this.buffer = "";
    if (pending) {
      if (isPartialVoiceTag(pending)) this._notice("unterminated_tag", pending.slice(0, 24));
      else emit(pending);
    }
    if (this.inSegment) this._notice("unclosed_segment");
    const lastEmotion = this.emotion || this.defaultTag;
    this.inSegment = false;
    this.emotion = null;
    return { text: clean, segments, lastEmotion, notices: this.notices.slice() };
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

  return {
    parser,
    get protocol() { return protocol; },
    // -> [{type:"speech_segment_start"|"speech_segment_delta"|"speech_segment_end", ...}]
    push(chunk) {
      const events = [];
      const { text, segments } = parser.push(chunk);
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
      return { text, events };
    },
    end() {
      const { text, segments, notices } = parser.end();
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
      return { text: clean === text ? text : clean, events, notices, totalLength: offset };
    },
  };
}

module.exports = {
  DEFAULT_MAX_CANDIDATE,
  buildPromptBlock,
  VoiceEmotionParser,
  createSegmentTracker,
};
