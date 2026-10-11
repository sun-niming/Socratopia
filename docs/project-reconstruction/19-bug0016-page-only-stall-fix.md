# BUG-0016 修复：页级模式死锁 —— 协议标志误武装 C5 门闩 + 页级无完成信号通道

> 2026-09-26。证据 E-513 ~ E-518。对应 BUG-0016 / R-25（新增）。
> **第五轮改业务代码。用户授权后执行。**
> 方案与逐条实施记录：根目录 `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md`（该文档内文自称 BUG-0017，
> **与 §1f 的 BUG-0017「thinking 链路」不是同一条**；台账归属 BUG-0016）。

---

## 1. 现场

2026-09-26 课堂，会话 `l8CSY0K4pq761mzn_LSNy`，教材 KUyw《编译原理 第二版》648 页，**无 knowledge_base**。
窗口 70–75 讲完后**无法自动推进**。第 851 代权威状态（E-513）：

| 字段 | 值 | 解读 |
|---|---|---|
| `serverTurnOrdinal` / `lastAdvanceServerOrdinal` | 28 / 19 | delta = 9，正向阈值 12 爬升 |
| `structuredTeachingProgress` | `true` | C5 屏蔽条件成立 |
| `pageOnlyTeachingProgress` | `true` | 页级模式（C3 降级） |
| `windowComplete` / `pendingAdvance` | `false` / `null` | 正常推进通道无票 |
| `lastTaughtPage` | 75 | 已讲到窗口末页 |
| `candidate` | 76–91 已预取 | 下一窗就绪，等不到装载指令 |

日志（UTC）：07:49 `页级进度已讲到窗口末页（阶段二未启用，仅观测）`；07:24 / 07:59 两次
`marker rejected: taught_page_outside_loaded_range { reportedPage: 76, loadedRange: '70-75' }`。

> **V-9 于 09-25 加的 `detail` 可观测性正是本轮定案手段**：此前只有一行光秃秃的 reason，
> 连续 6 轮复现却无法定案。加上数值后，下一节课的日志直接给出答案。

---

## 2. 根因：三条自动推进路径**同时**堵死

`beginTurn` 只有三个换窗触发器，对无 KB 教材全部失效：

1. `auto-advance.js` `completeTurn` 用**协议标志**无条件武装 C5 门闩 ——
   而"走教学进度协议"是**每个 PDF 回合**都会传的（chat 路由 `requiresTeachingProgress: !isMarkdownLike`），
   与"本会话有已验证概念进度（换窗危险）"是**两种语义被压在同一个布尔上**。
   页级教材永远产不出已验证概念 marker → **武装后没有任何解锁路径**；该值还会投影进
   `progress_state.json` 并在播种时读回，**一旦置位终身免疫**。
2. `kb-progress.js` 的 `PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false`（阶段二）→
   页级 `windowComplete` 恒 false → `commitTeachingProgress` 永不创建已验证 `pendingAdvance`。
3. `validatePageMarker` 要求 `lastTaughtPage ∈ [loadedStart, loadedEnd]` →
   模型讲完后自然申报下一页 76 被**整单**拒收，**其中的 `windowComplete` 声明一并丢弃**。

→ 报 75 被阶段二忽略、报 76 被拒 = **死锁**。
09-23~26 另有 4 个会话命中同款 `[C5]` 告警 → **结构性复发，不是偶发**。
（既有测试还把这个行为固化成了"协议正确性"：`chat-teaching-progress-format-smoke-test.js:116`。

---

## 3. 改了什么（阶段一 M1–M5 + 阶段二 M6；编译产物零接触）

| 编号 | 位置 | 改动 |
|---|---|---|
| M1 | `auto-advance.js` `completeTurn` | 删除协议标志对门闩的无条件置位；协议语义留在 `turn.requiresTeachingProgress` |
| M2 | `auto-advance.js` `applyTeachingProgress` 的 `page_only` 分支 | 显式清除中毒 flag（**存量自愈**，随投影回写） |
| M3 | `auto-advance.js` `mergeLegacyTeachingProgress` | 播种/修复合并时不再采纳页级投影里的 flag |
| M4 | `auto-advance.js` `beginTurn` | 门闩加页级豁免（纵深防御：中毒会话不必等 marker，delta 到 12 即恢复阈值兜底）；C5 告警条件同步收窄，tag 改 `[C5]` |
| M5 | `.next/.../chat-teaching-progress-format-smoke-test.js` | 拆成"回合级协议断言 + conversation 级门闩断言"两条 |
| M6 | `kb-progress.js` `validatePageMarker` | 接纳 `loadedEnd + 1` **且显式声明 `windowComplete`** 的申报并钳制进窗口；`end+2` 仍拒签（防静默跳页）；带一次性观测日志与 `normalizedFromPage` |

设计原则：**语义归位**（门闩只表达"存在已验证概念进度"）、**存量自愈**（不写迁移脚本、不手改用户数据）、
**纵深防御**（M4 与 M2/M3 互为兜底）、**可回滚**（每点有精确撤销锚点）、**零硬编码**（新偏移量为命名常量）。

---

## 4. 判别力实证（先红后绿，非事后补测）

新增 5 个场景/断言，逐个用"临时回退单点 → 对应断言先红"验证：

| 场景 | 回退哪一处 | 先红的断言 |
|---|---|---|
| S1 阈值兜底复活 | M1 | `a protocol turn alone must not arm the C5 gate (turn 1)` |
| S2a 中毒态仍放行 | M4 | `a poisoned flag must not block the threshold fallback (turn 12)` |
| S2b 页级 marker 自愈 | M2 | `a page-only marker clears the legacy structured flag` |
| S2c 投影重投毒不复发 | M3 | `the repair merge does not re-adopt a structured flag from a page-only projection` |
| kb 侧 9 条（end+1 接纳/边界/回退/落盘） | M6 | `a window-end+1 report with a completion claim is accepted` |
| S3 概念教材回归 | M1 若误删 `:740` 置位 | 通过（门闩仍武装、C5 告警恰好一次） |

---

## 5. 验证

| 项 | 结果 |
|---|---|
| `node --check` × 3 改动文件 | 通过 |
| 相关回归 15 项（auto-advance ×6 / kb-progress ×2 / progress-guard / exercise ×2 / jump-page-ocr-route / 手跑 `.next` ×3） | **全 PASS** |
| 全量矩阵 `tools/run-smoke-matrix.js` | **133 / 131 / 0 / 2**（与 V-10 基线一致，零回归） |

---

## 6. 生效状态

改动全在 server 原地加载的手写文件（`lib/**`，不受 `release-runtime-manifest.json` 哈希约束），
**重启即生效**；不涉及 ASAR 重打包、不涉及 manifest 哈希、无需同步模块 64092 的多定义。

⚠️ **本轮结束时应用尚未重启** —— 真机复测是本修复唯一未闭环的一步。

---

## 7. 回滚

按方案第八节逐点还原（M1 加回一行；M2/M3 去掉条件；M4 还原 `shouldForce` 两行；M5 还原断言；M6 删除钳制分支与常量）。
已写入状态的 `structuredTeachingProgress: false` 是合法值，旧代码按原语义读取，回到修复前行为，无额外风险。

---

## 8. 未完成

- **真机复测**（预期：delta 到 12 出现 `threshold_pre_turn` 换窗至 76–91，且不再出现 `reportedPage: 76` 整单拒收）。
- **阶段三**：翻 `PAGE_LEVEL_WINDOW_COMPLETE_ENABLED` 为 `true` 需先读 M6 的观测日志读数（申报是否集中在末页 ±1、
  `taught_page_regressed` 频率是否不高于基线、归一化申报是否伴随真实窗口尾部教学）。
- **阶段四**：完成信号词表未动（模型实际措辞"这一屏到这儿就讲完了"不在正则里）——属体验加固，不作正确性依赖。
- `markerDirective` 未动：是否告知模型"可以报窗口末页+1"，待观测日志后再定。

## 9. 证据

E-513 实机现场（第 851 代状态 + 三条日志）
E-514 根因定案（三断点，含精确行号）
E-515 判别力对照（5 条，逐条列出先红断言文案）
E-516 验证结果（3 file check + 15 项回归 + 矩阵 133/131/0/2）
E-517 M6 设计边界（只接纳 end+1 且必须显式 claim；end+2 与无声明仍拒签）
E-518 未做项（阶段三/四、应用未重启）
