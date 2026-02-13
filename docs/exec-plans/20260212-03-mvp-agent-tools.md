# MVP Agent Runtime：pi-mono 集成、Tools 执行与 Run 编排

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划建立在 `docs/exec-plans/20260212-01-mvp-foundation.md` 与 `docs/exec-plans/20260212-02-mvp-core-api-openapi.md` 已完成的基础之上。

## Purpose / Big Picture

完成本计划后，core-daemon 可通过 pi-mono 运行 Agent，Agent 能调用 `read`、`write`、`edit`、`search`、`bash` 五类工具，并将工具调用与 Run 事件落盘。系统能从技能目录加载 SKILL.md，并在权限策略下限制外部技能使用 `bash`。用户可以通过 API 触发 Run 并看到日志逐步更新。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [x] (2026-02-13 00:00Z) 对齐 `pi-agent-core` 事件流与 DB 事实源，补齐 Run 调度与工具执行落盘细节。
- [x] (2026-02-13 00:00Z) 完成 pi-agent-core agent loop 与工具调用闭环。
- [x] (2026-02-13 00:00Z) 完成工具执行器与安全策略（含 bash allowlist）。
- [x] (2026-02-13 00:00Z) 完成技能加载与权限边界。
- [x] (2026-02-13 00:00Z) 完成 Run 调度与事件持久化联动。

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: Agent runtime 基于 `@mariozechner/pi-ai`，使用工具调用事件驱动执行。
  Rationale: 与项目定位一致，且工具调用模型清晰可审计。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: Agent loop 采用 `@mariozechner/pi-agent-core` 的 `Agent` 与事件流，Run 调度在 core-daemon 完成，DB 为事实源。
  Rationale: core-daemon 已以 DB 驱动 SSE 与查询接口；使用 pi-agent-core 可以直接映射事件到 `run_events` 和 `tool_executions`。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: 工具集合固定为 `read`、`write`、`edit`、`search`、`bash`。
  Rationale: MVP 只需要最小确定性原语，便于审计与复现。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: `bash` 仅允许执行 allowlist 中的命令，allowlist 为空时等价于禁用 `bash`。
  Rationale: 符合“外部技能默认禁止 bash”的安全边界，且允许通过显式 allowlist 放行。
  Date/Author: 2026-02-13 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

`packages/agent/src/index.ts` 目前为空，需要引入 `@mariozechner/pi-agent-core` 的 Agent loop 与工具调用闭环。`packages/adapters` 将成为工具执行层，提供 `read`/`write`/`edit`/`search`/`bash` 的确定性实现并限制路径逃逸。`apps/core-daemon` 已以数据库为事实源提供 Run/Event/ToolExecution 的查询与 SSE streaming（`/runs/:id/stream` 读取 `run_events`），因此 Run 调度必须落在 core-daemon 并写入 DB。`packages/core` 当前是内存实现，仅作参考，不应作为 Run 的事实来源。`packages/domain` 已定义 Run、RunEvent、ToolExecution 等结构，并与数据库 schema 与协议保持一致。

## Plan of Work

先在 `packages/agent` 中实现一个最小可运行的 pi-agent-core runner。该 runner 需要：构建 system prompt、选择模型、加载技能、定义工具列表、订阅 Agent 事件流，并在工具调用时委派给 `packages/adapters` 执行器。Agent 结束后返回完整消息与状态，错误需上抛以便 core-daemon 记录失败原因。为降低风险，先新增一个独立的 smoke 脚本用于验证 pi-agent-core 工具调用是否可用，再与 core-daemon 的 Run 调度逻辑对接。

随后实现工具执行器在 `packages/adapters`。`read`、`write`、`edit`、`search` 必须限制在 workspace root 内并防止路径逃逸；`search` 直接调用 `rg` 来保证性能；`edit` 使用统一 diff 并在失败时返回明确错误且不写入；`bash` 仅允许 allowlist 中的命令，并记录完整 stdout/stderr。

技能加载器扫描 `packages/agent/skills`、`./.agents/skills` 与 `~/.agents/skills`，读取每个 `SKILL.md` 并抽取名称、描述与可选 `allowedTools` 元信息。`allowedTools` 可为空或缺省；工具执行的最终权限仍由 allowlist 控制。外部技能默认禁用 `bash` 的效果由空 allowlist 实现。

最后在 `apps/core-daemon` 中实现 Run 调度器与 Agent 绑定。调度器接收 Run（DB 行），更新 Run 状态为 running，创建 `run.started`/`run.progress` 事件，触发 Agent runner，记录 `tool_executions` 与 `tool.executed` 事件，结束后更新 Run 状态为 succeeded/failed 并记录 `run.completed`/`run.failed`。SSE 仍从 `run_events` 读取，无需额外转发层。

## Concrete Steps

安装依赖并运行 pi-agent-core smoke 脚本：

    pnpm install
    export AGENT_PROVIDER=openai
    export AGENT_MODEL=gpt-4o-mini
    export AGENT_BASH_ALLOWLIST=rg,ls,cat
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

本计划依赖 `@mariozechner/pi-ai` 与 `@mariozechner/pi-agent-core`、TypeBox（用于工具参数定义，可由 `pi-ai` re-export 获取）、`p-queue`（用于 Run 队列）、以及 Node 的文件与进程 API。工具执行接口建议统一为 `executeTool(name, input, context)` 并返回 `{ output, logs }`。技能加载器应输出结构化对象，至少包含 `id`、`title`、`description`、`allowedTools` 与 `content`。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/pi-mono/SKILL.md`、`.agents/skills/pi-coding-agent/SKILL.md`、`.agents/skills/typescript/SKILL.md`。

Note (2026-02-13): 明确 `@mariozechner/pi-agent-core` 与 core-daemon + DB 事实源的落地路径，补充 Agent 环境变量示例，并更新 Progress 以反映 agent runner、工具执行器、技能加载与 Run 调度已实现，确保文档与当前实现保持一致。
