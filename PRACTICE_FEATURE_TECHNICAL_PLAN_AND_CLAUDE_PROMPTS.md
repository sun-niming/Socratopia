# Socratopia 出题、解题、讲题功能技术流程与 Claude Code 执行 Prompts

## 0. 文档目的

本文档用于规划 Socratopia 新增“出题、解题、讲题”功能的技术实现路径，并按照实际动工顺序，为 Claude Code 准备可直接执行的分阶段 prompt。

目标不是复制“拍照搜答案”类产品，而是在 Socratopia 现有的教材阅读、AI 伙伴、苏格拉底式对话、知识库、闪卡、课堂总结能力上，做一个以“讲会、练会、迁移会”为核心的练题工作台。

一句话定位：

> 不是搜答案，而是把题讲到你会。

## 1. 当前项目基础判断

当前目录是 Socratopia Electron Windows 打包产物，不是完整源代码仓库。根据现有 `CLAUDE.md`，真正源仓库参考为 `socralab-app/v2`，而当前目录主要包含：

- Electron 主进程：`main.js`、`preload.js`
- Next.js standalone 服务：`resources/server/`
- API 路由编译产物：`resources/server/.next/server/app/api/*/route.js`
- 前端编译产物：`resources/server/.next/static/chunks/**/*.js`

如果正式动工，优先在源仓库实现：

- `src/app/api/practice/route.ts`
- `src/components/...`
- `src/app/page.tsx` 或现有主界面入口
- 共享类型、工具函数、持久化模块

如果只能在当前打包产物上热修，需要直接编辑 compiled bundle，风险更高，不建议作为第一选择。

## 2. 产品目标

新增一个“练题工作台”，覆盖三类核心能力：

1. 出题：从当前教材页、章节、课堂对话、知识卡片中生成练习题。
2. 解题：对用户输入的题目或后续 OCR 识别题目进行解法生成、答案校验和错因诊断。
3. 讲题：用 Socratopia 的 AI 伙伴进行分步、互动、可追问的讲解，并生成变式题。

核心闭环：

```text
教材/课堂内容
  -> 知识点抽取
  -> 自动出题
  -> 用户作答
  -> 判题与错因诊断
  -> 分步讲题
  -> 变式训练
  -> 错题沉淀
  -> 间隔复习
```

## 3. 对旧模块的复用

### 3.1 复用 flashcard 模块

现有 `/api/flashcard` 已具备：

- 根据课堂对话生成选择题
- JSON 解析与容错
- 卡片保存
- 答题记录 `history`
- 收藏
- 简化间隔复习算法

新增练题功能可复用：

- 选择题生成 prompt 的结构
- 题目 JSON 校验思路
- 答题记录结构
- `ease`、`interval`、`nextReview` 等复习字段
- 收藏/错题的状态管理思想

建议第一版不要完全替换 flashcard，而是建立 `practice` 独立模块，同时在客观题复习逻辑上复用 flashcard 的数据思想。

### 3.2 复用 concept-summary 模块

现有 `/api/concept-summary` 能把课堂对话整理成概念笔记，具备：

- 真实对话内容约束
- 核心概念提取
- review questions 生成
- 严格 JSON 输出
- JSON 修复/容错解析

新增出题功能可优先读取概念总结，用它作为题目生成的知识边界，避免模型凭空扩展。

### 3.3 复用 lesson-summary 模块

现有 `/api/lesson-summary` 能压缩课堂对话摘要，适合加入讲题上下文：

- 学生最近学过什么
- 学生卡在哪里
- 哪些问题未解决
- 哪些知识点刚被讨论过

讲题时可把 lesson summary 作为背景，让 AI 的讲解贴合学生当前水平。

### 3.4 复用 chat 模块

现有 `/api/chat` 是核心教学对话模块，已经具备：

- 教材上下文注入
- AI 伙伴人格
- 苏格拉底式引导
- 阅读状态
- 知识库 distill
- 当前页教学规则

讲题功能应复用其教学风格和上下文组织原则，但输出改成结构化步骤，而不是自由聊天流。

### 3.5 复用 textbook / reading-context / jump-page

这些模块负责：

- 教材 CRUD
- 当前教材页
- 当前阅读进度
- 页文本读取
- 页码跳转
- PDF 资产

出题时应优先使用这些模块读取当前页或页码范围。

### 3.6 复用 stats 模块

后续可把练题数据写入统计系统：

- 练题数
- 正确率
- 薄弱知识点
- 连续练习天数
- 错题复习完成数

## 4. 前端设计

### 4.1 入口

在现有主学习界面中增加“练题”入口，建议位置：

- 教材阅读区域工具栏
- 当前学习页旁边的操作按钮
- 或聊天输入区附近的辅助按钮

不建议做成独立 landing page。用户点击后直接进入可用的练题工作台。

### 4.2 练题工作台布局

推荐三栏布局：

```text
+----------------+------------------------+----------------------+
| 题源与设置      | 题目与作答              | AI 讲题               |
+----------------+------------------------+----------------------+
| 当前页          | 题干                    | 提示                 |
| 当前章节        | 选项/输入框             | 下一步               |
| 选中文本        | 草稿区                  | 检查思路             |
| 最近课堂        | 提交/重做               | 完整讲解             |
| 手动输入        | 判题结果                | 变式题               |
+----------------+------------------------+----------------------+
```

移动端或窄窗口可以改成 tabs：

- 题源
- 作答
- 讲题

### 4.3 关键前端组件

建议组件拆分：

```text
PracticeWorkspace
  PracticeSourcePanel
  ProblemSetToolbar
  ProblemCard
  AnswerEditor
  GradingResultView
  ExplanationPanel
  ExplanationStepCard
  VariantProblemList
  MistakeSaveButton
```

### 4.4 前端状态模型

```ts
type PracticeMode = "generate" | "solve" | "explain" | "review";

type ProblemType = "choice" | "fill" | "short-answer" | "step";

type ProblemSession = {
  sessionId: string;
  problemSetId?: string;
  problemId: string;
  sourceType: "textbook-page" | "chapter" | "conversation" | "manual" | "image";
  userAnswer?: string;
  submitted: boolean;
  grading?: GradingResult;
  explanationStepIndex: number;
  showFinalAnswer: boolean;
};
```

### 4.5 前端交互原则

1. 答案默认折叠，不第一时间展示。
2. 用户先作答，或明确点击“我不会”后再进入提示。
3. 讲题以步骤卡片展示，不直接甩大段解析。
4. 每一步都可以让学生回应。
5. 错题保存是自然结果，不是额外负担。
6. 变式题紧跟讲题后出现，形成迁移训练。

## 5. 后端设计

### 5.1 新增 API

建议新增统一 API：

```text
POST /api/practice
GET  /api/practice
```

用 `action` 区分操作：

```text
generate      根据教材/课堂内容生成题目
solve         解一道用户输入的题
grade         判定用户答案
explain       生成分步讲题
hint          生成提示
variant       生成变式题
saveMistake   保存错题
listMistakes  读取错题
```

### 5.2 generate 请求

```json
{
  "action": "generate",
  "profileId": "...",
  "worldId": "...",
  "textbookId": "...",
  "conversationId": "...",
  "sourceType": "textbook-page",
  "pageRange": [12, 15],
  "problemTypes": ["choice", "short-answer"],
  "difficulty": 2,
  "count": 5,
  "teachingLanguage": "chinese",
  "accessMode": "hosted",
  "sessionToken": "..."
}
```

### 5.3 题目结构

```ts
type PracticeProblem = {
  id: string;
  type: "choice" | "fill" | "short-answer" | "step";
  question: string;
  choices?: string[];
  correctAnswer: string;
  correctIndex?: number;
  solution: string;
  knowledgePoints: string[];
  difficulty: 1 | 2 | 3;
  source: {
    profileId: string;
    worldId: string;
    textbookId?: string;
    textbookTitle?: string;
    pages?: [number, number];
    conversationId?: string;
    conceptSummaryId?: string;
  };
  rubric?: string[];
  commonMistakes?: string[];
  createdAt: string;
  status: "active" | "mistake" | "mastered" | "deleted";
  history: PracticeAnswerRecord[];
};
```

### 5.4 判题结构

```ts
type GradingResult = {
  correct: boolean;
  score?: number;
  normalizedUserAnswer?: string;
  normalizedCorrectAnswer?: string;
  feedback: string;
  mistakeType?: "concept" | "method" | "calculation" | "reading" | "expression" | "unknown";
  missingPoints?: string[];
  nextAction: "continue" | "explain" | "variant" | "review";
};
```

### 5.5 讲题结构

```ts
type ProblemExplanation = {
  problemId: string;
  generatedAt: string;
  summary: string;
  steps: {
    title: string;
    content: string;
    checkQuestion?: string;
    hint?: string;
    expectedAnswer?: string;
    commonMistake?: string;
  }[];
  finalAnswer: string;
  mistakeDiagnosis?: string;
  variantDirections?: string[];
};
```

### 5.6 数据存储

建议目录：

```text
profiles/{profileId}/worlds/{worldId}/practice/
  problem_sets/
    {problemSetId}.json
  sessions/
    {sessionId}.json
  mistakes/
    {problemId}.json
```

题组文件：

```json
{
  "id": "ps_xxx",
  "createdAt": "...",
  "source": {},
  "problems": []
}
```

错题文件：

```json
{
  "problemId": "pb_xxx",
  "wrongAnswer": "...",
  "correctAnswer": "...",
  "diagnosis": "...",
  "knowledgePoints": ["..."],
  "createdAt": "...",
  "reviewHistory": [],
  "nextReview": "..."
}
```

## 6. LLM 流程

### 6.1 出题流程

```text
读取题源
  -> 获取教材页文本/知识库卡片/概念总结/课堂摘要
  -> 整理成 generation context
  -> 调用强模型生成严格 JSON
  -> 服务端解析和校验
  -> 修复或过滤坏题
  -> 保存 problem_set
  -> 返回前端
```

### 6.2 解题流程

```text
接收题目
  -> 判断学科/题型/知识点
  -> 若用户未作答，先生成提示
  -> 若用户已作答，先判题
  -> 生成解题路线
  -> 必要时生成完整解析
  -> 返回结构化 solve result
```

### 6.3 讲题流程

```text
读取题目 + 用户答案 + 判题结果 + 教材上下文
  -> 生成分步讲解
  -> 每步包含讲解、提示、检查问题、常见误区
  -> 前端逐步展示
  -> 用户可要求换说法/举例/完整讲解
```

### 6.4 变式题流程

```text
读取原题 + 知识点 + 错因
  -> 保持同一核心知识点
  -> 改变表面条件或应用场景
  -> 难度微调
  -> 返回 1-3 道变式题
```

## 7. Prompt 设计原则

后端调用 LLM 时必须要求：

1. 只输出 JSON，不输出 markdown 代码块。
2. 不确定的内容要标注，而不是编造。
3. 题目必须绑定 source。
4. 解析必须能解释为什么对、为什么错。
5. 数学公式使用现有 markdown/katex 兼容格式。
6. 讲题时默认先提示，再完整答案。
7. 变式题不能引入完全无关知识点。

## 8. 动工顺序

推荐按以下顺序实施：

1. 准备和定位源代码
2. 定义 practice 类型和存储工具
3. 实现 `/api/practice` 的 generate
4. 实现 grade / explain / hint / variant
5. 实现前端练题工作台基础 UI
6. 接入现有教材页/课堂上下文
7. 接入错题本和复习
8. 完成 QA、错误处理和回归测试

下面每一节都是给 Claude Code 的可执行 prompt。

---

# Claude Code Prompt 01：准备和代码定位

```text
你正在 Socratopia 项目中工作。请先阅读项目说明和现有架构，不要急着改代码。

目标：
为新增“出题、解题、讲题”功能做代码定位和实施准备。

请执行：
1. 阅读 CLAUDE.md 或项目内等价说明。
2. 判断当前目录是源仓库还是打包产物。
3. 如果是源仓库，定位以下模块：
   - 教材读取模块
   - chat API
   - flashcard API
   - concept-summary API
   - lesson-summary API
   - 主页面和教材阅读 UI
4. 如果是打包产物，不要直接大规模修改 compiled bundle。先报告应该在源仓库中改哪些源文件。
5. 输出一份简短实施地图，列出后续要创建或修改的文件。

约束：
- 暂不实现功能。
- 不要重构无关代码。
- 优先复用现有 helper、路径工具、LLM 调用工具和鉴权逻辑。

验收：
- 给出准确的文件清单。
- 说明 practice 模块应该放在哪里。
- 说明哪些旧模块可复用。
```

# Claude Code Prompt 02：定义数据类型和持久化工具

```text
请开始实现 Socratopia 的 practice 数据基础层。

目标：
新增练题功能的数据类型和本地持久化工具，但不要接前端 UI。

请实现：
1. 新增 PracticeProblem、PracticeProblemSet、PracticeAnswerRecord、GradingResult、ProblemExplanation 类型。
2. 新增 practice 数据目录：
   profiles/{profileId}/worlds/{worldId}/practice/
     problem_sets/
     sessions/
     mistakes/
3. 复用现有 path helper 和 safe path segment 校验逻辑。
4. 实现读写工具：
   - readProblemSet(profileId, worldId, problemSetId)
   - writeProblemSet(...)
   - listProblemSets(...)
   - readMistakes(...)
   - saveMistake(...)
5. 写入 JSON 时使用项目已有的原子写或安全写模式。

约束：
- 不要破坏 flashcard 原有数据结构。
- 不要引入新数据库。
- 所有 profileId/worldId/problemSetId 都要做路径安全校验。
- 如果项目已有 write-file-atomic 或类似工具，优先复用。

验收：
- TypeScript 类型通过。
- 新工具有基本单元测试，或至少有可运行的 smoke test。
- 不影响现有 flashcard、concept-summary、lesson-summary。
```

# Claude Code Prompt 03：实现 `/api/practice` 的 generate

```text
请实现练题 API 的第一阶段：根据教材或课堂上下文生成题目。

目标：
新增 POST /api/practice，支持 action="generate"。

输入字段：
- profileId
- worldId
- textbookId 可选
- conversationId 可选
- sourceType: "textbook-page" | "chapter" | "conversation" | "manual"
- pageRange 可选
- sourceText 可选
- problemTypes
- difficulty
- count
- teachingLanguage
- accessMode/sessionToken/apiKey/provider/model 按现有 API 习惯接入

请实现：
1. 复用现有 LLM 调用核心，不新建一套 provider 逻辑。
2. sourceType="textbook-page" 时，优先复用现有教材页文本读取能力。
3. sourceType="conversation" 时，优先复用 concept-summary 或 lesson-summary 上下文。
4. 如果已有 knowledge_base/cards 或 teaching_map，可优先纳入 generation context。
5. 设计出题 system prompt，要求 LLM 输出严格 JSON。
6. 服务端解析 JSON，过滤字段不完整的题目。
7. 保存 problem_set 到 practice/problem_sets。
8. 返回 { problemSet }。

题目必须包含：
- id
- type
- question
- choices 可选
- correctAnswer
- correctIndex 可选
- solution
- knowledgePoints
- difficulty
- source
- commonMistakes

约束：
- 不要第一版支持 OCR。
- 不要直接复用 flashcard 文件保存题组，但可以复用其 prompt 思路和解析技巧。
- 所有 LLM 输出都必须服务端校验，不能原样信任。
- 出题内容不能超出 source 太远；如果是补充知识，要在 solution 中标注。

验收：
- 手动请求 action="generate" 能生成并保存题组。
- 坏 JSON 不会导致服务崩溃。
- 无 API key 或 hosted token 时返回清晰错误。
```

# Claude Code Prompt 04：实现 grade、hint、explain、variant

```text
请扩展 /api/practice，支持判题、提示、讲题和变式题。

目标：
在已有 action="generate" 基础上，新增：
- action="grade"
- action="hint"
- action="explain"
- action="variant"

请实现：
1. grade:
   - 输入 problemId/problemSetId/userAnswer
   - 对选择题先本地判定
   - 对简答题/步骤题调用 LLM 判定
   - 返回 GradingResult
   - 写入 problem.history
2. hint:
   - 只给提示，不暴露最终答案
   - 结合题目知识点和用户已有尝试
3. explain:
   - 返回 ProblemExplanation
   - 讲题分为多个步骤
   - 每步包含 title/content/checkQuestion/hint/commonMistake
4. variant:
   - 基于原题和错因生成 1-3 道变式题
   - 保持知识点一致，改变条件或场景

约束：
- 完整答案必须只在 explain 或用户明确请求时返回。
- hint 不能泄露 correctAnswer。
- variant 不能生成完全无关知识点。
- 更新 problem_set 时注意并发和原子写。

验收：
- 选择题 grade 不依赖 LLM。
- 简答题能返回分数、错因、反馈。
- explain 返回结构化步骤，不是单段文本。
- variant 返回可再次作答的 PracticeProblem。
```

# Claude Code Prompt 05：实现练题工作台前端 UI

```text
请实现 Socratopia 的练题工作台前端基础界面。

目标：
在现有主学习界面中增加“练题”入口，并实现可用的 PracticeWorkspace。

请实现组件：
- PracticeWorkspace
- PracticeSourcePanel
- ProblemCard
- AnswerEditor
- GradingResultView
- ExplanationPanel
- ExplanationStepCard
- VariantProblemList

交互流程：
1. 用户点击“练题”。
2. 选择题源：当前页、当前课堂、手动输入。
3. 点击生成题目。
4. 展示题目。
5. 用户作答并提交。
6. 显示判题结果。
7. 用户可以点击提示、讲题、变式题。

UI 要求：
- 不做营销页，入口后直接是工具界面。
- 保持现有设计系统和颜色变量。
- 使用 lucide-react 图标。
- 答案默认折叠。
- 窄窗口用 tabs 或上下布局。
- 按钮、输入框、题卡不能在移动端溢出。

约束：
- 不要重构主页面的大结构。
- 不要破坏现有聊天、教材阅读、闪卡入口。
- 文案支持现有 i18n 方式；至少提供中文 key，若项目已有英文/繁中也补齐。

验收：
- 能从 UI 调用 /api/practice generate。
- 能显示题目并提交答案。
- 能展示 explain 的分步讲题。
- 前端无明显布局错位。
```

# Claude Code Prompt 06：接入教材页、课堂上下文和旧模块

```text
请把练题工作台与 Socratopia 旧学习模块打通。

目标：
让练题功能真正复用现有教材、课堂、知识卡片、总结上下文。

请实现：
1. 当前教材页出题：
   - 从现有 reading-context 或当前教材状态获取 textbookId/currentPage/pageRange。
   - 前端默认显示“当前页生成”。
2. 课堂对话出题：
   - 从当前 conversationId 获取最近课堂消息。
   - 若已有 concept-summary，优先用概念总结。
   - 若没有，再用 lesson-summary 或最近消息窗口。
3. 知识库复用：
   - 如果教材目录有 knowledge_base/cards 和 teaching_map，后端生成题目时纳入上下文。
4. flashcard 复用：
   - 客观题答题历史字段参考 flashcard。
   - 可提供“加入闪卡复习”或“收藏为复习题”的入口，但不要破坏原 flashcard 数据。

约束：
- source 信息必须写入每道题，方便追踪题目来源。
- 没有教材上下文时，UI 要降级到“手动输入题目”。
- 没有 concept-summary 时不要报错，自动 fallback。

验收：
- 当前页能一键生成题。
- 课堂对话结束后能基于对话生成题。
- 题目 source 中包含教材和页码或 conversationId。
```

# Claude Code Prompt 07：实现错题本和复习闭环

```text
请实现 practice 错题本和复习闭环。

目标：
把错误作答沉淀为可复习对象，并支持从错题生成变式题。

请实现：
1. saveMistake:
   - 保存 problemId、wrongAnswer、correctAnswer、diagnosis、knowledgePoints、source、createdAt。
   - 写入 practice/mistakes。
2. listMistakes:
   - 支持按 textbookId、knowledgePoint、createdAt、reviewDue 过滤。
3. 前端错题入口：
   - 在练题工作台增加“错题”tab 或入口。
   - 展示错题列表、错因、知识点、来源。
4. 复习动作：
   - 从错题重新作答。
   - 从错题生成变式题。
   - 标记已掌握。
5. 简化间隔复习：
   - 可复用 flashcard ease/interval/nextReview 逻辑。

约束：
- 错题保存必须幂等，同一 problemId 不要无限复制。
- 用户答错后可以自动建议保存，但不要强制弹窗打断。
- 错题页面保持轻量，不做复杂学习报告。

验收：
- 答错题后能保存错题。
- 错题能重新打开讲解。
- 错题能生成变式题。
- 已掌握后不再出现在默认待复习列表。
```

# Claude Code Prompt 08：QA、错误处理和验收

```text
请对练题、解题、讲题功能做最终 QA 和修复。

目标：
保证新功能不会破坏现有 Socratopia 学习流程，并处理常见失败状态。

请检查：
1. API 错误：
   - 无 API key
   - hosted session 缺失
   - LLM 超时
   - LLM 返回坏 JSON
   - source 不存在
   - 路径参数非法
2. 前端状态：
   - 生成中 loading
   - 判题中 loading
   - 讲题中 loading
   - 空题组
   - 无教材上下文
   - 网络/API 失败
3. 兼容性：
   - 现有 chat 正常
   - 现有 flashcard 正常
   - concept-summary 正常
   - lesson-summary 正常
   - 教材阅读正常
4. UI：
   - 桌面宽屏布局
   - 窄窗口布局
   - 长题干不溢出
   - 数学公式可渲染
   - markdown 可渲染

请执行：
- TypeScript check
- lint 或项目已有检查
- 相关 API route smoke test
- 必要的手动浏览器验证

验收：
- 给出测试结果。
- 列出仍未覆盖的风险。
- 修复所有高优先级 bug。
- 不引入无关重构。
```

## 9. MVP 范围建议

第一版只做：

1. 当前教材页生成题。
2. 最近课堂生成题。
3. 用户作答。
4. 选择题本地判题，主观题 LLM 判题。
5. 分步讲题。
6. 错题保存。
7. 变式题。

暂缓：

- OCR 拍照识题
- 大规模题库检索
- 视频讲题
- 作业批改
- 多学科专用符号判等
- 复杂学习报告

## 10. 关键风险与处理

### 10.1 答案可靠性

处理方式：

- 题目必须绑定教材、知识卡片或课堂总结。
- 服务端校验 LLM JSON。
- 题目保存 source。
- 超出教材内容时标注“补充说明”。

### 10.2 用户直接抄答案

处理方式：

- 默认先显示提示。
- 完整答案折叠。
- 鼓励先作答。
- 讲题分步骤解锁。

### 10.3 旧模块耦合过重

处理方式：

- 新建 `practice` 模块。
- 只复用旧模块的工具和数据，不直接侵入旧模块核心逻辑。
- 与 flashcard 保持兼容但不混写数据。

### 10.4 当前仓库是打包产物

处理方式：

- 正式开发优先在源仓库完成。
- 打包产物只用于验证现有接口和临时热修。
- 若必须修改 compiled bundle，应把范围压到最小，并按现有 `CLAUDE.md` 做语法检查和 manifest 处理。

## 11. 最终建议

最优实施路线是新增独立 `practice` 域，让它复用旧模块能力，但不绑死在旧模块结构里：

- 教材上下文来自 textbook / reading-context。
- 学生状态来自 lesson-summary / concept-summary。
- 题目复习思想来自 flashcard。
- 讲题风格来自 chat。
- 新增数据沉淀到 practice。

这样既能对标作业帮“解题/讲题”的用户需求，又能保留 Socratopia 的核心差异：AI 伙伴不是只给答案，而是带着学生把题真正学会。
