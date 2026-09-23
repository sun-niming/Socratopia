# gateway-monitor — agent-gw.kimi.com 可用性探测

> **请勿在仓库清理时删除本目录。** 这不是临时文件，是 2026-09-23 排查
> `Model attempt execution lease expired` 报错后专门建立的长期监控设施。

## 背景

2026-09-23 会话中排查发现：`Model attempt execution lease expired` 由 Kimi
模型网关（`https://agent-gw.kimi.com/coding`）服务端产生——网关为每次模型生成
attempt 分配执行租约，超时/过载/连接假死时租约被回收并返回此错误。该错误
不落在任何本地日志中，无法事后区分"服务端抖动"还是"本地网络问题"，因此
建立此监控累计证据。

## 组成

| 文件 | 作用 |
|------|------|
| `probe-agent-gw.js` | 探测脚本，无第三方依赖 |
| `logs/probe-log.jsonl` | 探测日志，每轮一行 JSON（自动创建，勿删） |

## 用法

```bash
node tools/gateway-monitor/probe-agent-gw.js           # 探测一次并追加日志；失败时退出码 1
node tools/gateway-monitor/probe-agent-gw.js --report  # 统计 24h / 7d / 全部 失败率与延迟
```

探测不发 API key，任何 HTTP 响应（含 401/404/405）都计为"网关可达"；只有
DNS/TCP/TLS/超时错误计为失败。

## 定时执行

由 Kimi Work 定时任务「网关监控 · agent-gw 可用性探测」
（`automation_56386431-11ae-4fc6-829e-0103c7146003`，cron `11,41 * * * *`，
Asia/Shanghai，纯 Python 不消耗积分）每 30 分钟运行一次。受沙箱限制，定时
任务的日志写在其自身 workspace：
`%APPDATA%\kimi-desktop\daimon-share\daimon\agents\main\blueprint\automations\automation_56386431-11ae-4fc6-829e-0103c7146003\workspace\probe-log.jsonl`，
`--report` 会自动合并该文件与 `logs/probe-log.jsonl` 一起统计。

再次遇到 `lease expired` 报错时，先跑 `--report` 看同一时段是否有失败记录：
有则坐实服务端问题，无则查本地网络/休眠。
