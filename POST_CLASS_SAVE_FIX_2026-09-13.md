# 课后记录保存失败修复记录（2026-09-13）

记录生成时间：**2026-09-13T13:02:31+08:00**。所有时间使用北京时间（Asia/Shanghai，UTC+08:00）。

## 结果与使用方式

本次已修改当前安装目录 `E:\huanjing\sogeladi\Socratopia\resources\server\` 的编译产物，并完成本地模拟模型及真实 Next.js 接口验证。应用已启动时，Node/webpack 会缓存旧模块；需要正常退出并重新启动 Socratopia，再在原对话点击“完成课后记录”或相应重试入口。

没有代替用户重新生成真实课程记录，没有调用真实模型服务；运行中的应用未被强制关闭。无需重打包 app.asar。修改不会自动补写先前失败的记录。

## 问题证据

- 2026-09-13 01:28:20：日志记录课后报告仅 514 个字符，只含告别语与部分伙伴记忆，后续段落缺失；自动重试失败。
- 2026-09-13 01:29:54：报告 3724 个字符，含结束标记，但多个段落标记形如 `===\nDIARY_ENTRY\n===`，旧解析器只接受单行 `===DIARY_ENTRY===`，因此判定缺段落；自动重试仍失败。
- 异常发生在解析校验、课后事务写入之前；旧统一错误提示为“课后记录保存失败，请重试”。
- 当时模型返回使用 `deepseek-flash`。514 字符报告为何提前结束缺少上游 finish_reason 证据，不能断言一定耗尽额度；本次补上明确截断的检测和恢复路径。

## 实现细节

1. **段落解析**：仅对 FAREWELL、PAL_MOMENTS_MD、PROGRESS_MD、DIARY_ENTRY、RELATION_MD、COMPANION_NOTE、END 七个已知标记兼容行内空格、两行/三行标记、CRLF/CR 换行。普通 Markdown 分隔线和正文保持原样。
2. **完整性**：六个段落标记都必须存在，只有 RELATION_MD 允许空内容；要求最后的 END 且之后无额外内容；拒绝重复段落。既有寄语去除旁白和长度限制继续使用。该规则与原生成提示词要求一致。
3. **受限重试**：将模型调用与解析放入同一错误处理范围。仅 END_CLASS_INVALID_REPORT 或 END_CLASS_OUTPUT_TRUNCATED 触发一次重试；重试追加明确格式修复指令，要求从原课程历史重新生成完整、简洁的六段报告。保留原系统指令和原课程消息，不把不完整报告当成新学习内容，也不增加无限重试。
4. **课后专用生成参数**：8192 输出 tokens，`thinking=false`；后者由既有 DeepSeek 适配逻辑应用。其他用途保留原默认参数。此调整是输出预算和完整报告的处理，不代表已证明首次短响应的具体上游成因。
5. **输出截断检测**：共享 module 64092 的六处定义同步增加只作用于 end-class 的检查：HTTP 成功且 finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED。HTTP 错误不会被误判为截断；未提供 finish_reason 的旧服务仍由内容完整性校验把关。
6. **诊断日志**：失败记录尝试次数、错误码、响应字符数和缺失段落；截断记录模型、输出额度、completion_tokens 和 finish_reason；去掉旧的失败报告正文尾部输出。API 的 error 事件增加错误码，现有界面错误提示保持兼容。
7. **共享代码范围**：两份共享 chunk 与四份内联 route 均已同步；动态消费者 lesson-summary 和 groupchat 继续加载 chunk 1576，无需重复定义。未向 chunk 添加 require("fs")。
8. **测试工具修正**：集成测试发现 MockLLM 用 `body += Buffer` 收请求时会在中文 UTF-8 字符跨包处分段解码，造成随机乱码和错误的内容差异。为测试请求增加 setEncoding('utf8')；生产网络实现不受此项影响。回执重放本来就会同步进度元数据，所以测试对叙事记录校验字节不变，对进度校验页码语义不变。

## 文件与修改时间

下表列出本次所有 11 个修改或新增 JavaScript 文件。时间为最终文件修改时间；每次运行时代码修改的前后 SHA-256 以及审计时间见 changes.jsonl。

| 文件 | 最终修改时间（UTC+08:00） | 具体修改 |
|---|---|---|
| `resources/server/.next/server/app/api/chat/route.js` | 2026-09-13 12:54:16+08:00 | 兼容三行/两行/空格/CRLF 段落标记；要求六段及 END 完整；拒绝重复段落；格式/截断错误最多重试一次，追加修复指令；课后请求 8192 tokens、thinking=false；结构化错误码；移除失败正文尾部日志。 |
| `resources/server/.next/server/chunks/4092.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/chunks/1576.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/app/api/concept-summary/route.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/app/api/flashcard/route.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/app/api/companion/reconcile-persona/route.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/app/api/custom-companions/merge-persona/route.js` | 2026-09-13 12:54:16+08:00 | 同步 module 64092：仅 purpose=end-class 且 HTTP 成功、finish_reason=length 时抛出 END_CLASS_OUTPUT_TRUNCATED；记录模型/额度/完成 token 数，不记录报告正文。 |
| `resources/server/.next/server/app/api/chat/chat-end-class-integration-smoke-test.js` | 2026-09-13 12:59:28+08:00 | 新增六组真实 HTTP 接口回归场景，检查落盘、失败不写入、重试参数、原始课程消息不变及回执重放。 |
| `resources/server/smoke-test-utils.js` | 2026-09-13 12:59:27+08:00 | 仅测试工具：为模拟模型的 HTTP 请求设置 UTF-8 流式解码，避免中文字符跨 TCP 数据块时损坏。 |
| `resources/server/.next/server/app/api/chat/end-class-parser-smoke-test.js` | 2026-09-13 12:52:10+08:00 | 新增实际 bundle 解析函数的 20 项离线回归测试，仅使用虚构报告。 |
| `resources/server/lib/end-class-llm-smoke-test.js` | 2026-09-13 12:56:23+08:00 | 新增输出截断、普通调用兼容、课后输出预算/思考选项，以及六处定义同步检查。 |

## 验证

验证汇总时间：2026-09-13T13:02:31+08:00。使用已有 Windows Node `/mnt/e/huanjing/node.js/node.exe`，版本 v25.9.0。所有数据均为测试夹具，集成测试创建临时服务、模拟模型及临时文件目录，结束后清理。

| 验证结果 | 证据文件（位于 outputs/post-class-save-fix-20260913） |
|---|---|
| 实际解析器：20 项通过 | `parser-test.log` |
| LLM 截断/调用选项/兼容与定义同步：通过 | `llm-test.log` |
| 真实 HTTP 接口与临时目录文件写入：原有场景及新增 6 场景通过 | `integration-test.log` |
| 共享 LLM 取消、超时和普通成功请求：通过 | `call-llm-fence-test.log` |
| 课后事务、清理、候选记忆消费、身份校验和回执重放：通过 | `continuity-test.log` |
| 11 个修改/新增 JavaScript 文件 node --check：通过 | `syntax-check.log` |

新增六个真实接口场景：拆行标记一次成功；上游截断后重试成功；连续截断失败且零写入；缺 END 后重试成功；连续缺 END 失败且零写入；连续缺日记段落失败且零写入。成功场景还验证持久化页码与回执重放不重复追加叙事记录。

测试创建在修复之前：旧解析器在三行标记用例失败，旧 LLM 在明确 finish_reason=length 用例未按预期拒绝；修复后通过。测试首次扩展也发现了进度元数据重同步的既有行为及模拟服务器 UTF-8 解码问题，已调整语义断言并修正测试工具。

## 审计、补丁和回退资料

- 工作区已有大量未提交修改。项目说明中的 sibling 副本 `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` 不存在，因此在 2026-09-13T12:52:12+08:00 保存本次涉及文件的即时基线，不以 Git HEAD 覆盖当前内容。
- `outputs/post-class-save-fix-20260913/changes.jsonl`：带 UTC+08:00 时间、前后哈希及验证结果的逐行日志。
- `outputs/post-class-save-fix-20260913/baseline.json` 与 `before/`：修改前文件清单及原字节备份。
- `outputs/post-class-save-fix-20260913/changes.patch`：只包含本次相对即时基线的差异，保留此前用户改动。
- `outputs/post-class-save-fix-20260913/patch-manifest.json`：交付文件大小和 SHA-256；标明原样附带的 Next.js manifests。
- `outputs/post-class-save-fix-20260913/post-class-save-fix.zip`：修改后的代码、测试、本文档和三份原样路由 manifests。没有增加路由，路由 manifests 内容无需变更，但按项目要求一并附带。
- 回退时正常退出应用，按 before/ 的对应相对路径恢复本次修改的原文件；仅在确认文件没有后续修改时使用整文件备份。若已有后续改动，应依据 changes.patch 合并回退，避免覆盖后续工作。

本次没有修改 settings.json、set.json、真实课程/聊天数据、Electron main/preload 或 app.asar，没有提交 Git。当前证据证明本地修复场景通过；真实供应商仍可能返回不完整报告，此时会在一次针对性重试后保留旧记录并返回错误，而不会伪报保存成功。
