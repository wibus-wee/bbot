# Optimize Agent Tool Definitions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md lives at `.agents/PLANS.md` in the repository root. This document must be maintained in accordance with that file.

## Purpose / Big Picture

完成本次改动后，Agent 的内置工具定义将从单文件“堆在一起”的状态整理为模块化结构，行为更一致，输出更可控（截断与提示），并补齐 `grep`/`find`/`ls` 这类基础探索工具。用户将获得更稳定、更可预测的工具输出，并且工具层更容易扩展或替换。验证方式是：在测试中调用新增的工具执行器方法、构建系统提示并确认工具列表与描述符合预期。

## Progress

- [x] (2026-02-13 20:30Z) Draft ExecPlan, gather current tool and executor context.
- [x] (2026-02-13 21:05Z) Refactor agent tool definitions into per-tool modules with shared helpers.
- [x] (2026-02-13 21:12Z) Extend tool executor with grep/find/ls support and remove search.
- [x] (2026-02-13 21:18Z) Update system prompt descriptions/guidelines and adjust tests.
- [x] (2026-02-13 21:22Z) Add or update tests for new executor behaviors and tool list output.
- [ ] Run `pnpm test` to validate updated tool behavior.

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: 借鉴 pi-mono 的工具分层与输出截断策略，并彻底用 `grep` 替代 `search`。
  Rationale: 避免工具语义重复，减少维护面，促使使用者统一为 `grep/find/ls` 的明确边界。
  Date/Author: 2026-02-13 / Codex

- Decision: `grep` 与 `find` 默认基于 `rg` 实现，以减少新依赖并保持与现有 search 一致的行为与性能特征。
  Rationale: 本仓库已依赖 `rg`，新增 `fd` 会引入安装与可用性差异。
  Date/Author: 2026-02-13 / Codex

## Outcomes & Retrospective

尚未完成实现。

## Context and Orientation

当前工具定义集中在 `packages/agent/src/tools.ts`，通过 `createToolExecutor`（`packages/adapters/src/runner/index.ts`）访问文件系统与 `rg`。系统提示对工具的描述与指南位于 `packages/agent/src/system-prompt.ts`，并有对应测试在 `packages/agent/src/__tests__/system-prompt.test.ts`。本次改动将以 pi-mono 的工具设计为参考，拆分工具定义，加入输出截断与更细粒度的工具集合，同时保持路径安全与工作区约束。

## Plan of Work

首先把 `packages/agent/src/tools.ts` 拆分为 `packages/agent/src/tools/` 目录下的独立模块（read/write/edit/bash/grep/find/ls），并新增共享的截断与输出格式化工具（例如 `truncate.ts`）。`createAgentTools` 将移到 `packages/agent/src/tools/index.ts` 并继续提供兼容导出。每个工具将以清晰的参数 schema 与统一的返回结构输出，并在必要时追加可操作的截断提示。

其次扩展 `packages/adapters/src/runner/index.ts`：在 `ToolExecutor` 上增加 `grepFiles`、`findFiles`、`listDir` 能力；实现时复用现有的 `resolveWorkspacePath` 与 `spawnCommand`，确保路径安全与一致的错误处理，并删除 `searchFiles` 兼容层。

然后更新 `packages/agent/src/system-prompt.ts`，补齐新的工具描述与指南（优先使用 `grep`/`find`/`ls` 做探索，必要时再用 `bash`）。同时更新 `packages/agent/src/__tests__/system-prompt.test.ts` 与 `packages/adapters/src/runner/__tests__/executor.test.ts`，覆盖新增工具输出与行为。

## Concrete Steps

在仓库根目录执行以下命令：

    rg -n "createAgentTools|ToolExecutor" packages/agent packages/adapters

完成实现后，运行测试：

    pnpm test

如果 `rg` 在环境中不可用，相关测试应跳过并在测试日志中明确说明。

## Validation and Acceptance

通过以下方式确认改动生效：

1. 运行 `pnpm test` 并观察 `packages/adapters/src/runner/__tests__/executor.test.ts` 新增用例通过。
2. 运行 `packages/agent/src/__tests__/system-prompt.test.ts`，确认工具列表包含 `grep`/`find`/`ls`，且工具描述与指南符合预期。
3. 若需要手工验证，调用 `createAgentTools` 构建工具列表并检查描述与顺序，确认输出截断提示可读且可操作。

## Idempotence and Recovery

本次改动是纯代码重构与增量实现，重复执行无副作用。若某一步实现出现错误，可回退到最后一次通过测试的提交，并重新按本计划拆分与实现。

## Artifacts and Notes

如需在评审中展示关键变化，可提供以下片段作为证据：

- `packages/agent/src/tools/index.ts` 中导出的工具列表与创建函数。
- `packages/adapters/src/runner/index.ts` 中新增的 `grepFiles`/`findFiles`/`listDir` 实现签名。
- `packages/agent/src/system-prompt.ts` 中工具描述与指南片段。

## Interfaces and Dependencies

需要在 `packages/adapters/src/runner/index.ts` 中定义或扩展以下接口：

- `export type GrepToolInput = { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number }`
- `export type FindToolInput = { pattern: string; path?: string; limit?: number }`
- `export type LsToolInput = { path?: string; limit?: number }`
- `export type ToolExecutor = { ...; grepFiles: (input: GrepToolInput) => Promise<{ matches: string }>; findFiles: (input: FindToolInput) => Promise<{ matches: string }>; listDir: (input: LsToolInput) => Promise<{ entries: string[] }>; }`

在 `packages/agent/src/tools/` 目录下新增或迁移：

- `read.ts`, `write.ts`, `edit.ts`, `bash.ts`, `grep.ts`, `find.ts`, `ls.ts`, `truncate.ts`, `index.ts`

计划更新说明（2026-02-13 / Codex）：按用户要求切换为激进路径，移除 `search` 兼容层，仅保留并标准化 `grep/find/ls`。

每个工具保持 TypeBox schema 与 `AgentTool` 输出结构一致，并确保输出为 `content` + 可选 `details`。
