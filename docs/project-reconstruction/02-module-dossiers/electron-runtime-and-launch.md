# 模块档案：Electron 运行时与启动链路

> 阶段 C 档案 1/…。证据：E-040 ~ E-042、E-100 ~ E-107。
> 本档案的 Q-004 结论**已由代码实测证实**，不是推断。

## 1. 用途与所属流程

应用最外层。职责：单实例锁、创建 BrowserWindow、派生 Next.js 子进程、提供原生能力（密钥、PDF 导出、设备号、能力令牌）、自愈修复运行时不完整、退出清理。

**用户流程位置**：双击 `Socratopia.exe` → 加载页 → 窗口就绪 → 前端通过 `preload.js` 暴露的 `window.electronAPI` 调原生能力。

## 2. 实现位置

| 项 | 路径 |
|---|---|
| 运行时真实来源 | `resources/app.asar` → `dist-electron/main.js`、`dist-electron/preload.js`、`package.json`（**仅此三文件**，E-042） |
| 仓库内开发副本 | 根 `main.js`（1388101 B，esbuild 产物）、根 `preload.js`（2547 B） |
| ASAR 解包工作副本 | `_asar_extracted/dist-electron/{main.js,preload.js}` |
| 重打包工具 | `npx asar pack` + `fix-asar-integrity.js`（**注意：该脚本已被 `4f1f907` 删除，见 E-092**） |

> 根 `main.js` 与 `_asar_extracted` 版本**内容长度不同**（1388101 vs 1388056），说明二者不同步。且 `fix-asar-integrity.js` 已被删除但 `AGENTS.md`/`CLAUDE.md` 仍在引用。

## 3. 运行入口与路径解析（**Q-004 已解答**）

**结论：server 是"原地运行"，不复制。`CLAUDE.md` 正确，`AGENTS.md` 第 49 行的"复制到用户目录"错误。**

证据（E-100/E-101，锚点：`main.js` 中 `async function prepareServerDir()`）：

```js
function getBundledServerDir() { return path.join(process.resourcesPath, "server"); }  // = resources/server/
async function prepareServerDir() {
  const bundled = getBundledServerDir();
  const depsZip = path.join(bundled, "deps.zip");
  const bundledNodeModules = getServerNodeModulesPath(bundled);   // = bundled/.next/node_modules
  verifyRuntimeManifest(bundled);
  const intact = nodeModulesIntact(bundledNodeModules, bundled);
  if (!intact) { await ensureNodeModules(depsZip, bundledNodeModules, bundled); }
  ...
  return bundled;                                                // ← 返回 bundled，不是副本
}
async function startServerOnce(port) {
  const serverDir = await prepareServerDir();
  serverProcess = fork(path.join(serverDir, "server.js"), [], { cwd: serverDir, env: {...} });
}
```

**推论（已证实）**：
- 改 `resources/server/**` **重启应用即生效，无需重打包**。
- 唯一的"复制"发生在 `resources/server/.next/node_modules`：仅当完整性校验失败时，从 `resources/server/deps.zip`（36MB）解压覆盖。
- `%APPDATA%/<userData>/server/.version` 是版本标记文件（实测存在，`.version` 5 字节）。
- **应用会写入自己的安装目录**（`resources/server/.next/node_modules` 可能被 wipe 重建，锚点 `wipeRuntimeServerDir()`）→ 已解包/已安装目录不是只读的。

## 4. 启动链路关键参数

| 项 | 值 | 锚点 |
|---|---|---|
| 端口 | `serverPort = 3000`（字面量 `3e3`） | `var serverPort = 3e3;` |
| fork 目标 | `<resources/server>/server.js` | `startServerOnce` |
| cwd | serverDir | 同上 |
| 环境变量 | `PORT`、`HOSTNAME=127.0.0.1`、`NODE_ENV=production`、自适应鉴权密钥 B | 同上 |
| 单实例 | `app.requestSingleInstanceLock()`，失败即 quit | 主进程顶部 |
| localhost 映射 | `appendSwitch("host-resolver-rules","MAP localhost 127.0.0.1")` | 同区域 |
| 退出 | `before-quit` 时 `serverProcess.kill()`，并清理 `userData/project-data/tts-cache` | 文件末尾 |
| 端口冲突 | 自定义 `PortConflictError`，冲突时 kill 子进程并抛出 | `startServer` |

**已证实（E-102）**：代码注释引用了 `v109.md §主题 3`，说明存在一份**按版本编号的变更文档 `v109.md`，当前不在仓库中**（→ Q-019）。

## 5. 数据与路径契约（`getUserDataPath` 区域，E-103）

```js
function getBundledContentPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "bundled-content")
                        : path.resolve(__dirname, "..");
}
function getUserDataPath() {
  return app.isPackaged ? path.join(app.getPath("userData"), "project-data")
                        : path.resolve(__dirname, "..");
}
```
- **已证实**：`bundled-content` 与 `project-data` 是分离的两棵根，前者只读随包，后者在 userData。
- `ACCOUNTS_DIR_NAME` 常量定义在 accounts 初始化处。
- 另有 `initUserData()` 在首次运行时创建 `accounts` 目录。

## 6. 自适应鉴权能力令牌

- 锚点：`SOCRATOPIA_ADAPTIVE_AUTH_ISSUER`、`SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B`、`audience: "adaptive-teaching"`、`scope: { accountId }`、`prepareAdaptiveAuthSession(serverDir)`、`adaptiveAuthGeneration/Sequence/Epoch/Session`。
- 与 `2c09aca Add secure adaptive auth capability handshake`（2026-08-23）对应。
- 对应服务端：`resources/server/lib/local-request-auth.js`、`route-auth.js`、`account-request-context.js`。
- **合理推断**：密钥 B 通过 fork env 传给服务端，服务端据此验证 Electron 签发的短时令牌。**尚未读服务端侧实现，属待确认**。

## 7. 自愈机制（本模块最复杂的部分）

| 函数 | 行为 |
|---|---|
| `verifyRuntimeManifest(bundled)` | 按 `release-runtime-manifest.json`（494KB）校验 |
| `nodeModulesIntact()` | 逐个校验 manifest 中 node_modules 条目；目录必须非符号链接 |
| `ensureNodeModules()` | 建 repair 临时目录 → 从 deps.zip 解压 → rename 到目标；失败则回滚 backup |
| `wipeRuntimeServerDir()` | 三重安全护栏（必须绝对路径、basename 必须是 `node_modules`、非符号链接）+ 退避重试 |
| `startServer()` | 首次失败 → kill 子进程 → 等 2s → wipe → 重试 |

**风险（重构建议）**：`ensureNodeModules` / `wipeRuntimeServerDir` 会 **rm/replace `resources/server/.next/node_modules`**。若开发者手工往该目录放了东西，应用启动时可能被清掉。

## 8. 与其他模块的关系

- → `resources/server/server.js`（fork 目标，`cwd` 为其目录）
- → `preload.js` → `window.electronAPI`（IPC 面）
- → `%APPDATA%/<userData>/project-data`（用户数据根）
- → `resources/bundled-content`（只读种子）
- ← 依赖 `resources/server/deps.zip` + `release-runtime-manifest.json`

## 9. 实现与验证状态

- **实现**：完整、活跃（2026-08-30 仍在改）。
- **验证**：`resources/server/adaptive-auth-state-ipc-smoke-test.js`、`electron-adaptive-capability-smoke-test.js`、`electron-runtime-manifest-verifier-smoke-test.js`、`release-runtime-manifest-smoke-test.js`、`main-log-resilience-smoke-test.js`（在 `tools/`）。**本批未执行**。

## 10. 重复、耦合、遗留

- **未证实但高度可疑**：Electron 层被设计为"同时维护根副本与 ASAR 副本"（AGENTS.md/L-47），这是**双份人工同步**，无自动化保证一致。
- 根 `main.js` 与 `_asar_extracted` 已不同步（长度不同）。
- `SOCRATOPIA_DESKTOP_DATA_DIR` 在 `main.js` 中**未出现**，但 `/e/huanjing/AAA/Start-Socratopia.cmd` 设了它（E-071）→ 该环境变量**可能未被当前版本读取**（→ Q-020）。

## 11. 证据与待确认

- E-100 `main.js` `prepareServerDir()` / `getBundledServerDir()` / `startServerOnce()`（锚点可搜索）。
- E-101 实测 `%APPDATA%/socratopia/server/.version` 存在；`resources/server/.next/node_modules/` 存在。
- E-102 注释引用 `v109.md §主题 3`（文件不在仓库）。
- E-103 `getUserDataPath` / `getBundledContentPath` / `initUserData`。
- 待确认：Q-006（启动加载哪份 asar）、Q-019（`v109.md`）、Q-020（`SOCRATOPIA_DESKTOP_DATA_DIR`）、鉴权令牌服务端侧实现。
