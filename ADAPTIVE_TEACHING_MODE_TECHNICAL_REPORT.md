# 自适应教学聊天模式技术流程报告与 Claude Code 执行 Prompts

## 0. 文档目的

本文档用于规划一个独立于当前普通聊天教学逻辑的新教学模式。该模式的目标不是简单增强现有聊天 prompt，而是构建一套可诊断、可追踪、可验证、可长期自适应的智能导师系统。

本文分为两部分：

1. 技术流程报告：说明推荐架构、数据结构、模型职责、教学闭环和评估体系。
2. Claude Code 执行 Prompts：按照实际动工顺序，给 Claude Code 分阶段实施的完整任务提示词。

本文件只做产品和技术分析，不要求立即修改当前产品代码。

---

# Part 1: 技术流程报告

## 1. 项目目标

新模式应作为一个独立教学模式存在，避免和现有课堂聊天、群聊、TTS、教材阅读等逻辑直接耦合。

核心目标：

- 精准判断学生当前掌握情况。
- 根据学生表现动态选择教学方式。
- 长期记录并更新学生画像。
- 用追问、练习、复述、迁移题验证真实掌握。
- 通过独立质检降低讲错、讲偏、过度提示的问题。
- 形成持续迭代的教学闭环。

设计原则：

- LLM 负责推理和表达，但不独占状态管理。
- 学生模型必须结构化存储，不能只靠聊天摘要。
- 教学过程必须可回放、可评估、可修正。
- 用户说“懂了”不能直接视为掌握，必须通过验证题确认。

## 2. 总体架构

推荐采用多模块编排架构，而不是单一 LLM 聊天架构。

单轮流程：

```text
用户输入
  -> 输入理解与意图识别
  -> 知识点定位
  -> 学生状态诊断
  -> 更新 Learner Model
  -> 教学策略选择
  -> 教学回复生成
  -> 质量评估与修正
  -> 输出给用户
  -> 记录学习轨迹
```

核心模块：

- Tutor Orchestrator：总控调度器。
- Learner Model：学生长期画像。
- Knowledge Graph：课程知识图谱。
- Diagnostic Engine：诊断与错因分析。
- Pedagogy Policy Engine：教学策略选择器。
- Tutor LLM：生成教学回复。
- Evaluator LLM：检查教学质量。
- Memory Store：长期学习记录。
- Assessment Engine：测评与复习调度。

## 3. 数据层设计

系统需要维护三类核心数据。

### 3.1 课程数据

课程数据回答“要教什么”。

需要包含：

- 教材内容。
- 知识点列表。
- 前置知识关系。
- 概念定义。
- 常见误区。
- 例题、反例、迁移题。
- 每个知识点的掌握标准。
- 题目难度、题型、目标知识点和错因映射。

建议结构：

```json
{
  "concept_id": "recursion_time_complexity",
  "title": "递归时间复杂度",
  "prerequisites": ["recursion_basics", "big_o_notation"],
  "mastery_criteria": [
    "能写出递归式",
    "能解释递归树层数",
    "能估计总工作量"
  ],
  "common_misconceptions": [
    "只看函数调用次数，不看每层工作量",
    "把递归深度误认为总复杂度"
  ]
}
```

### 3.2 学生数据

学生数据回答“这个学生现在是什么状态”。

需要包含：

- 每个知识点的掌握度。
- 历史答题记录。
- 常见错误类型。
- 提示依赖程度。
- 学习节奏偏好。
- 喜欢的解释风格。
- 情绪和挫败模式。
- 长期复习表现。

建议结构：

```json
{
  "profile_id": "user_001",
  "concept_mastery": {
    "recursion_basics": 0.78,
    "recursion_time_complexity": 0.42
  },
  "error_patterns": [
    {
      "type": "concept_application_failure",
      "concept_id": "recursion_time_complexity",
      "evidence": "能说出递归定义，但无法写出复杂度递推式",
      "last_seen_at": "2026-06-18T10:00:00+08:00"
    }
  ],
  "teaching_preferences": {
    "prefers_examples": true,
    "prefers_socratic_questions": false,
    "needs_step_by_step": true
  },
  "affective_state": {
    "confidence": 0.55,
    "frustration": 0.30
  }
}
```

### 3.3 教学过程数据

教学过程数据回答“我们刚才怎么教，效果如何”。

需要包含：

- 每轮用了什么教学策略。
- 用户是否理解。
- 是否答对后续题目。
- 是否出现复犯。
- 哪种讲法效果最好。
- 质检模型给出的评分和修改意见。

建议结构：

```json
{
  "turn_id": "turn_123",
  "concept_ids": ["recursion_time_complexity"],
  "strategy": "worked_example_then_micro_quiz",
  "diagnosis": "学生能理解递归调用，但不会估算每层成本",
  "student_response_quality": "partial",
  "mastery_delta": 0.08,
  "evaluator_score": {
    "correctness": 0.95,
    "pedagogical_fit": 0.88,
    "overhelping_risk": 0.20
  }
}
```

## 4. Learner Model 技术流程

Learner Model 是自适应教学的核心，不应只保存自然语言总结。

每轮对话后，需要更新：

- 知识点掌握度。
- 错因标签。
- 提示依赖。
- 学习偏好。
- 情绪状态。
- 需要复习的知识点。

推荐初期使用混合方案：

- 简化 BKT：更新概念掌握概率。
- IRT 思路：结合题目难度估计回答含金量。
- LLM 诊断：判断开放回答、解释题、代码题质量。
- 规则保护：低置信度时不大幅更新学生画像。

后期数据变多后，可以引入 DKT 或其他序列模型。

## 5. 单轮教学流程

每一轮用户输入都应走固定管线。

### 5.1 输入理解

判断用户是在：

- 提问。
- 答题。
- 表达困惑。
- 请求解释。
- 闲聊。
- 放弃。
- 要求换种讲法。
- 请求总结。

### 5.2 知识点定位

将输入映射到一个或多个知识点，并查询知识图谱中的前置概念。

输出示例：

```json
{
  "related_concepts": ["recursion_time_complexity"],
  "prerequisite_gaps": ["big_o_notation"],
  "confidence": 0.84
}
```

### 5.3 诊断分析

判断学生当前问题属于哪类：

- 不知道概念。
- 前置知识缺失。
- 概念混淆。
- 步骤跳跃。
- 题意误解。
- 会做原题但不会迁移。
- 表达不清但思路可能正确。

### 5.4 更新学生模型

根据用户表现更新掌握度、错因、偏好和状态。

状态更新必须保留证据，避免长期记忆污染。

### 5.5 选择教学策略

由策略引擎决定下一步：

- 直接解释。
- 苏格拉底追问。
- 举例。
- 给反例。
- 拆小题。
- worked example。
- 让学生复述。
- 小测验。
- 复习前置知识。

### 5.6 生成教学回复

Tutor LLM 根据策略、课程上下文和学生模型生成回复。

要求：

- 每轮只推进一个核心教学目标。
- 尽量让学生参与。
- 避免一次性倾倒过多知识。
- 不虚假表扬。
- 不直接把诊断和内部评分暴露给用户。

### 5.7 质量检查

Evaluator LLM 检查：

- 是否讲错。
- 是否太难或太简单。
- 是否过度给答案。
- 是否符合当前教学目标。
- 是否需要先诊断而不是讲解。
- 是否符合学生偏好。

### 5.8 输出与记录

输出最终回复，并记录：

- 输入。
- 诊断。
- 策略。
- 回复。
- 质检结果。
- 学生状态更新。

## 6. 多代理职责划分

### 6.1 Diagnostician 诊断代理

负责判断学生到底卡在哪里。

输出：

```json
{
  "related_concepts": ["时间复杂度", "递归"],
  "diagnosis": "学生知道递归形式，但不能估计复杂度",
  "error_type": "concept_application_failure",
  "confidence": 0.82
}
```

### 6.2 Planner 教学规划代理

负责决定下一步教学动作。

输出：

```json
{
  "next_strategy": "worked_example_then_micro_quiz",
  "target_concept": "递归时间复杂度",
  "difficulty": "medium-low",
  "reason": "学生需要先看到完整拆解，再做相似题"
}
```

### 6.3 Tutor 教学代理

负责生成自然语言教学内容。

要求：

- 不一次讲太多。
- 每轮只推进一个核心点。
- 尽量让学生参与。
- 根据学生偏好调节语气与节奏。

### 6.4 Evaluator 质检代理

负责拦截低质量回复。

评分维度：

- 正确性。
- 教学有效性。
- 难度匹配。
- 是否有诊断价值。
- 是否过度提示。
- 是否符合长期目标。

## 7. 教学策略选择规则

早期建议用规则实现，而不是直接训练策略模型。

示例规则：

```text
如果学生连续两次答错同一知识点：
  使用 worked example + 降低难度

如果学生概念解释正确但应用失败：
  使用迁移题 + 反例

如果学生说“我懂了”但没有做题验证：
  给一道低压力确认题

如果学生明显挫败：
  降低难度 + 先肯定有效部分 + 拆成小步

如果学生长期表现稳定：
  提高题目难度 + 增加迁移任务
```

## 8. 记忆与存储方案

建议分层存储。

短期记忆：

- 当前会话上下文。
- 最近 10 到 30 轮关键互动。
- 当前教学目标。
- 当前题目状态。

长期记忆：

- 学生画像。
- 知识点掌握曲线。
- 错因历史。
- 策略效果记录。
- 复习计划。
- 学习报告。

向量记忆：

- 学生曾经说过的典型困惑。
- 老师曾经有效的解释。
- 用户偏好的例子类型。
- 历史相似错误。

结构化数据库比纯向量库更重要。向量库负责检索相似经历，数据库负责可信状态。

## 9. 模型使用建议

如果不计成本：

- 主教学模型：强推理模型，用于诊断、规划、复杂解释。
- 质检模型：另一路强模型，独立检查回复。
- 轻量模型：用于标签抽取、摘要、状态更新草案。
- 语音模型：用于实时口语教学。
- 外部模型：可选作交叉质检，降低单模型盲点。

关键原则：

- 不要让一个模型同时负责生成和自我审查。
- 状态更新要结构化，不只写自然语言总结。
- 重要诊断结果要带 confidence。
- 低置信度时优先追问，而不是硬讲。

## 10. 评估体系

不能只看用户满意度，必须评估学习效果。

核心指标：

- 知识点掌握提升。
- 同类错误复犯率下降。
- 提示依赖度下降。
- 迁移题正确率提升。
- 延迟复习保持率。
- 用户完成率。
- 用户挫败退出率。
- 教学回复质检通过率。

每节课后生成：

```text
本节目标：
实际覆盖知识点：
用户掌握变化：
主要错误：
有效教学策略：
下次建议：
需要复习的内容：
```

## 11. 最小可行版本

第一版不需要追求完整智能体系统，可以先做闭环。

MVP 流程：

```text
知识点标注
  -> 每轮诊断
  -> 更新掌握度
  -> 选择策略
  -> 生成回复
  -> 小测验证
  -> 写入学生模型
```

MVP 必备：

- 知识点图谱。
- 错因标签。
- 策略标签。
- 学生掌握度表。
- 诊断题库。
- 质检模型。

暂时可以不做：

- 完整 DKT。
- 多模型仲裁。
- 自动生成整套课程。
- 复杂情绪建模。
- 高级语音实时互动。

## 12. 风险与控制

主要风险：

- 模型讲错。
- 过度自信诊断。
- 学生画像被错误更新。
- 教学策略过于机械。
- 长期记忆污染。
- 用户隐私数据过多。
- 模型为了鼓励而虚假表扬。

控制方法：

- 所有状态更新保留证据。
- 高风险知识点用检索增强。
- 低置信度时追问确认。
- 质检模型必须独立。
- 学生画像允许回滚。
- 定期做掌握度校准题。
- 不把“用户说懂了”直接当作掌握。

## 13. 推荐落地顺序

第一阶段：教学数据地基

- 建知识点图谱。
- 建题库和错因标签。
- 建学生模型 schema。
- 接入诊断代理。

第二阶段：自适应教学闭环

- 加策略选择器。
- 加掌握度更新。
- 加小测和复习调度。
- 加教学质检。

第三阶段：长期个性化

- 学习风格建模。
- 策略效果统计。
- 个性化课程规划。
- 周报/月报。
- 多模型评估。

第四阶段：高级体验

- 语音实时教学。
- 多模态题目讲解。
- 自动生成练习。
- 家教式长期陪伴。

## 14. 总结

这套系统的关键不是换一个更强模型，而是把教学拆成可诊断、可追踪、可验证、可迭代的流程。

最重要的技术判断：

```text
LLM 负责推理和表达；
知识图谱负责课程结构；
Learner Model 负责长期学生状态；
策略引擎负责怎么教；
质检代理负责守住教学质量；
测评系统负责证明学生真的学会了。
```

如果目标是教得够好，这个新模式应该被设计成智能导师系统，而不是普通聊天功能的增强版。

---

# Part 2: 按动工次序给 Claude Code 的执行 Prompts

以下 prompts 按推荐实施顺序编写。每条 prompt 都假设 Claude Code 已经在 Socratopia 项目根目录工作，并且需要先阅读项目结构和现有约定。执行时建议一次只给 Claude Code 一个阶段，完成、测试、提交后再进入下一阶段。

## Prompt 1: 项目勘察与新模式边界设计

```text
你现在在 Socratopia 项目根目录。请只做勘察和设计，不要修改代码。

目标：为一个新的“自适应教学聊天模式”确定最小实现边界。该模式必须独立于当前普通聊天教学逻辑，不破坏现有课堂聊天、群聊、TTS、教材阅读、用户数据存储。

请完成：
1. 阅读 CLAUDE.md，理解打包产物、API route、frontend chunk、server copy、验证命令等项目约定。
2. 搜索当前课堂聊天相关逻辑，包括但不限于 /api/chat、conversation 存储、教材读取、lesson summary、profile/world/textbook 数据接口。
3. 找出最适合新增独立模式的后端入口、前端入口和数据存储位置。
4. 输出一份实施设计：
   - 新模式名称和入口建议。
   - 哪些现有模块可以复用。
   - 哪些逻辑必须隔离。
   - 第一版不做什么。
   - 需要新增哪些 route、数据文件、类型/schema、前端状态。
5. 不要做任何代码改动。

验收标准：
- 输出包含明确文件路径建议。
- 输出包含阶段化实现顺序。
- 明确说明如何避免影响现有聊天教学逻辑。
```

## Prompt 2: 定义数据模型与存储 schema

```text
请实现自适应教学模式的数据模型与本地存储基础，但不要接入 UI。

目标：新增结构化 Learner Model、Knowledge Graph、Teaching Session、Assessment Result 的 schema 和读写工具，为后续教学编排提供稳定数据层。

要求：
1. 遵循项目现有文件读写方式和数据存储习惯。
2. 新数据必须和现有 conversation、profile、world 数据隔离。
3. 设计并实现以下 schema：
   - LearnerModel：知识点掌握度、错因历史、教学偏好、情绪/信心状态、复习队列。
   - ConceptGraph：知识点、前置关系、掌握标准、常见误区。
   - TeachingSession：当前目标、当前知识点、阶段、最近诊断、最近策略。
   - AssessmentResult：题目、学生答案、判定、错因、掌握度变化、证据。
4. 提供读写 helper：
   - loadLearnerModel(profileId, worldId)
   - saveLearnerModel(profileId, worldId, model)
   - loadConceptGraph(profileId, worldId, textbookId)
   - saveConceptGraph(...)
   - appendTeachingEvent(...)
5. 新增必要的默认初始化逻辑。
6. 为关键 helper 增加轻量测试或可运行 smoke check。

验收标准：
- 不影响现有聊天功能。
- schema 可序列化为 JSON 或 Markdown + JSON frontmatter，具体形式按项目现有习惯选择。
- 缺失文件时能安全初始化。
- 运行 node --check 或项目适用检查命令通过。
```

## Prompt 3: 知识点图谱抽取与题库基础

```text
请实现自适应教学模式的课程知识图谱和诊断题库基础生成能力。

目标：从现有教材/课程资料中生成一个最小可用 ConceptGraph，并支持人工增量修正。

要求：
1. 复用现有教材读取、progress、textbook 相关能力。
2. 新增一个独立后端 route 或 server helper，用于：
   - 给定 profileId、worldId、textbookId。
   - 读取教材或已有教材摘要。
   - 生成知识点列表。
   - 生成知识点前置关系。
   - 生成每个知识点的掌握标准和常见误区。
   - 生成少量诊断题和迁移题。
3. 输出写入自适应教学模式自己的数据目录，不改现有教材文件。
4. LLM 输出必须经过 JSON 解析和基础校验。
5. 失败时返回可理解错误，不污染已有 ConceptGraph。
6. 提供一个 dry-run 或 smoke test，能在没有真实 API key 时验证 schema 和文件路径。

验收标准：
- 生成结果可被后续诊断和策略选择模块读取。
- 每个 concept 至少有 id、title、prerequisites、mastery_criteria、common_misconceptions。
- 每道题至少有 target_concepts、difficulty、expected_answer、misconception_mapping。
```

## Prompt 4: 诊断代理 Diagnostician

```text
请实现自适应教学模式的 Diagnostician 诊断代理。

目标：给定用户输入、当前教学上下文、ConceptGraph、LearnerModel，输出结构化诊断结果。

要求：
1. 新增独立 helper 或 route，不要复用普通 /api/chat 的直接生成逻辑。
2. 输入：
   - userMessage
   - recentTurns
   - activeConceptIds
   - ConceptGraph
   - LearnerModel
3. 输出 JSON：
   - related_concepts
   - prerequisite_gaps
   - diagnosis
   - error_type
   - evidence
   - confidence
   - recommended_next_action
4. 支持以下 error_type：
   - unknown_concept
   - prerequisite_gap
   - concept_confusion
   - application_failure
   - procedural_gap
   - careless_error
   - expression_unclear
   - no_error_detected
5. 低 confidence 时 recommended_next_action 应倾向于 ask_clarifying_question。
6. 添加 JSON schema 校验和 fallback。

验收标准：
- 输出稳定结构化 JSON。
- 不把诊断内容直接展示给用户。
- 能被 Planner 和 LearnerModel updater 使用。
- node --check 通过。
```

## Prompt 5: Learner Model 更新器

```text
请实现 Learner Model 更新器。

目标：根据 Diagnostician 输出、学生回答质量、题目难度和教学结果，更新学生长期画像。

要求：
1. 实现 updateLearnerModel(oldModel, teachingEvent)。
2. 更新内容：
   - concept_mastery 分数。
   - error_patterns。
   - hint_dependency。
   - teaching_preferences。
   - affective_state。
   - review_queue。
3. 掌握度更新先使用可解释规则，不要引入复杂 ML：
   - 答对高难题：较大提升。
   - 答对低难题：小幅提升。
   - 同类错误复犯：下降或保持。
   - 低置信度诊断：小幅或不更新。
4. 每次更新必须保留 evidence。
5. 支持回滚或至少保留 previous snapshot。
6. 增加单元测试或 smoke test，覆盖：
   - 正确回答提升掌握度。
   - 错误回答记录错因。
   - 低置信度不大幅改变画像。

验收标准：
- 更新逻辑 deterministic。
- 不依赖 LLM 即可运行基础测试。
- 不影响现有 profile/world 数据。
```

## Prompt 6: 教学策略选择器 Planner / Policy Engine

```text
请实现自适应教学模式的教学策略选择器。

目标：根据诊断结果、LearnerModel、ConceptGraph 和当前 session 状态，选择下一步教学动作。

要求：
1. 实现 selectTeachingStrategy(context)。
2. 支持策略：
   - direct_explanation
   - socratic_question
   - worked_example
   - analogy
   - counterexample
   - break_down_problem
   - micro_quiz
   - ask_student_to_restate
   - review_prerequisite
   - increase_challenge
   - reduce_difficulty
3. 初期使用规则引擎。
4. 规则示例：
   - 连续两次同类错误 -> worked_example + reduce_difficulty。
   - 概念能解释但不会应用 -> counterexample 或 transfer micro_quiz。
   - 用户说懂了但未验证 -> micro_quiz。
   - 挫败升高 -> reduce_difficulty + break_down_problem。
5. 输出 JSON：
   - strategy
   - target_concept_ids
   - difficulty
   - objective
   - reason
   - expected_user_action

验收标准：
- 同样输入得到同样输出。
- 规则有测试覆盖。
- Planner 不直接生成最终教学文本。
```

## Prompt 7: Tutor 生成代理

```text
请实现自适应教学模式的 Tutor 生成代理。

目标：根据 Planner 输出的教学策略，生成面向学生的教学回复。

要求：
1. 新增独立生成 helper 或 route，不要改普通 /api/chat 的行为。
2. 输入：
   - userMessage
   - recentTurns
   - LearnerModel 摘要
   - ConceptGraph 相关片段
   - Diagnosis
   - TeachingStrategy
3. 输出：
   - message_to_user
   - hidden_teaching_intent
   - expected_next_signal
4. 回复要求：
   - 每轮只推进一个核心教学目标。
   - 不暴露内部 diagnosis JSON。
   - 不虚假表扬。
   - 不过度给答案。
   - 如果策略是 micro_quiz，必须给出明确但低压力的小题。
   - 如果策略是 worked_example，必须分步但不过长。
5. 支持 teachingLanguage。
6. 失败时返回安全 fallback。

验收标准：
- 能根据不同策略生成明显不同的教学回复。
- 不污染现有课堂聊天 route。
- node --check 通过。
```

## Prompt 8: Evaluator 质检代理

```text
请实现自适应教学模式的 Evaluator 质检代理。

目标：在回复给用户之前，检查 Tutor 生成的内容是否正确、合适、不过度提示。

要求：
1. 输入：
   - candidateReply
   - userMessage
   - Diagnosis
   - TeachingStrategy
   - relevantConceptGraph
   - LearnerModel summary
2. 输出 JSON：
   - pass
   - correctness_score
   - pedagogical_fit_score
   - difficulty_fit_score
   - overhelping_risk
   - issues
   - revised_reply
3. 如果 pass=false，使用 revised_reply 或要求 Tutor 重试一次。
4. 不要无限重试，最多一轮修正。
5. 质检失败时必须记录原因到 teaching event。

验收标准：
- Evaluator 与 Tutor prompt 分离。
- 支持一轮自动修正。
- 质检结果进入日志。
```

## Prompt 9: Orchestrator 后端总控 route

```text
请实现自适应教学模式的后端总控 route。

目标：新增独立 API，例如 /api/adaptive-teaching，用于串联诊断、状态更新、策略选择、回复生成、质检和事件记录。

要求：
1. 不改现有 /api/chat。
2. 请求体至少包含：
   - profileId
   - worldId
   - textbookId
   - sessionId
   - userMessage
   - teachingLanguage
   - accessMode/sessionToken 或现有鉴权字段
3. 流程：
   - 加载 LearnerModel。
   - 加载或初始化 TeachingSession。
   - 加载 ConceptGraph。
   - 调用 Diagnostician。
   - 调用 Planner。
   - 调用 Tutor。
   - 调用 Evaluator。
   - 更新 LearnerModel。
   - appendTeachingEvent。
   - 返回最终 message_to_user 和必要 session 状态。
4. 错误处理：
   - 缺少 ConceptGraph 时返回需要初始化课程图谱。
   - LLM 失败时返回安全教学 fallback。
   - JSON 解析失败时不写入错误状态。
5. 支持非流式第一版；流式可以后续再做。

验收标准：
- route 独立可调用。
- 不影响现有聊天、群聊、TTS。
- node --check 通过。
- 至少提供一个 dry-run 请求示例。
```

## Prompt 10: 前端入口与最小 UI

```text
请实现自适应教学模式的最小前端入口。

目标：在现有应用中增加一个可以进入“自适应教学模式”的入口和最小聊天界面，但不要替换现有课堂聊天。

要求：
1. 阅读现有前端页面结构和 tab/模式切换逻辑。
2. 新增入口名称可暂定为“深度掌握模式”或“自适应导师”。
3. UI 第一版只需支持：
   - 选择教材或沿用当前教材。
   - 显示聊天消息。
   - 输入用户消息。
   - 调用 /api/adaptive-teaching。
   - 显示当前目标知识点和简短状态。
4. 不需要第一版接 TTS。
5. 不需要第一版做复杂动效或报告页面。
6. 所有新增 UI 必须避免影响原有课堂聊天、群聊和设置。

验收标准：
- 用户可以进入新模式并发送一轮消息。
- 新模式调用独立 API。
- 原有聊天入口仍可正常使用。
- node --check 通过。
```

## Prompt 11: 诊断题与小测闭环

```text
请为自适应教学模式实现 micro_quiz 和 assessment 闭环。

目标：当 Planner 选择 micro_quiz 或验证掌握时，系统能出题、记录答案、评估结果并更新 LearnerModel。

要求：
1. 支持从 ConceptGraph 的 question bank 选择题目。
2. 如果没有合适题目，允许 Tutor LLM 生成一题，但必须写入临时题目结构并由 Evaluator 检查。
3. TeachingSession 需要记录当前 pending question。
4. 用户下一轮回答时，Diagnostician/Assessment Engine 应优先判断该答案。
5. AssessmentResult 必须写入学习轨迹。
6. LearnerModel 更新必须使用 AssessmentResult。

验收标准：
- 用户说“懂了”后，系统能倾向于给小测验证。
- 用户答题后，系统能更新掌握度和错因。
- pending question 不会和普通聊天输入混淆。
```

## Prompt 12: 复习队列与课后总结

```text
请实现自适应教学模式的复习队列和课后总结。

目标：根据 LearnerModel 和 teaching events 生成需要复习的知识点，并在每节课后输出学习总结。

要求：
1. review_queue 按知识点、掌握度、复犯、时间间隔排序。
2. 每节 session 结束时生成 summary：
   - 本节目标。
   - 覆盖知识点。
   - 掌握变化。
   - 主要错因。
   - 有效教学策略。
   - 下次建议。
   - 需要复习内容。
3. summary 写入自适应模式自己的数据目录。
4. 前端可以显示最近一次 summary。
5. 不影响现有 lesson-summary route。

验收标准：
- 复习队列可读写。
- session summary 可生成。
- 不复用或污染普通课堂总结。
```

## Prompt 13: 可观测性、日志与评估指标

```text
请为自适应教学模式增加可观测性和基础评估指标。

目标：让后续可以判断系统是否真的教得更好。

要求：
1. 每轮 teaching event 记录：
   - diagnosis confidence。
   - selected strategy。
   - evaluator scores。
   - mastery delta。
   - user response type。
   - LLM failure/fallback。
2. 增加一个只读 stats helper 或 route，返回：
   - 知识点掌握变化。
   - 错因分布。
   - 策略使用分布。
   - micro_quiz 正确率。
   - overhelping risk 平均值。
3. 不记录 API key 或敏感配置。
4. 日志与用户数据分离存储。

验收标准：
- 可以查看一个 profile/world/textbook 的自适应教学统计。
- 不暴露敏感数据。
- 数据结构可用于后续图表展示。
```

## Prompt 14: 回归测试与安全检查

```text
请为自适应教学模式做一次完整回归检查，不新增功能，必要时只修 bug。

目标：确保新模式不破坏现有产品，并且核心自适应闭环可用。

请检查：
1. 普通课堂聊天仍可工作。
2. 群聊仍可工作。
3. TTS 音频按钮不受影响。
4. profile/world/textbook 读写不受影响。
5. 新模式 API 缺少参数时返回明确错误。
6. 新模式没有 ConceptGraph 时能提示初始化。
7. LearnerModel 缺失时能安全初始化。
8. Evaluator 失败时不会导致整轮崩溃。
9. JSON 解析失败不会污染长期状态。

请运行：
1. 所有改动 JS 文件的 node --check。
2. 已有 smoke tests。
3. 新增自适应模式 smoke tests。

输出：
1. 修改列表。
2. 验证命令和结果。
3. 仍然存在的风险。
4. 是否建议进入下一阶段。
```

## Prompt 15: 性能与成本优化阶段

```text
请在自适应教学模式可用后，做性能和成本优化设计与实现。

目标：在不明显降低教学质量的前提下，减少延迟和不必要的大模型调用。

要求：
1. 分析每轮调用链的 LLM 次数。
2. 将低风险任务改为轻量模型或规则：
   - 标签抽取。
   - session 摘要。
   - 简单状态更新。
3. 保留强模型用于：
   - 核心诊断。
   - 复杂教学规划。
   - 最终高风险质检。
4. 增加缓存：
   - ConceptGraph 读取缓存。
   - 题库选择缓存。
   - 稳定知识点解释片段缓存。
5. 保留一个 high_quality_mode 开关，不计成本时走完整链路。

验收标准：
- 默认模式延迟下降。
- high_quality_mode 仍可使用完整多代理链路。
- 不改变数据 schema 的兼容性。
```

## Prompt 16: 高级语音与多模态扩展设计

```text
请只做设计，不要立即实现。

目标：为自适应教学模式规划语音实时教学和多模态题目讲解扩展。

请输出：
1. 如何接入实时语音模型。
2. 如何让语音模式仍然更新 LearnerModel。
3. 如何处理用户上传图片、截图、手写题。
4. 如何让多模态输入进入 Diagnostician。
5. 如何避免语音聊天变成普通闲聊。
6. 需要新增哪些 API、状态、权限和前端组件。
7. 第一版语音/多模态 MVP 范围。

验收标准：
- 输出架构设计。
- 明确哪些现有模块可复用。
- 明确风险和不做项。
```

---

# 附录 A: 推荐阶段提交节奏

建议每个阶段独立提交，提交信息示例：

```text
Add adaptive teaching data schemas
Add concept graph generation for adaptive teaching
Add adaptive teaching diagnostician
Add learner model updater
Add teaching strategy planner
Add adaptive tutor response generator
Add adaptive teaching evaluator
Add adaptive teaching API route
Add adaptive teaching UI entry
Add micro quiz assessment loop
Add adaptive teaching review summaries
Add adaptive teaching observability
```

---

# 附录 B: 对 Claude Code 的通用约束

每个阶段都应附加以下约束：

```text
通用约束：
1. 先阅读 CLAUDE.md。
2. 不要重构无关代码。
3. 不要删除用户数据、settings.json、set.json、rules 缓存或任何本地配置。
4. 不要修改 Socratopia.exe、resources/app.asar，除非任务明确要求 Electron 主进程改动。
5. 修改打包 JS 后必须运行 node --check。
6. 如果改动 frontend chunk，必须说明如何验证页面入口。
7. 如果新增 API route，必须给出请求/响应示例。
8. 保持新模式和现有 /api/chat、/api/groupchat 隔离。
9. 所有长期状态更新必须保留 evidence。
10. 不要把用户说“懂了”直接当作掌握。
```
