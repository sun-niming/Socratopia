# docs/external/ — 与 Socratopia 无关但保留的外部材料

这个目录只放**与本项目无关、但曾经被误提交进仓库根目录**的材料。保留它们的唯一理由是取证连续性：项目重建期的证据台账（[`../project-reconstruction/EVIDENCE.md`](../project-reconstruction/EVIDENCE.md) E-013、E-093、E-350）把"根目录混入了非本项目文件"记成一条已证实的风险，文件如果直接消失，这条证据链就断了。

| 文件 | 原位置 | 内容 | 处置 |
|---|---|---|---|
| `webserver-homework-context.md` | 根目录 `上下文.md` | `C:\Users\ASUS\webserver` 的一次 C 语言 + Linux Socket HTTP 服务器作业的项目上下文（8 575 B，2026-08-31） | 2026-11-03 从根目录移入；内容一字未改，只是加了本目录的说明 |

判定依据（`docs/project-reconstruction/OPEN-QUESTIONS.md` Q-005 已解答、Q-046 仍为待确认）：该文件讲的是另一个项目的作业，与 Socratopia 的产品/运行时无关；但它确实被 git 跟踪过、也确实出现在 2026-08-31 的跟踪清单里。

对上游问题的回答：它不是"有意保留的对照材料"，而是**误放**。但因为仓库已公开、而它含有本机绝对路径与作业内容，最小代价的处理是移出根目录并保留证据，而不是删掉。
