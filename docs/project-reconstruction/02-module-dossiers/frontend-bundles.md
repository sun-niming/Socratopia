# 模块档案：前端产物与"五包同步"机制

> 阶段 C 档案 6/…（批次 C-5，2026-09-14）。证据 E-240 ~ E-252。
> **本档案解开了 Q-011，也解释了记忆中"5 包同步约束"的由来。**

---

## 1. 结论先行（三条，均已证实）

1. **仓库里有 5 个约 760 KB 的页面 bundle，但浏览器只加载其中 1 个**（`page-87daa6ca210ab9dc.js`）。
2. 5 个 bundle **被同一批脚本按相同的 needle 逐个打补丁**，再由 smoke test 逐个断言"都含相同字符串"来保证一致。
3. 即：**补丁面 5× ，运行面 1×**。这是本仓库最典型、也最昂贵的一处工程债。

---

## 2. 事实与证据

### 2.1 五个 bundle

| 文件 | 大小 | 是否被浏览器加载 |
|---|---|---|
| `page-87daa6ca210ab9dc.js` | 769,607 B | **是** —— 是唯一出现在 `route_client-reference-manifest.js` 里的页面 chunk（E-240） |
| `page-3a1fef7566e26c43.js` | 770,124 B | 否 |
| `page-practice-ui-20260622.js` | 761,858 B | 否 |
| `page-practice-ui-20260625-jyfix.js` | 761,510 B | 否 |
| `page-practice-ui-20260626-postclass-notes.js` | 761,510 B | 否 |

**判定方法（E-240）**：
- 在 `resources/server/.next/` 全库（排除 `*-smoke-test.js`）统计引用：`page-87daa6ca210ab9dc.js` = **33 次**；其余 4 个 = **0 次**。
- 5 个 `route_client-reference-manifest.js` 中只出现 `static/chunks/app/page-87daa6ca210ab9dc.js` 与 `layout-2ee9395c59630c5a.js`。

### 2.2 补丁工具按 5 个目标硬编码（E-241）

`tools/remediate-tutoring-ui-bundles.js`:
```js
var pages = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
].map(...);
function replaceOnce(source, needle, replacement, label, file) {
  var count = source.split(needle).length - 1;
  if (count === 1) return source.replace(needle, replacement);
  if (count === 0 && source.indexOf(replacement) >= 0) return source;  // 幂等
  throw new Error(path.basename(file) + ": expected one " + label + ", found " + count);
}
pages.forEach(function (file) { ... });
```
→ **同一段补丁对 5 个文件各执行一次**，并带幂等短路与"恰好命中一次"校验。同类工具还有 `remediate-continuity-bundles.js`、`synchronize-account-helper-bundles.js`、`synchronize-frontend-capability-helper.js`、`harden-frontend-stale-retry.js`、`repair-kuvt.js`、`patch-close-reading.js`。

### 2.3 smoke test 把"5 个都含某字符串"当作断言（E-242）

8 个前端 smoke test（在 `.next/static/chunks/app/` 内）都这样做：
```js
const bundles = ["page-87daa6ca210ab9dc.js","page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js","page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"];
for (const name of bundles) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  assert(source.includes("SocratopiaGeneratio..."), ...);
}
```
例：`device-status-binding-smoke-test.js`、`llm-generation-lifecycle-smoke-test.js`、`voice-early-stream-smoke-test.js`、`voice-emotion-client-smoke-test.js`、`voice-runtime-invariants-smoke-test.js`、`voice-replay-smoke-test.js`、`voice-stream-backpressure-smoke-test.js`、`voice-stream-error-containment-smoke-test.js`。

→ **一致性靠"字符串有没有出现"来保证**，而不是靠构建。

---

## 3. 为什么会长成这样（合理推断）

1. webpack 产出的是内容哈希名，人工改完后**无法回写哈希**，所以改过的那份需要一个可读名字 → 于是出现 `page-practice-ui-<日期><用途>.js`（E-152）。
2. 无源码、无构建，**没人能确定 Next 究竟会加载哪一个**（早期可能确实是另一份），于是选择"**5 个全打**"这一最省事的确定性策略。
3. 打了就得保持一致，于是再写 smoke test 断言"5 个都有"。
4. 日积月累：每加一个前端改动 = 改 5 个 760 KB 文件 + 可能再加一个断言。

> 注意 §3 第 2 步是**推断**：没有文档说明为什么是 5 个。也可能是"历史上一度真的加载过多份"。

---

## 4. 风险

| 风险 | 说明 |
|---|---|
| **改漏一个 = 部分场景行为不一致** | 若哪天真加载了别的 bundle，未同步的那个会暴露旧行为。当前靠 smoke 兜底 |
| **`replaceOnce` 抛错即中断** | 5 个文件里只要有一个 needle 命中数 ≠1，脚本整体失败——这是**好事**（fail loud），但也意味着 5 个文件的内部结构必须长期保持一致 |
| **体积浪费** | 4 × ~760 KB ≈ 3 MB 死重；`resources/server` 体积随之膨胀，也拖慢 `release-runtime-manifest.json` 校验 |
| **认知负担** | 新人会以为 5 个各有分工（名字暗示 `practice-ui`、`postclass-notes`），实际全是同一页面的镜像 |
| **归属难判** | 光看名字无法判断哪份是最新；要靠 `ls -la` 时间或内容 diff |

---

## 5. 对后续工作的操作含义

- **改前端任何逻辑**：默认要改 **5 个文件**，优先用 `tools/` 里现成的批量补丁脚本（它们带幂等与命中校验），或照抄其 `replaceOnce` 模式。
- **判断"某前端功能在不在"**：只需查 `page-87daa6ca210ab9dc.js`（唯一运行件），但要**改**就得改 5 个。
- **绝不要**只按文件名猜功能分工。
- 想确认同步状态：跑 `.next/static/chunks/app/` 下的 8 个前端 smoke test。

---

## 6. 前端结构其余事实

- 主页面 chunk 属于**本体产物**；分支在其上加锚点（E-189 的前端对应物）。
- 前端唯一的分支业务适配器是 `adaptiveFetch()`（E-206）：取 `window.electronAPI.getAdaptiveCapability()` → 带 `Authorization: Socratopia <cap>` POST；失败码 `adaptive_auth_unavailable`。
- 前端另有 `layout-2ee9395c59630c5a.js`（7.7 KB，2026-06-02，未改过 → 本体原件）。
- 前端 smoke test 有 **8 个，且直接躺在 chunk 目录里**（混在产物中），`tools/run-smoke-matrix.js` 是否覆盖 `.next/` 下的它们——**已知该矩阵跳过 `.next/`**（记忆条目），故**必须在改前端后手动跑**。

---

## 7. 重构建议（阶段 E 展开）

1. **先确认一个事实再动手**：是否真的只有 `page-87daa6ca210ab9dc.js` 被加载。若是，则其余 4 个可标注"镜像"。
2. **保留 5× 但自动化**：把 `pages` 数组提取为单一来源（如 `tools/frontend-bundles.js`），所有补丁脚本与 smoke test 共用，避免各自硬编码。
3. **中期**：评估"只补运行件 + 启动时镜像"或"补完后从运行件复制生成其余 4 份"，把手工同步降为自动。
4. **验收条件**：任选 3 个既往前端补丁，用新机制重放，5 个 bundle 的 diff 结果与现状一致。

---

## 8. 证据
E-240 引用计数与 client-reference-manifest 内容（§2.1）
E-241 `tools/remediate-tutoring-ui-bundles.js` 的 `pages` 数组与 `replaceOnce`
E-242 8 个前端 smoke test 的 `bundles` 数组与断言写法
E-243 `ls -la .next/static/chunks/app/*.js` 全清单与字节数
E-244 E-152（补丁 chunk 的出现）、E-206（`adaptiveFetch`）

## 9. 待确认
- Q-033：5 个 bundle 是否有过"真的多份都被加载"的历史？现在是否可只留 1 份？
- Q-034：`replaceOnce` 的 5 个文件内部结构为何能长期一致——是否有生成步骤，还是纯靠手工同步？
