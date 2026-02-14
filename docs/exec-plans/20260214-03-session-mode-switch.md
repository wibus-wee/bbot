# Session Mode Switching and Global Agent Defaults

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The PLANS.md requirements live at `.agents/PLANS.md` from the repository root. This plan must be maintained in accordance with that file.

## Purpose / Big Picture

这次改动要让 Telegram 用户在聊天中实时切换当前会话的 Agent 模式（coding / free），并且可以设置全局默认的 Agent 配置。改动完成后，即便没有任何 AI 配置，Telegram 也能正常使用 /mode 指令和设置接口；只有在实际触发 run 时才会因为未配置 provider 而失败。用户可以在 Telegram 中看到当前会话的 mode、全局默认 mode，并进行切换，切换会在下一次 run 生效。

## Progress

- [x] (2026-02-14 21:10+08:00) 完成 ExecPlan 的实时更新规范化与基础进度记录。
- [x] (2026-02-14 21:11+08:00) 为 `workspace_sessions` 增加 `agent_settings` 字段并生成迁移，运行 `db:generate`、`workflow:dbml`、`db:migrate`。
- [x] (2026-02-14 21:12+08:00) 新增 agent settings schema 与 core-daemon 全局/会话 settings API 路由。
- [x] (2026-02-14 21:13+08:00) 更新 runtime resolver 读取会话 settings，并在 runs/compaction 传入 sessionId。
- [x] (2026-02-14 21:14+08:00) 新增 Telegram `/mode` 指令与菜单交互，并补齐 API wrapper。
- [x] (2026-02-14 21:15+08:00) 运行 `workflow:sdk` 与 `check-types`，确保类型一致。

## Surprises & Discoveries

暂无。实施过程中如发现异常需记录证据。

## Decision Log

- Decision: 会话级设置使用 `workspace_sessions.agent_settings` JSONB，仅存覆盖项。
  Rationale: 保持 schema 简洁，避免为 mode 切换引入多个列。
  Date/Author: 2026-02-14, Wee

- Decision: 全局默认设置存储在 `system_configs` 的 `agent.settings` key，由新接口管理。
  Rationale: 复用已有 system config，保持统一入口。
  Date/Author: 2026-02-14, Wee

- Decision: 会话/全局设置合并采用“会话覆盖全局”的规则，运行时使用合并后的 effective settings。
  Rationale: 贴合用户直觉，避免复杂的优先级规则。
  Date/Author: 2026-02-14, Wee

- Decision: 会话 settings 的 PATCH 行为采用“整体写入”，Telegram `/mode` 在客户端合并旧值并在需要时移除 `promptProfile`。
  Rationale: 保持 API 简洁同时可清除会话覆盖项，避免引入额外字段或新接口。
  Date/Author: 2026-02-14, Wee

## Outcomes & Retrospective

已完成核心实现与类型验证。待补充：在 Telegram 中手动验证 `/mode` 菜单切换是否在下一次 run 生效、无 provider 时命令是否可用。

## Context and Orientation

核心 HTTP 服务在 `apps/core-daemon`，负责所有会话与 run 的管理。Agent 运行时使用 `apps/core-daemon/src/modules/agent-providers/runtime.ts` 解析当前 provider 与全局设置。Telegram bot 位于 `apps/bot-telegram`，通过 SDK 调用 core-daemon 的 HTTP API。

`system_configs` 表已有 CRUD 接口，但当前缺少专门的 agent settings API。`workspace_sessions` 表没有 session-level agent settings 字段。Telegram 侧已有 `/provider` 管理与 `/status` 状态展示，但没有 `/mode` 切换。

## Plan of Work

第一步，为 `workspace_sessions` 增加 `agent_settings` JSONB 字段。在 `packages/database/schemas/index.ts` 增加列，并生成迁移。迁移完成后运行 `pnpm run db:generate`、`pnpm run workflow:dbml`、`pnpm run db:migrate`。

第二步，新增协议与 API。新增 `packages/protocol/src/schema/agent-settings.ts`，定义 `agentSettings` schema 及 `workspaceAgentSettingsResponse`。在 core-daemon 新增 `apps/core-daemon/src/modules/agent-settings` 模块，提供 `GET /agent/settings` 与 `PUT /agent/settings`；在 `apps/core-daemon/src/modules/workspaces/index.ts` 增加 `GET /workspaces/:id/settings` 与 `PATCH /workspaces/:id/settings`，读写 `workspace_sessions.agent_settings`。

第三步，更新 runtime resolver。将 `resolveAgentRuntimeConfig` 扩展为接收 `sessionId`，从 DB 读取会话 settings，合并全局 `agent.settings` 后得到 effective settings。`RunDispatcher` 与 `compactWorkspaceSession` 传入 sessionId，确保运行时使用合并后的 mode。

第四步，新增 Telegram `/mode` 指令。实现菜单交互，可查看当前会话与全局 mode，并支持切换（会话 / 全局）。即使没有 active provider，这些指令仍能执行；错误仅在 run 触发时发生。

最后，更新 SDK 与类型检查。运行 `pnpm run workflow:sdk` 和 `pnpm run check-types`，确保类型一致与编译通过。

## Concrete Steps

1) 修改数据库 schema 与迁移。

   - 编辑 `packages/database/schemas/index.ts` 添加 `agentSettings` 字段。
   - 运行：

     pnpm run db:generate
     pnpm run workflow:dbml
     pnpm run db:migrate

2) 新增协议与 core-daemon 路由。

   - 新增 `packages/protocol/src/schema/agent-settings.ts`，并在 `packages/protocol/src/index.ts` 导出。
   - 新增 `apps/core-daemon/src/modules/agent-settings/index.ts`。
   - 在 `apps/core-daemon/src/modules/workspaces/index.ts` 添加 settings 路由。
   - 在 `apps/core-daemon/src/app.ts` 注册新模块。

3) 更新 runtime resolver。

   - 编辑 `apps/core-daemon/src/modules/agent-providers/runtime.ts` 读取会话 settings 并合并。
   - 更新 `apps/core-daemon/src/modules/runs/dispatcher.ts` 与 `apps/core-daemon/src/modules/workspaces/service.ts` 传入 sessionId。

4) 添加 Telegram /mode。

   - 新增 `apps/bot-telegram/src/commands/mode.ts`。
   - 更新 `apps/bot-telegram/src/commands/index.ts`。
   - 在 `apps/bot-telegram/src/api.ts` 增加 agent settings 与 workspace settings 的 API wrapper。

5) 运行 SDK 生成与类型检查。

   - 运行：

     pnpm run workflow:sdk
     pnpm run check-types

## Validation and Acceptance

- Telegram 中输入 `/mode`，应显示当前会话 mode 与全局默认 mode，并提供切换按钮。
- 切换会话 mode 后，下一次 run 的系统 prompt 选择应切换到对应 profile（coding/free）。
- 未配置 provider 的情况下，`/mode` 指令可用但 run 会提示 provider 未配置。
- `pnpm run check-types` 通过。

## Idempotence and Recovery

`agent_settings` 是新增列，迁移可重复执行。`/agent/settings` 与 `/workspaces/:id/settings` 可重复调用。若误设置导致运行失败，可通过 `/mode` 切回或 PUT 全局设置恢复。

## Artifacts and Notes

示例 `agent.settings`（全局）结构：

    {
      "promptProfile": "coding",
      "thinkingLevel": "high",
      "compaction": {
        "enabled": true,
        "reserveTokens": 16384,
        "keepRecentTokens": 20000
      }
    }

## Interfaces and Dependencies

- `packages/protocol/src/schema/agent-settings.ts` 需导出：
  - `agentSettings`
  - `agentSettingsResponse`
  - `agentSettingsUpdateBody`
  - `workspaceAgentSettingsResponse`
  - `workspaceAgentSettingsUpdateBody`

- core-daemon routes：
  - `GET /agent/settings`、`PUT /agent/settings`
  - `GET /workspaces/:id/settings`、`PATCH /workspaces/:id/settings`

- Telegram 命令：
  - `/mode` 显示与切换会话/全局 mode

## Plan Update Notes

2026-02-14: 更新 Progress/Decision Log/Outcomes，记录本次实现结果与 PATCH 行为选择，确保计划自包含并可复现当前状态。
