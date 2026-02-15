# MVP Telegram + Codex 自举闭环

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划替代 `docs/exec-plans/20260212-04-mvp-interfaces-bdd.md`，作为 Telegram 入口与自举闭环的唯一权威计划。

## Purpose / Big Picture

完成本计划后，使用者可以在 Telegram 中直接连接 OpenAI Codex，通过对话驱动本仓库的开发工作并形成自举闭环。所谓“自举”，指 Agent 在本仓库内完成自身系统的计划、编码、测试与 PR/发布工作，并将结果回流到代码库中。在 MVP 阶段，这些工作流通过自由文本指令触发，不引入额外命令面。用户在 Telegram 里发送指令后，可以看到 Run 的流式日志、工具调用与最终结果，必要时由 Agent 自动创建本地 git 分支与提交，且可选地通过 `gh` 创建 Pull Request。

## Progress

- [x] (2026-02-13 00:00Z) 创建 ExecPlan，用于替代旧的 Telegram/BDD 计划并与自举目标对齐。
- [ ] (2026-02-13 00:00Z) 补齐 OpenAI Codex provider 配置与 Run 编排联动，确保 Run 能驱动 Agent。
- [ ] (2026-02-13 00:00Z) 增加 Telegram 入口的会话绑定、`/new` `/fork` `/resume` 交互与流式回推。
- [ ] (2026-02-13 00:00Z) 完成 `/resume` 的历史会话列表与用户消息关键字过滤。
- [ ] (2026-02-13 00:00Z) 增加 Telegram 自举闭环的 BDD 验证与最小可视化证据。

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: Telegram 是唯一可信入口，所有自举操作都从 Telegram 触发。
  Rationale: 用户明确要求以 Telegram 作为唯一可信源，避免多入口分散风险。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: OpenAI Codex 通过 `@mariozechner/pi-ai` 的 OpenAI provider 接入，模型与密钥由环境变量显式配置。
  Rationale: 避免隐式默认值导致的不可复现行为，确保运行时可控与可审计。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: MVP 阶段不引入 Run `intent` 字段，所有任务均以自由文本触发。
  Rationale: 命令面收敛为 `/new` `/fork` `/resume`，先保证闭环跑通，结构化意图留作后续扩展。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: Telegram 与 WorkspaceSession 的绑定信息以结构化字段持久化在数据库中。
  Rationale: 绑定关系需在 core-daemon 重启后仍可恢复，避免 Telegram 入口的状态丢失。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: `/resume` 使用 Telegram inline keyboard 展示会话列表，`/resume <keyword>` 以用户消息内容进行过滤。
  Rationale: inline keyboard 在 Telegram 内交互成本低，用户消息是最符合“对话回溯”的过滤维度。
  Date/Author: 2026-02-13 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

本仓库为 pnpm + Turborepo 的单体仓库。`apps/core-daemon` 是 Node + Elysia 的 HTTP 服务，负责 WorkspaceSession 与 Run 的持久化与调度；`apps/bot-telegram` 使用 grammY 提供 Telegram Bot 入口；`packages/agent` 已提供 Agent 运行时；`packages/adapters` 用于工具执行；`packages/protocol` 提供 DTO 与 OpenAPI 规范；`packages/sdk` 为由 OpenAPI 生成的 TypeScript 客户端；`packages/database` 维护 Drizzle schema 与迁移。

本计划涉及的核心术语如下：WorkspaceSession 是与项目仓库绑定的长期工作区；Run 是一次可审计的任务执行单元，具备日志与工具调用记录；UserMessage 指由用户触发的输入消息，持久化在 `user_messages` 表中；SSE（Server-Sent Events）是基于 HTTP 的单向流式传输机制，在本仓库中表现为 `GET /runs/:id/stream`；“自举”指 Agent 能使用自身系统的工具链完成计划、代码修改、测试与 PR/发布流程，并把结果写回仓库；“OpenAI Codex”指 OpenAI API 中面向编程任务的模型能力，本计划通过 pi-mono 的 OpenAI provider 接入，不绑定具体模型名，要求使用者通过环境变量显式指定支持工具调用的模型；Telegram inline keyboard 指消息内的可点击按钮列表，用于在聊天中完成选择。

当前 `apps/bot-telegram/src/main.ts` 只处理 `/start` 命令。`apps/core-daemon/src/modules/workspaces` 已提供 `POST /workspaces` 与 `POST /workspaces/:id/runs`，`apps/core-daemon/src/modules/runs` 已提供 Run 事件与 SSE 输出。`packages/agent/src/index.ts` 已实现 `runAgent` 与工具调用闭环，但 Run 的实际执行尚未连接到 core-daemon。`packages/database/schemas/index.ts` 中的 `workspace_sessions` 表暂未存储 Telegram 绑定信息，`runs` 表也未记录 Telegram 侧的会话上下文。

## Plan of Work

首先补齐配置与数据层，以便“Telegram 入口 + OpenAI Codex”可被安全、可审计地使用。需要在 `packages/shared/src/env/keys.ts` 与 `apps/core-daemon/src/config.ts` 中增加 OpenAI provider 相关环境变量，并在 `packages/database/schemas/index.ts` 为 WorkspaceSession 增加 Telegram 绑定字段与 fork 追溯字段（例如 `telegramChatId`、`telegramUserId`、`forkedFromSessionId`，或通过 `metadata` 记录）。MVP 阶段 `/new` 创建 WorkspaceSession 时必须锁定为 core-daemon 进程的 `process.cwd()` 作为 `rootPath`。同时更新对应的迁移与 DTO，使 `POST /workspaces` 能保存绑定元信息。

其次完成 Agent 运行时的真实执行链路。`packages/agent` 需要提供一个可复用的 runner，读取 OpenAI provider 配置、构建系统提示词、加载技能、注册工具并执行工具调用，再把结果反馈到 Run 事件中。Run 调度由 core-daemon 触发：当 `POST /workspaces/:id/runs` 创建 Run 后，调度器立即启动 Agent，并按事件顺序写入 `run_events` 与 `tool_executions`。若 OpenAI 配置缺失，则应在创建 Run 时返回明确错误，而不是创建一个永远卡住的 Run。

随后实现 Telegram 入口的自举交互。Bot 必须校验允许的用户 ID，并将 Telegram Chat 与 WorkspaceSession 绑定。命令面限定为 `/new`（创建并绑定新 WorkspaceSession）、`/fork`（基于当前 WorkspaceSession 复制出新 Session，并记录来源）、`/resume`（展示历史 Session 列表并允许选择），以及自由文本触发 Run。`/resume <keyword>` 需要基于用户消息内容过滤历史会话。Bot 需要订阅 `/runs/:id/stream` 并将日志流式回推到 Telegram，必要时做分段与节流，避免触发 Telegram 限速。

为支持 `/resume` 的过滤，需要在 core-daemon 中提供按用户消息检索的查询路径。建议在 `apps/core-daemon/src/modules/workspaces` 新增查询接口（例如 `GET /workspaces/search?query=...`），返回包含最新用户消息摘要的 Session 列表，或新增 `GET /workspaces/:id/messages` 用于拉取 Session 内用户消息并由 bot 侧做过滤。实现方式需明确“用户消息”来自 `user_messages` 表，并确保查询具备可接受的性能与分页策略。

最后补齐验证。`bash` 默认放开执行（YOLO mode），仍需限制工作目录在仓库根目录内以避免路径逃逸。BDD 仅覆盖 Telegram 自举闭环：`/new` 创建 Session、自由文本触发 Run、`/fork` 复制 Session、`/resume` 列表与关键字过滤、以及日志流式回推，输出最小可复现证据。

## Concrete Steps

在仓库根目录启动数据库并启动 core-daemon：

    pnpm install
    docker compose -f infra/docker/docker-compose.yml up -d
    pnpm --filter @bbot/core-daemon run dev

生成 OpenAPI 与 SDK（若本计划新增 DTO 字段）：

    pnpm --filter @bbot/core-daemon run openapi:generate
    pnpm --filter @bbot/sdk run sdk:generate

启动 Telegram bot：

    pnpm --filter @bbot/bot-telegram run dev

在 Telegram 中验证：

    /new
    create a file README.md with hello
    /fork
    /resume
    /resume bdd

## Validation and Acceptance

当 Bot 启动后，Telegram 中 `/new` 返回 WorkspaceSession id 并绑定到当前 chat，且 Session 的 `rootPath` 必须是 core-daemon 进程的 `process.cwd()`；随后自由文本能够创建 Run，并在 Telegram 内看到 Run 的流式日志、工具调用与最终结果。`/fork` 会复制当前 Session 并返回新的 id，且新 Session 在元信息中保留来源。`/resume` 会展示历史 Session 列表并允许通过 inline keyboard 选择，`/resume <keyword>` 仅返回包含该关键字的用户消息会话。Run 在数据库中落盘为 `runs`、`run_events` 与 `tool_executions`，WorkspaceSession 与 UserMessage 的绑定可查询。若缺失 OpenAI 配置，创建 Run 应返回明确错误信息。若配置齐全，则至少能完成一次可见的文件修改并在仓库中生成对应的 git 提交。

## Idempotence and Recovery

Telegram 的 `/new` 可重复执行并生成新的 WorkspaceSession，不应破坏已有数据；`/fork` 创建新 Session 且保留来源信息，不修改原 Session；`/resume` 只读历史数据，不修改 Run。若迁移失败，先修复 schema 或配置，再重复执行迁移命令。若 Run 失败，应保留失败日志并允许重新触发新的 Run，而不是覆盖旧记录。

## Artifacts and Notes

Telegram 回显示例：

    Workspace created: workspace_9Kx3...
    Run queued: run_xX12...
    Run started
    Tool executed: search (rg packages/agent)
    Tool executed: write (packages/agent/src/index.ts)
    Run completed: succeeded

`/resume` 列表示例：

    Select a session:
    [ workspace_9Kx3... ] [ workspace_Ba12... ]

## Interfaces and Dependencies

环境变量需要在 `packages/shared/src/env/keys.ts` 与各应用配置中同步：`OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`（可选）、`BOT_TELEGRAM_ALLOWED_USER_IDS`、`BOT_TOKEN`、`CORE_API_TOKEN`。其中 `BOT_TELEGRAM_ALLOWED_USER_IDS` 采用逗号分隔的 Telegram user id 列表。

在 `packages/database/schemas/index.ts` 中，`workspace_sessions` 需要新增 Telegram 绑定字段（例如 `telegramChatId` 与 `telegramUserId`），并保留 fork 来源（例如 `forkedFromSessionId` 或 `metadata.forkedFrom`）。`packages/protocol/src/schema/workspaces.ts` 的 `createWorkspaceBody` 需要允许传入这些可选字段（或由 core-daemon 侧注入），`packages/protocol/openapi.json` 与 `packages/sdk` 必须随之更新。

`apps/core-daemon` 需要在创建 Run 后调用 `runAgent` 并记录事件。`apps/bot-telegram` 需要使用 `packages/sdk` 调用 Core API，并实现 SSE 订阅与回推逻辑。

Change Note (2026-02-13): 新建本 ExecPlan 以替代 `docs/exec-plans/20260212-04-mvp-interfaces-bdd.md`，将目标调整为“Telegram 连接 OpenAI Codex 并实现自举闭环”，并明确 Run 意图与 Telegram 绑定的持久化策略。
Change Note (2026-02-13): 命令面收敛为 `/new` `/fork` `/resume`，移除 Run intent 与工作流模板要求，新增 `/resume` 基于用户消息过滤与 inline keyboard 的交互说明，以匹配最新自举入口约束。
Change Note (2026-02-13): `/new` 创建 WorkspaceSession 时 `rootPath` 锁定为 core-daemon 的 `process.cwd()`，避免 MVP 阶段错误指向非仓库路径。
