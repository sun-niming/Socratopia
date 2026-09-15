# 数学语音核心迭代记录

## 2026-09-08：服务端转换接口与运行包迁移

### 本轮目标

- 暂时放弃 Markdown 混合文本解析，接口接收已经分段的文本/公式数据。
- 增加服务端数学语音转换接口。
- 将数学语音核心同步到 Windows 运行包目录。
- 建立上下文参数传递边界，并记录可控风险与后续整改项。

### 已完成

1. 新增 `POST /api/math-speech`。
2. 接口支持批量 `segments`，其中 `text` 原样返回，`math` 调用 `lib/math-speech` 核心转换。
3. 增加输入数量、文本长度、LaTeX 长度校验，并返回结构化错误。
4. 数学段支持 `locale`、`style`、`context`，转换结果保留 `ok/mode/speech/diagnostics`。
5. 数学核心及 API 路由迁移至 `Socratopia/win-unpacked/resources/server`。

### 明确暂缓

- Markdown 混合文本扫描、代码块/转义美元符处理。
- 前端 bundle 接入及 TTS 播放链路改造。
- 旁白判定与 TTS 跳过策略。
- 语音缓存、重新生成和端到端播放验收。

### 上下文连携约束

- 上下文只通过单个数学 segment 的 `context` 传入，不跨请求隐式累积。
- 语义判定失败时必须保留结构化结果与诊断信息，不得静默改写为另一语义。
- 前端接入前，调用方应保存请求与响应的版本字段，便于回放和回归。

### 风险处置顺序

1. 先保证服务端接口和运行包文件存在且版本一致。
2. 再通过实际体验收集上下文误判样本。
3. 最后才评估 Markdown 适配器和前端 TTS 集成。

### 版本留痕

- 核心验收基线：`outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md`（PASS）。
- 本轮变更范围：API 路由、Next 路由清单、数学核心运行包副本、本文档。

## 2026-09-08：Luna Markdown 混合文本数学语音适配层

### 本轮目标

- 在现有 `POST /api/math-speech` 分段接口之上增加 Markdown 混合文本扫描。
- 让公式转换失败、接口失败、超时和取消都只影响对应的数学语音准备，不丢失后续普通台词。
- 将适配器接入现有流式和旧版 TTS 调用点，并同步 Windows 运行包中的对应 bundle。

### 变更文件及目的

- `resources/server/.next/static/chunks/math-speech-adapter.js`：新增无第三方依赖的 Markdown 扫描、segment 编排、上下文截取、批量 API 调用、版本字段和局部回退实现。
- `win-unpacked/resources/server/.next/static/chunks/math-speech-adapter.js`：运行包中的适配器副本。
- `resources/server/.next/static/chunks/4137-131d0676e3b5bef7.js`：内嵌同版本适配器，并让经典 TTS 入口把当前播放会话的取消信号传给适配器。
- `win-unpacked/resources/server/.next/static/chunks/4137-131d0676e3b5bef7.js`：运行包中的 voice bundle 副本。
- `resources/server/.next/static/chunks/app/` 中的 5 个语音页面 bundle：在流式句子和旧版段落调用前等待 Markdown 适配，保持原有播放串行、取消和缓存提交路径。
- `win-unpacked/resources/server/.next/static/chunks/app/` 中对应的 6 个运行包页面 bundle：同步同一适配调用和准备链；其中 `page-f5f46cb5daf146a1.js` 保留旧版 `synthesize` 调用形态。
- `PROJECT_MATH_SPEECH_DOSSIER/06-iteration-log.md`：记录本轮范围、示例、限制和验收状态。

### 适配器输入/输出示例

输入：

```text
前文 $x$，转义 \\$not-math$。
```js
const price = $5;
```
链接 [公式](https://example.test/$url$)。
$$a+b$$ 与 \\(c\\)。
公式 $\\unknowncommand$ 失败时仍继续播放后文。
```

解析后保持原文顺序，受保护内容和公式分别形成数据 segment，示意如下：

```json
[
  {"type":"text","value":"前文 ","tts":true},
  {"type":"math","latex":"x","source":"$x$","delimiter":"$","tts":true},
  {"type":"text","protected":"fenced-code","tts":false},
  {"type":"text","protected":"markdown-link","tts":true,"ttsValue":"公式"},
  {"type":"math","latex":"a+b","source":"$$a+b$$","block":true},
  {"type":"math","latex":"c","source":"\\\\(c\\\\)"},
  {"type":"math","latex":"\\\\unknowncommand","fallback":true,"fallbackReason":"conversion-failed","speech":"unknowncommand"}
]
```

批量请求为单次 `/api/math-speech` 调用；每个数学 segment 传递 `locale`、`style` 和当前句/段落 `context`。如果某个数学结果为 `ok:false` 或 `speech` 为空，该 segment 使用安全回退文本，普通文本和后续 segment 继续保留。取消时适配器返回可识别的 `cancelled` 结构，TTS 调用返回空播放文本并沿用既有停止路径。

### 已知限制和未解决风险

- 适配器只识别 `$...$`、`$$...$$`、`\\(...\\)` 和 `\\[...\\]`；不完整标记保留为普通文本，不猜测未知 LaTeX 语义。
- fenced code、行内代码、Markdown 链接、图片和 URL 在公式扫描前受保护；链接只朗读标签，图片和 fenced code 跳过 TTS。
- 旁白跳过使用固定白名单标签和整行 stage direction；不确定的文本保留 TTS，仍需 Terra 用真实对话样本确认边界。
- 单次输入、公式、text segment、segment 数量、请求体和请求超时均有上限；超限按 segment 使用可读回退文本。
- 本轮没有修改数学核心规则、词典、`/api/math-speech` 请求/响应字段含义、TTS 服务协议、音频缓存协议或敏感配置文件。
- 尚未进行真实 Electron 播放、网络故障现场、零音频、缓存一致性和多语言体验验收。

### 本轮检查记录与交付状态

- 已执行编辑文件的 `node --check`，以及现有 voice stream、replay、backpressure、error-containment、classic-stream contract 和数学路由/core smoke 命令。
- 已执行无持久化 fixture 的适配行为检查，覆盖代码块、行内代码、链接、图片、转义 `$`、块公式、`\\(...\\)`、失败回退、请求失败、上下文传递、长度上限和取消。
- 本轮不将本地检查结果标记为产品验收通过；测试状态：**待 Terra 独立验收**。
