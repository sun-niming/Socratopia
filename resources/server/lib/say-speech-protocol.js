"use strict";

// 【内联朗读标注 v1】 — the say-specific surface of the `<say>` protocol.
// Spec: ../../SAY_INLINE_SPEECH_PROTOCOL_CHANGELOG.md
//
// Design: the model may annotate a formula with how it should be read aloud
//   $P(A|B)$<say>p 条件下 a 的概率</say>。
// The annotation is stripped from the display text and published as a `speech_hint` SSE event
// carrying the clean-text offset of the formula it anchors.  When it is missing or malformed the
// deterministic math-speech pipeline runs exactly as before.
//
// The scanner itself lives in ./voice-emotion-protocol.js (one pass, one offset system for both
// protocols); this module adds the prompt block, the opt-in parser class and the tracker factory.

const voice = require("./voice-emotion-protocol");

const SAY_PROTOCOL = voice.SAY_PROTOCOL;
const MAX_SAY_CHARS = voice.DEFAULT_MAX_SAY_CHARS;
const MAX_SAY_HINTS = voice.DEFAULT_MAX_SAY_HINTS;

const validateSaySpeech = voice.validateSaySpeech;

// The protocol is deliberately narrow: annotate only where the deterministic converter is likely
// to be clumsy, and stay silent everywhere else.  A chatty model costs tokens on every formula.
const SAY_PROMPT_LINES = {
  zh: [
    "【内联朗读标注 v1】",
    "你的回复会被实时朗读。系统能自动把数学公式转成朗读文本，但以下情况自动转换可能生硬：",
    "条件概率、集合运算、多义符号（如 |A|、f'、P(A|B)）、跨符号的自然读法。",
    "仅当公式属于上述情况时，在公式闭合符后、句末标点之前，紧跟一个标注：",
    "<say>该公式的自然中文读法</say>",
    "读法是纯文本：不写 LaTeX、不写字母之外的符号、不超过 50 字。",
    "没有把握就不标注；普通公式（四则运算、简单分式、上下标）一律不标注。",
    "标注不影响显示，不要解释标注的存在。",
    "硬性要求：标注的正前方必须紧邻一个以 $ 或 \\) 闭合的公式，二者之间不能有标点或换行。",
    "禁止标注普通文字、代码或术语；没有可锚定的公式时，整轮回复都不要写标注。",
    "对照——正确：$P(A|B)$<say>p 条件下 a 的概率</say>；错误：给普通文字标注（如“沿链查找。<say>从内向外沿链查找</say>”）。",
    "位置不符的标注会被系统直接删除，等于白写，务必自查。",
  ],
  "chinese-traditional": [
    "【內聯朗讀標注 v1】",
    "你的回覆會被即時朗讀。系統能自動把數學公式轉成朗讀文字，但以下情況自動轉換可能生硬：",
    "條件機率、集合運算、多義符號（如 |A|、f'、P(A|B)）、跨符號的自然讀法。",
    "僅當公式屬於上述情況時，在公式閉合符後、句末標點之前，緊跟一個標注：",
    "<say>該公式的自然中文讀法</say>",
    "讀法是純文字：不寫 LaTeX、不寫字母之外的符號、不超過 50 字。",
    "沒有把握就不標注；普通公式（四則運算、簡單分式、上下標）一律不標注。",
    "標注不影響顯示，不要解釋標注的存在。",
    "硬性要求：<say> 正前方必須緊鄰一個以 $ 或 \\) 閉合的公式，二者之間不能有標點或換行。",
    "禁止標注普通文字、程式碼或術語；沒有可錨定的公式時，整輪回覆都不要出現 <say>。",
    "對照——正確：$P(A|B)$<say>p 條件下 a 的機率</say>；錯誤：給普通文字標注（如「沿鏈查找。<say>從內向外沿鏈查找</say>」）。",
    "位置不符的標注會被系統直接刪除，等於白寫，務必自查。",
  ],
  english: [
    "【Inline speech annotation v1】",
    "Your reply is read aloud as it streams. Formulas are converted to speech automatically, but the conversion goes clumsy on:",
    "conditional probability, set operations, ambiguous symbols (|A|, f', P(A|B)), and anything read across symbols.",
    "Only for those, put an annotation right after the closing formula delimiter and before the sentence punctuation:",
    "<say>how that formula is naturally read aloud</say>",
    "The text is plain: no LaTeX, no symbols other than letters, at most 50 characters.",
    "If unsure, do not annotate; leave ordinary formulas (arithmetic, simple fractions, sub/superscripts) alone.",
    "Annotations never show up in the display, so do not explain them.",
    "Hard requirement: a <say> must sit immediately after a formula closed by $ or \\), with no punctuation or newline in between.",
    "Never annotate plain words, code, or terms; if there is no formula to anchor to, do not emit <say> anywhere in the reply.",
    "For contrast — correct: $P(A|B)$<say>p of a given b</say>; wrong: annotating plain words (e.g. \"…lookup.<say>search the chain outward</say>\").",
    "A misplaced annotation is deleted by the system, so writing one is wasted effort — double-check.",
  ],
};

// One-line reminder pushed as the final message of the request (after the trimmed history),
// where attention is strongest.  Kept deliberately short: it rides every voice turn.
const SAY_TRAILING_REMINDER = {
  zh: "[格式提醒] <say> 只能紧跟在 $...$ 公式闭合符之后；标注普通文字或放在句末都是非法的，会被删除。没有可标注的公式时，回复里不要出现 <say>。",
  "chinese-traditional": "[格式提醒] <say> 只能緊跟在 $...$ 公式閉合符之後；標注普通文字或放在句末都是非法的，會被刪除。沒有可標注的公式時，回覆裡不要出現 <say>。",
  english: "[Format reminder] A <say> is only legal immediately after a $...$ formula's closing delimiter; annotating plain words or placing it at the end of a sentence is invalid and will be deleted. If no formula qualifies, do not emit <say> at all.",
};

function buildSayTrailingReminder(options) {
  const o = options || {};
  const language = o.language === "english" || o.language === "chinese-traditional" ? o.language : "zh";
  return SAY_TRAILING_REMINDER[language];
}

// Runtime prompt fragment, appended to the classroom system prompt.  Injected independently of
// the voice/emotion block: the two protocols are orthogonal and must not be gated on each other.
function buildSayPromptBlock(options) {
  const o = options || {};
  const language = o.language === "english" || o.language === "chinese-traditional" ? o.language : "zh";
  return SAY_PROMPT_LINES[language].join("\n");
}

// Opt-in parser: identical to VoiceEmotionParser plus `<say>` recognition.
class SaySpeechParser extends voice.VoiceEmotionParser {
  constructor(options) {
    super({ ...(options || {}), sayProtocol: true });
  }
}

// Tracker with the same { text, events } contract as the voice tracker, whose event stream also
// carries `speech_hint`.  The route uses this so hints and voice segments share one scanner and
// therefore one offset base.
function createSayHintTracker(options) {
  return voice.createSegmentTracker({ ...(options || {}), sayProtocol: true });
}

module.exports = {
  SAY_PROTOCOL,
  MAX_SAY_CHARS,
  MAX_SAY_HINTS,
  validateSaySpeech,
  buildSayPromptBlock,
  buildSayTrailingReminder,
  SaySpeechParser,
  createSayHintTracker,
};
