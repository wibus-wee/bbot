# Align Auto Compaction With Codex-RS Timing

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/PLANS.md` and must be maintained according to that file.

## Purpose / Big Picture

本次改动让自动压缩的触发时机与 codex-rs 的行为一致：只有在上一轮对话结束后，且确实进入下一轮用户输入时才会压缩，避免在单轮执行中改变上下文。完成后，用户可以观察到：当会话累计 token 使用量超过阈值时，下一轮 run 启动前会先写入一条 summary 记录，并使用压缩后的上下文继续对话。

## Progress

- [x] (2026-02-14 22:10+08:00) Create ExecPlan for codex-style compaction alignment.
- [x] (2026-02-14 22:14+08:00) Add auto-compact token limit setting to protocol, settings merge, and runtime config.
- [x] (2026-02-14 22:16+08:00) Implement pre-run auto compaction in run dispatcher using usage totals and resolved limit.
- [x] (2026-02-14 22:17+08:00) Remove inline compaction from runAgent so compaction only happens between runs.
- [x] (2026-02-14 22:18+08:00) Update SDK artifacts and run required checks.
- [x] (2026-02-14 22:18+08:00) Add/adjust tests to cover pre-run auto compaction trigger.

## Surprises & Discoveries

- Observation: The current SDK stack does not expose a remote compaction API for OpenAI responses, so remote compaction could not be implemented without a new client.
  Evidence: Repository search found no compaction helpers in `@mariozechner/pi-ai` or `openai` package sources.

## Decision Log

- Decision: Align compaction timing by moving auto compaction to pre-run, and do not use provider-specific remote compaction in this iteration.
  Rationale: The current codebase only implements local summarization. Remote compaction endpoints are not available in the existing SDK stack, and aligning timing/threshold behavior delivers the main user-visible effect.
  Date/Author: 2026-02-14 (Wee)

- Decision: Interpret needs_follow_up as “a new run is created for the session” and therefore run auto compaction immediately before building context for that run.
  Rationale: The system does not store an explicit needs_follow_up flag; run creation is the only reliable indicator that the conversation continues.
  Date/Author: 2026-02-14 (Wee)

## Outcomes & Retrospective

Auto compaction now triggers only between runs, using a resolved auto-compact token limit and local summarization. Inline compaction was removed, SDK artifacts regenerated, and tests added to validate the trigger timing. The main gap is the lack of provider-specific remote compaction, which remains out of scope.

## Context and Orientation

本仓库中，自动对话运行由 `apps/core-daemon/src/modules/runs/dispatcher.ts` 负责，它会在每次 run 开始前加载历史消息并调用 `runAgent`。当前压缩逻辑位于 `packages/agent/src/compaction/compactor.ts`，并通过 `packages/agent/src/index.ts` 的 `transformContext` 在每次模型请求前尝试压缩。这与 codex-rs 的“响应后检查、下一轮开始前压缩”存在差异。

术语说明：

auto compact token limit 指配置的阈值，用于决定是否需要压缩。needs_follow_up 在 codex-rs 中表示“当前轮次结束后仍需继续对话”。在本系统中，一个新的 run 只有在用户输入后才创建，因此“run 开始前”可以视作 needs_follow_up 为 true 的时刻。

summary entry 指 `session_entries` 中 kind 为 `summary` 的记录。它保存压缩摘要并在构建上下文时注入，相关逻辑在 `packages/agent/src/context.ts`。

## Plan of Work

先扩展协议层的 compaction 设置，新增 `autoCompactTokenLimit`（可选正整数）。该字段会通过 `apps/core-daemon/src/modules/agent-settings/merge.ts` 合并，并在 `apps/core-daemon/src/modules/agent-providers/runtime.ts` 中计算最终阈值。计算规则对齐 codex-rs：如果配置显式提供阈值则使用它；否则回退到 `model.contextWindow * 0.9`。

随后在 `apps/core-daemon/src/modules/runs/dispatcher.ts` 增加 pre-run 自动压缩步骤：在加载历史 message entries 后，根据 usage.totalTokens 累计值判断是否超过阈值；若超过则调用 `compactWorkspaceSession` 写入 summary，并重新拉取 summary 与 message entries 以构建新的上下文。该步骤发生在 runAgent 调用之前，因此压缩效果只影响下一轮。

最后移除 `packages/agent/src/index.ts` 中的 inline compaction（`transformContext`），确保 compaction 不会在单轮内触发。保留手动压缩接口 `/workspaces/:id/compact` 作为显式操作。

为可观测性补充测试：在 `apps/core-daemon/src/__tests__` 中新增用例，构造超过阈值的 usage.totalTokens，断言 `compactWorkspaceSession` 在 `runAgent` 调用前被触发。

## Concrete Steps

1. 编辑协议 schema。

   - File: `packages/protocol/src/schema/agent-settings.ts`
   - Add: `autoCompactTokenLimit?: number` under `agentCompactionSettings`.

2. 更新 settings 合并与运行时配置。

   - File: `apps/core-daemon/src/modules/agent-settings/merge.ts`
   - Include `autoCompactTokenLimit` in merge result.
   - File: `apps/core-daemon/src/modules/agent-providers/runtime.ts`
   - Compute resolved `autoCompactTokenLimit` using config or `contextWindow * 0.9`.

3. 修改 run dispatcher 的自动压缩时机。

   - File: `apps/core-daemon/src/modules/runs/dispatcher.ts`
   - Add a pre-run check that sums usage.totalTokens from session message entries (after the latest summary).
   - If total >= limit and compaction enabled, call `compactWorkspaceSession` and re-fetch summary/message entries.

4. 移除 inline compaction。

   - File: `packages/agent/src/index.ts`
   - Remove transformContext compaction path and `onCompaction` usage.

5. 生成 SDK 及运行检查。

   - Run from repo root:
     pnpm run workflow:sdk
     pnpm run check-types

6. 运行核心服务测试。

   - Run from repo root:
     pnpm -C apps/core-daemon test

## Validation and Acceptance

完成后可以通过两种方式验证：

1) 行为验证：构造一段会话，使累计 usage.totalTokens >= autoCompactTokenLimit，然后创建新 run。预期在 run 开始前会写入 summary entry，且 run 使用压缩后的上下文。可以通过查询 session_entries 或观察日志来确认。

2) 自动化测试：运行 `pnpm -C apps/core-daemon test`，预期新增测试通过；同时 `pnpm run check-types` 通过。

## Idempotence and Recovery

所有步骤可重复执行。若 SDK 生成失败，可修复 schema 后重复运行 `pnpm run workflow:sdk`。若 compaction 逻辑引发运行失败，可暂时关闭 `compaction.enabled` 或将 `autoCompactTokenLimit` 调高以规避自动压缩。

## Artifacts and Notes

Expected examples (for reference):

  pnpm -C apps/core-daemon test
  ✓ RunDispatcher auto compaction triggers before run

Actual results:

  pnpm run workflow:sdk
  ✔ sdk workflow finished

  pnpm run check-types
  Tasks: 11 successful, 11 total

  pnpm -C apps/core-daemon test
  Test Files  2 passed (2)
  Tests       2 passed (2)

## Interfaces and Dependencies

本改动涉及的接口与依赖：

- `packages/protocol/src/schema/agent-settings.ts` 新增字段 `autoCompactTokenLimit`，类型为可选正整数。
- `apps/core-daemon/src/modules/agent-providers/runtime.ts` 返回的 `AgentRuntimeConfig.compaction` 需要包含 `autoCompactTokenLimit`。
- `apps/core-daemon/src/modules/runs/dispatcher.ts` 需要调用 `compactWorkspaceSession` 并在 run 前完成压缩。

Note: This plan was created on 2026-02-14 22:10+08:00 to align compaction timing with codex-rs behavior.

Revision Note: Updated progress, decisions, and validation results after implementation to reflect completed work and observed constraints.
