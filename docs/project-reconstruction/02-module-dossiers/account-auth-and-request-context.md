# 模块档案：账号、鉴权与请求上下文

> 阶段 C 档案 2/…。证据：E-100（签发侧）、E-130、E-140 ~ E-148。
> 与 `electron-runtime-and-launch.md` §6 是同一链路的服务端一半。

## 1. 用途与所属流程

**每一条非公开 API 请求的门禁**。职责：验证 Electron 主进程签发的短时能力令牌 → 取出已认证 `accountId` → 校验请求声明的资源 scope 是否落在该账号内 → 把账号上下文沿异步调用链传递。

**用户流程位置**：看不见但对所有功能生效。用户在前端做任何操作 → 请求带 `Authorization: Socratopia <jwt>` → 本模块放行或 403。

## 2. 实现位置

| 文件 | 行数 | 角色 |
|---|---|---|
| `resources/server/lib/local-request-auth.js` | 421 | **验证器**：JWT 解析、HS256 验签、claims 校验、scope 断言、`AuthError` |
| `resources/server/lib/route-auth.js` | 152 | **门禁 facade**：`createRouteAuth` → `authenticate` / `dispatch` / `extractScope` |
| `resources/server/lib/account-request-context.js` | 44 | AsyncLocalStorage 账号上下文 |
| `resources/server/server.js` L905-930 | — | 装配点（见 §3） |
| 签发侧 | — | Electron `main.js`（E-105），本档案 §6 |

**测试**：`local-request-auth-smoke-test.js`、`route-auth-smoke-test.js`、`account-request-context-bundle-smoke-test.js`、`chat-auth-contract-smoke-test.js`、`sensitive-api-auth-contract-smoke-test.js`、`electron-adaptive-capability-smoke-test.js`、`adaptive-auth-state-ipc-smoke-test.js`。本批未执行。

## 3. 装配（`server.js` L905-930，已证实）

```js
;(function registerAdaptiveTeachingRuntime() {
  var auth = require("./lib/local-request-auth.js");
  var accountRequestContext = require("./lib/account-request-context.js").createAccountRequestContext();
  global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = accountRequestContext;
  var encodedSecret = process.env.SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64 || "";
  try { if (encodedSecret) secret = Buffer.from(encodedSecret, "base64"); } catch (_) {}
  delete process.env.SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64;      // ← 读后即从 env 删除
  var verifier = auth.createVerifier({ secret, issuer: "socratopia-electron",
                                       audience: "adaptive-teaching", currentAuthState: null });
  secret.fill(0); secret = null;                               // ← 密钥字节清零
  var routeAuth = require("./lib/route-auth.js").createRouteAuth({ verifier, accountRequestContext });
  global.__SOCRATOPIA_ROUTE_AUTH__ = routeAuth;
  global.__SOCRATOPIA_REQUEST_AUTH__ = routeAuth;              // ← 同一对象挂两个名字
})
```

**关键点**：
- 装配在 Next 启动**之前**完成。代码注释明说原因：
  > "It is installed before Next starts so a request can never race a lazy route import and fall back to X-Account-Id/query account selection."
- **`global.__ROUTE_AUTH__` 不存在**（`CLAUDE.md` 的 global 表写错了）；实际是 `__SOCRATOPIA_ROUTE_AUTH__` 与 `__SOCRATOPIA_REQUEST_AUTH__`（同一对象）。
- 密钥通过 fork 的子进程 env 传入，**读后立即 `delete process.env`**，再 `Buffer.fill(0)` —— 防泄漏。
- 消费方：`.next/server/app` 下 **12** 个文件 + `.next/server/chunks` 下 **1** 个（已证实）。

## 4. 门禁行为（`route-auth.js`）

| 项 | 值 | 锚点 |
|---|---|---|
| 唯一公开路径 | `{ "/api/account/init": true }` | `PUBLIC_BOOTSTRAP_PATHS` |
| scope 键 | `["profileId","worldId","textbookId","conversationId"]` | `SCOPE_KEYS` |
| scope 来源 | **query 参数或 body**（`profileId` 等） | `extractScope` / `queryValue` |
| accountId 来源 | **仅令牌**（不接受 header/query/body） | `authenticate` → `verifier.verifyRequest` |
| 失败策略 | fail-closed：验签器缺失 → `auth_unavailable` 503；其余 → 403/400 | `authenticate` / `safeError` |
| 非 HTTP 请求 | **直接放行**（给 smoke test 用） | `dispatch`: `if (!isHttpRequest(request)) return handler(...)` |
| 错误体 | `{ error:{code,message,status,traceId}, code, message, traceId }` + `Cache-Control: private, no-store` | `errorResponse` |
| traceId | 单调计数器 + 时间戳 base36 | `newTraceId` |

**特殊映射**（`extractScope` L54-56，属历史补丁痕迹）：
- `/api/profile/avatar` 用 query/body 的 `id` 当 `profileId`
- `/api/profile`、`/api/profile/reset` 用 body 的 `profileId`
- 注释明说：其他路由的 `id` 是对象 id，**故意不猜**成 profile/account

**失败码**（`local-request-auth.js`）：`AuthError(code, status)`，已知码含 `scope_invalid`、`auth_invalid`、`auth_unavailable`。

## 5. 已知的重复实现风险

`route-auth.js` 头部注释（L2-4）：
> "Keeping this logic in one module prevents **the five inlined account-helper copies** from drifting semantically."

即除模块 64092（8 处）外，**还有 5 份内联的 account-helper 副本**分布在编译产物里。
`install-route-auth-wrappers.js`（`tools/`）与 `harden-adaptive-route-scope.js` 是配套的批量包装脚本。
→ **这是第二条"必须同步多处"的硬约束**，`CLAUDE.md`/`AGENTS.md` 均未记载。

## 6. 签发侧（Electron，E-105）

- env `SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64` 由 `main.js` 在 fork 时注入。
- issuer `socratopia-electron`、audience `adaptive-teaching` —— **两侧字面量必须一致**。
- 令牌**账号绑定**，带显式 scope envelope；代码注释强调"wildcards here mean the current local account, never another account"。
- 账户 id 目前硬编码常量 `ADAPTIVE_AUTH_ACCOUNT_ID = "local"`（E-105）→ **单账号假设**，与 `%APPDATA%/project-data/accounts/` 的多账户目录结构并存。

## 7. 与其他模块的关系

- 被 **13 个编译产物文件**调用（12 app + 1 chunk）。
- → `account-request-context.js` → AsyncLocalStorage → 下游所有落盘模块据此定位 `accounts/<accountId>/...`。
- ← 依赖 Electron `main.js` 的 fork env（§6）。
- 与 `lib/adaptive/*`、`kb-progress`、`practice` 等的账户隔离直接相关（`cb74cdd` 提交标题即 "Scope practice data and tutoring sessions by account"，E-090，**未合入当前分支**）。

## 8. 实现与验证状态

- **实现**：活跃且明确（`2c09aca` 引入，`06c0256`/`a86f4ca` 加固）。
- **验证**：7 个相关 smoke test 存在（§2），**本批未执行**。
- **未验证**：签发/验证两侧是否真正端到端跑通（需启动应用）。

## 9. 风险、遗留与重构建议

| 风险 | 依据 | 说明 |
|---|---|---|
| **多账户形同单账户** | `ADAPTIVE_AUTH_ACCOUNT_ID = "local"` 硬编码（E-105） | `accounts/` 目录支持多账号，但令牌恒为 `local`。真实多账户能力未知 |
| **`global.__ROUTE_AUTH__` 文档错误** | 实测 0 次命中 | 按文档写代码会引用到 undefined |
| **5 份内联 account-helper 副本** | `route-auth.js` 注释 | 改鉴权语义要同步 5 处 |
| **非 HTTP 请求直接放行** | `dispatch` 的 `isHttpRequest` 分支 | 设计上给 smoke 用；若生产路径存在无 URL 调用则绕过门禁（待确认） |
| **scope 从 query/body 取值** | `extractScope` | 与"accountId 只信令牌"形成不对称；若实现者误以为 scope 也受信，可能越权（**合理推断**） |
| **密钥清零后 verifier 是否仍可用** | `secret.fill(0); secret = null;` | `createVerifier({secret})` 是否已复制字节？若为引用则清零后验签失败。**已写 smoke test 但本批未跑 → 待验证** |

## 10. 证据与待确认

- E-140 `route-auth.js` 全文（152 行，`PUBLIC_BOOTSTRAP_PATHS`、`SCOPE_KEYS`、`dispatch`、`errorResponse`）
- E-141 `server.js` L905-930 装配段
- E-142 `local-request-auth.js` 函数清单（`createVerifier` / `authenticateRequest` / `assertTrustedAccount` / `scopeAllows`）
- E-143 实测：`global.__ROUTE_AUTH__` 0 命中；facade 被 12 个 app 文件 + 1 个 chunk 引用
- E-144 `account-request-context.js` 44 行
- 待确认：§9 密钥清零问题；多账户实际可用性；`isHttpRequest` 绕过是否在生产可达
