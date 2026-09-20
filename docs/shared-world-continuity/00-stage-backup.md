# 阶段备份基线

创建时间：2026-09-15。  
原工作分支：`codex/push`。  
原 HEAD：`18b360e580f68a7bdcd676478c8af8d1c4b5db2b`。  
备份分支：`codex/stage-backup-20260915-world-lore-plan`。  
备份提交：`b8d171de0ab207e422d37a7d2b7e7b2123a8bf15`。  
备份树：`14fd71881a7bf70d7bd7f3adde5cae95ba748607`。

## 备份方式

备份使用独立临时 Git 索引，把创建方案前的整个非忽略工作树写成一棵 Git 树，再通过 `git commit-tree` 创建快照提交并建立独立分支。过程没有切换当前分支，没有清理工作树，也没有改变当前实际 Git 索引中已经暂存的内容。

快照包含当时所有已跟踪修改、已跟踪删除及不受忽略规则排除的未跟踪文件。下列项目按 `AGENTS.md` 与 `.gitignore` 保持在快照之外：

- `resources/settings.json`
- `resources/set.json`
- `resources/app.asar`
- `resources/bundled-content/`
- 被忽略的 `outputs/` 和临时数据

`resources/rules/rules_zh_classroom_compact.md` 是规则目录中允许提交的例外，已包含在快照中。

## 安全检查方式

查看快照而不改变当前工作树：

```bash
git show --summary --stat b8d171de0ab207e422d37a7d2b7e7b2123a8bf15
git ls-tree -r --name-only codex/stage-backup-20260915-world-lore-plan
```

需要完整打开备份时，优先建立独立工作树：

```bash
git worktree add ../Socratopia-stage-backup codex/stage-backup-20260915-world-lore-plan
```

不要为了查看备份在当前脏工作树执行 `git reset --hard`、`git clean` 或强制 checkout。恢复单个文件时先用 `git show <commit>:<path>` 查看内容，再决定是否覆盖当前文件。

## 备份边界

该快照是本地 Git 对象和本地分支，尚未推送到远程。它保护的是“方案设计之前”的工作状态，不包含本目录随后新增的设计文档。设计文档完成后如需第二个检查点，应另建新的快照，不移动或覆盖本分支。
