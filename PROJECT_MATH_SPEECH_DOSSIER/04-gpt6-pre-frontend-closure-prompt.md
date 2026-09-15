# GPT-6 接入前收尾任务书

下面的提示词可以直接交给 GPT-6。它的职责是完成前端接入前的架构收尾、证据审计和测试计划，不是立即修改前端。

```text
角色：
你是 GPT-6，负责 Socratopia 数学公式语义化核心的“接入前收尾审计”。
你不是本轮前端实现者，也不是重新生成语音功能的实现者。

工作目录：
E:\huanjing\sogeladi\socratopia

目标：
在不修改前端、不接入 TTS、不修改音频缓存、不实现重新生成语音的前提下，确认数学语义核心是否具备进入前端接入评审的条件；补齐所有接入前必须明确的架构合同、风险记录、发布存在性检查方案和端到端测试方案。

必须先读：
1. AGENTS.md
2. MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md
3. MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md
4. PROJECT_MATH_SPEECH_DOSSIER/01-project-background-and-prospects.md
5. PROJECT_MATH_SPEECH_DOSSIER/02-materials-and-evidence-index.md
6. PROJECT_MATH_SPEECH_DOSSIER/03-technical-state-risk-and-gates.md
7. outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md
8. outputs/math-speech-round3-fix/baseline/**
9. resources/server/lib/math-speech/README.md
10. resources/server/lib/math-speech/ 下全部实现、测试和语料

严格禁止：
- 修改 resources/server/.next/static/chunks/**
- 修改 resources/server/.next/server/app/page.js 或 app/index*
- 修改 win-unpacked/resources/server/.next/static/chunks/**
- 修改 4137 voice bundle
- 修改 React 页面
- 修改 TTS 播放队列
- 修改 IndexedDB 音频缓存
- 实现重新生成语音
- 修改 main.js、preload.js、app.asar 或 _asar_extracted/**
- 修改 resources/settings.json、resources/set.json
- 修改历史验收报告、历史失败证据或 Terra 报告
- 提交 Git commit
- 使用 git reset --hard、git checkout 或 git clean

允许：
- 只读检查文件、Git、哈希、manifest、测试和依赖；
- 在 outputs/math-speech-pre-frontend-closure/ 创建审计报告、方案、契约和测试计划；
- 在系统临时目录创建独立黑盒和 E2E 模拟测试；
- 运行非破坏性测试；
- 构造不写入产品语料的风险探测。

必须回答的核心问题：

一、核心边界
- 第四轮 PASS 证明了什么？没有证明什么？
- 哪些能力属于数学核心，哪些能力必须由未来接入层负责？
- 自然语言 symbolFacts 抽取是否仍可能误报/漏报？请用未写入语料的反例验证，并将其标为高风险而不是擅自修复。
- P/Pr 之外的 E、Var、Cov、SD、det、log 等是否存在相同的固定词典覆盖风险？只审计，不修改。

二、混合文本接入
- 当前 prepareForSpeech 的公式、代码块、转义美元、链接、旁白清理顺序是什么？
- 是否存在公式先替换、代码后保护的风险？
- 设计一个不修改前端的混合文本契约：代码和转义符先保护，完整句子再识别公式，公式失败只局部跳过。
- 明确行内公式、块级公式、多公式句、不完整流式公式和纯符号片段的行为。

三、服务端 API
- 评估并推荐“本地 Next API 批量解析”还是“浏览器 bundle 复制核心”。
- 优先推荐避免规则双份和 bundle 漂移的方案，但必须列出代价。
- 给出请求/响应 JSON、限长、错误代码、认证、本地回环、超时和批量策略。
- 说明如何保持核心结果 sealed、确定、可缓存。

四、发布存在性
- 当前 release-runtime-manifest 是否覆盖 lib/math-speech？
- 如果不覆盖，设计只读存在性 smoke 或构建阶段检查；不得运行会覆盖产品 manifest 的命令。
- 说明 resources/server、win-unpacked、app.asar、%APPDATA% 运行目录之间的真实加载关系。

五、E2E 验收
- 设计真实 Markdown → 公式核心 → 正文合并 → 旁白过滤 → TTS 顺序的 E2E fixture。
- 覆盖：普通公式、复杂 detailed、structural 歧义、skip 公式、多个公式、代码块、转义美元、旁白、零音频、取消、重试、缓存。
- 区分核心单测、服务端 API 测试和前端 E2E，不要把它们混成一个 PASS。
- 为每类测试指定退出码、失败条件和证据文件。

六、语义冻结与未来消歧
- 证明已播放/已缓存语义不会被未来上下文回写。
- 设计未来“重新生成语音”需要的版本字段，但本轮不得实现按钮或缓存迁移。
- 明确首次播放、后续重播和显式重新生成的版本一致性问题。

七、范围和风险
- 使用 outputs/math-speech-round3-fix/baseline/ 做当前基线。
- 验证禁止路径、敏感文件和核心文件哈希是否稳定。
- 不要回滚第二轮历史前端差异；只记录其历史连续性。
- 将风险分为 S0/S1/S2/S3，并说明哪些阻断前端准入。

必须运行的只读验证：
- 数学核心全部现有 test/audit 脚本；
- math-speech-benchmark.js 正常和 --all-skip；
- 全部核心 JS 的 node --check 和 Acorn；
- TTS 自包含回归；
- release-runtime-manifest-smoke-test.js；
- Git 状态和哈希复核。

不得把 live TTS、真实 LLM 或浏览器手工操作作为核心 PASS 的必要条件；如果环境不可用，标记 NOT RUN 并说明影响。

必须构造的独立风险探测：
- “Pr 是一个函数。”、“Pr 定义为函数。”、“Pr 不表示概率，而是函数。”
- “不要假设 Pr 是函数。”、“有人误以为 Pr 是函数。”、“本题不把 Pr 当作概率。”
- E/Var/Cov/SD 被显式声明为普通函数时的输出；
- P/Pr 冲突、近作用域覆盖和 MathML intent 冲突；
- 代码块和转义美元中的公式边界；
- 公式失败后普通正文是否保留；
- 规则版本/上下文改变后旧结果是否保持不变。

输出目录：
outputs/math-speech-pre-frontend-closure/

至少生成：
- CLOSURE_REPORT.md
- architecture-decision.md
- mixed-text-contract.md
- server-api-contract.md
- e2e-test-plan.md
- release-presence-plan.md
- risk-register.json
- baseline/
- open-questions.md

CLOSURE_REPORT.md 必须包含：
1. 结论：READY_FOR_FRONTEND_REVIEW / NOT_READY / BLOCKED；
2. 第四轮 PASS 的证据摘要；
3. 本轮新增风险和独立反例；
4. 核心、接入层、前端三层职责边界；
5. 服务端 API 推荐及替代方案；
6. 混合文本契约；
7. 发布存在性和运行目录方案；
8. E2E 测试矩阵；
9. 语义冻结和未来版本模型建议；
10. 禁止路径/敏感文件/核心哈希结果；
11. 所有命令退出码；
12. 风险等级和阻断项；
13. 前端接入授权状态。

最终停止条件：
- 如果发现必须修改前端才能完成收尾，停止并报告，不修改；
- 如果发现核心存在新的 S1/S2 错误，停止并报告，不修改；
- 如果只是设计缺口，写入 open-questions.md；
- 即使结论 READY_FOR_FRONTEND_REVIEW，也不得打开前端准入门。

最终报告末尾必须明确写：
前端准入门：CLOSED
前端已经授权：否
重新生成语音已经授权：否
本轮修改前端文件：0
本轮实现重新生成语音：否
```

