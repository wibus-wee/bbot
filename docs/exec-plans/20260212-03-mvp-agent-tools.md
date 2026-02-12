# MVP Agent Runtime：pi-mono 集成、Tools 执行与 Run 编排

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划建立在 `docs/exec-plans/20260212-01-mvp-foundation.md` 与 `docs/exec-plans/20260212-02-mvp-core-api-openapi.md` 已完成的基础之上。

## Purpose / Big Picture

完成本计划后，core-daemon 可通过 pi-mono 运行 Agent，Agent 能调用 `read`、`write`、`edit`、`search`、`bash` 五类工具，并将工具调用与 Run 事件落盘。系统能从技能目录加载 SKILL.md，并在权限策略下限制外部技能使用 `bash`。用户可以通过 API 触发 Run 并看到日志逐步更新。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [ ] (2026-02-12 00:00Z) 完成 pi-mono agent loop 与工具调用闭环。
- [ ] (2026-02-12 00:00Z) 完成工具执行器与安全策略（含 bash allowlist）。
- [ ] (2026-02-12 00:00Z) 完成技能加载与权限边界。
- [ ] (2026-02-12 00:00Z) 完成 Run 调度与事件持久化联动。

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: Agent runtime 基于 `@mariozechner/pi-ai`，使用工具调用事件驱动执行。
  Rationale: 与项目定位一致，且工具调用模型清晰可审计。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: 工具集合固定为 `read`、`write`、`edit`、`search`、`bash`。
  Rationale: MVP 只需要最小确定性原语，便于审计与复现。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: 外部技能默认禁止 `bash`，通过 allowlist 明确放行。
  Rationale: 降低外部技能带来的执行风险。
  Date/Author: 2026-02-12 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

`packages/agent/src/index.ts` 目前为空，需要引入 pi-mono 的模型与工具调用循环。`packages/adapters` 为空，将成为工具执行层。`packages/core` 中已有 Run 状态机与工具执行记录接口，但仍是内存实现，需要在 Run 调度时落盘与派发事件。`packages/domain` 已定义 Run、RunEvent、ToolExecution 等结构，但名称仍需保持与 WorkspaceSession 一致。

## Plan of Work

先在 `packages/agent` 中实现一个最小可运行的 pi-mono agent runner。该 runner 需要：输入系统提示词与上下文、定义工具列表、处理工具调用事件并调用工具执行器，然后将结果回填到上下文继续推理。为降低风险，先新增一个独立的 smoke 脚本用于验证 pi-mono 工具调用是否可用，再与 core-daemon 的 Run 逻辑对接。

随后实现工具执行器在 `packages/adapters`。`read`、`write`、`edit`、`search` 必须限制在仓库根目录内并防止路径逃逸；`search` 推荐直接调用 `rg` 来保证性能；`edit` 必须使用确定性补丁格式（统一 diff）并返回失败原因；`bash` 必须通过 allowlist 控制可执行命令，并记录完整 stdout/stderr。

技能加载器应扫描 `packages/agent/skills`、`./.agents/skills` 与 `~/.agents/skills`，读取每个 `SKILL.md` 并抽取名称、描述、允许工具等元信息，最终构建为 Agent 可用的技能提示词与权限集合。外部技能的 `bash` 默认禁用，只有显式列入 allowlist 才允许。

最后在 `packages/core` 中实现 Run 调度器与 Agent 绑定。调度器接收 Run，创建事件、触发 Agent runner、记录工具调用、更新 Run 状态，并将事件推送到 SSE。此处需要确保错误路径可追踪，并在 Run 失败时写入失败原因。

## Concrete Steps

安装依赖并运行 pi-mono smoke 脚本：

    pnpm install
    pnpm --filter @bbot/agent run agent:smoke

启动 core-daemon 后触发 Run：

    curl -i -H "Authorization: Bearer $CORE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"prompt":"create a file README.md with hello"}' \
      http://localhost:3001/workspaces/<id>/runs

订阅 Run 日志：

    curl -N -H "Authorization: Bearer $CORE_API_TOKEN" \
      http://localhost:3001/runs/<runId>/stream

## Validation and Acceptance

当触发 Run 时，Run 状态从 queued 到 running，再到 succeeded 或 failed，并在 SSE 中依次看到 `run.started`、`tool.executed` 与 `run.completed` 等事件。`read`、`write`、`edit`、`search` 的工具调用结果应被记录到数据库，并在 Run 查询接口中可回放。

## Idempotence and Recovery

工具执行器必须在失败时返回明确错误，不应留下半写入文件。`edit` 失败时不应修改原文件。`bash` 执行失败时仍需落盘日志。Run 失败可通过重试触发新 Run，不回滚旧记录。

## Artifacts and Notes

SSE 事件期望示例：

    event: run.started
    data: {"runId":"run_xxx"}

    event: tool.executed
    data: {"tool":"write","path":"README.md"}

## Interfaces and Dependencies

本计划依赖 `@mariozechner/pi-ai`、TypeBox（用于工具参数定义）、`p-queue`（用于 Run 队列）、以及 Node 的文件与进程 API。工具执行接口建议统一为 `executeTool(name, input, context)` 并返回 `{ output, logs }`。技能加载器应输出结构化对象，至少包含 `id`、`title`、`description`、`allowedTools` 与 `content`。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/pi-mono/SKILL.md`、`.agents/skills/pi-coding-agent/SKILL.md`、`.agents/skills/typescript/SKILL.md`。
