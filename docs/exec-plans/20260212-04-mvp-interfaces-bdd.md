# MVP 入口与测试：Telegram、自举入口、Web/TUI 最小界面与 BDD

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划建立在 `docs/exec-plans/20260212-01-mvp-foundation.md`、`docs/exec-plans/20260212-02-mvp-core-api-openapi.md` 与 `docs/exec-plans/20260212-03-mvp-agent-tools.md` 已完成的基础之上。

## Purpose / Big Picture

完成本计划后，Telegram 入口可创建 WorkspaceSession、触发 Run 并流式回显日志，实现“在 Telegram 内开发当前项目”的最小自举闭环。WebUI 与 TUI 提供最小可视化入口，能够查看 WorkspaceSession 与 Run。BDD 用例覆盖创建 WorkspaceSession、执行 Run、工具调用与 Telegram 闭环三条核心路径。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [ ] (2026-02-12 00:00Z) 完成 Telegram bot 与 Core API 的集成。
- [ ] (2026-02-12 00:00Z) 完成 Run 日志在 Telegram 的流式回推。
- [ ] (2026-02-12 00:00Z) 完成 WebUI 与 TUI 的最小查看能力。
- [ ] (2026-02-12 00:00Z) 完成 BDD 三条核心流程。

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: Telegram 为 MVP 第一入口，优先完成自举闭环。
  Rationale: PRD 明确 Telegram 为首入口，且具备最高价值验证能力。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: WebUI/TUI 仅提供只读能力，不阻塞 Telegram 闭环。
  Rationale: 降低入口开发成本，确保主闭环优先。
  Date/Author: 2026-02-12 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

`apps/bot-telegram/src/main.ts` 目前仅响应 `/start`。`apps/webui` 目前为空，`apps/tui/src/main.ts` 为空。`packages/sdk` 将通过 heyapi 自动生成并作为客户端使用。BDD 依赖 `packages/testkit`，当前尚无用例与步骤定义。

## Plan of Work

先扩展 Telegram bot，使其通过 SDK 调用 Core API。最小闭环为 `/new` 创建 WorkspaceSession，并在用户发送普通文本时创建 Run。Run 创建后立即订阅 SSE，将流式日志转发给 Telegram，必要时做分段合并与节流。bot 需要单用户 allowlist 校验，未授权用户应被拒绝。

随后实现 WebUI 与 TUI 的最小入口，只读展示 WorkspaceSession 列表与 Run 列表。WebUI 可以使用最小 Vite 页面，TUI 使用 Ink 渲染列表即可，不引入复杂交互。

最后在 `packages/testkit` 中新增 Cucumber 特性文件与步骤定义，覆盖创建 WorkspaceSession、执行 Run 与工具调用、以及 Telegram 入口闭环三条用例。测试需要启动 core-daemon 与数据库，并以真实 HTTP 请求验证行为。

## Concrete Steps

启动 core-daemon 与 Telegram bot：

    pnpm --filter @bbot/core-daemon run dev
    pnpm --filter @bbot/bot-telegram run dev

在 Telegram 中执行命令：

    /new
    create a file README.md with hello

运行 BDD 测试：

    pnpm --filter @bbot/testkit run test

## Validation and Acceptance

Telegram 中 `/new` 返回 WorkspaceSession id，发送文本后收到 Run 进度流与最终结果。WebUI 与 TUI 能展示当前 WorkspaceSession 与 Run 列表。BDD 测试中至少三条用例通过，并且失败时输出明确的 HTTP 或事件日志。

## Idempotence and Recovery

Telegram 与 Web/TUI 入口均可重复运行，不应产生重复的长期副作用。BDD 测试若失败，应先检查数据库是否已残留旧数据，并在必要时清理测试数据后重试。

## Artifacts and Notes

Telegram 回显片段示例：

    Run queued: run_xxx
    Run started
    Tool executed: write (README.md)
    Run completed: success

## Interfaces and Dependencies

本计划依赖 grammY、生成的 SDK、SSE 客户端能力、以及 Cucumber/Vitest 的测试框架。Telegram bot 应位于 `apps/bot-telegram/src`，WebUI 位于 `apps/webui/src`，TUI 位于 `apps/tui/src`。BDD 特性文件建议放在 `packages/testkit/features`，步骤定义在 `packages/testkit/src/steps`。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/project-overview/SKILL.md`、`.agents/skills/typescript/SKILL.md`。
