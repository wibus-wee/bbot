# MVP Core API：WorkspaceSession/Run 接口与 OpenAPI/heyapi 管线

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划建立在 `docs/exec-plans/20260212-01-mvp-foundation.md` 已完成的基础之上。

## Purpose / Big Picture

完成本计划后，core-daemon 将提供可用的 HTTP API，用于创建与查询 WorkspaceSession、创建 Run 并追加日志事件，同时提供 Run 的 SSE 流式接口。OpenAPI 规范由代码生成并写入仓库，heyapi 使用该规范生成 TypeScript SDK，Telegram/Web/TUI 可直接复用生成客户端进行调用。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [x] (2026-02-12 03:45Z) 产出 OpenAPI 生成管线与规范输出文件（已生成 `packages/protocol/openapi.json`）。
- [x] (2026-02-12 03:45Z) 完成 heyapi 生成客户端并被 SDK 包装导出（`packages/sdk` 已由 `openapi.json` 生成）。
- [ ] (2026-02-13 00:00Z) 完成 WorkspaceSession 与 Run 的核心 API 路由验证与错误码对齐（已实现基础路由，剩余：验证 201/404/500 与 401 响应定义）。
- [ ] (2026-02-13 00:00Z) 完成 RunEvent 追加 API（剩余：补齐协议 schema，新增 `POST /runs/:id/events` 并写入数据库）。
- [ ] (2026-02-13 00:00Z) 完成 Run SSE 流式接口的契约与验证（已实现基础 SSE，剩余：补齐 OpenAPI 响应说明并验证事件来自数据库记录）。
- [ ] (2026-02-13 00:00Z) 完成单用户鉴权策略与验证（已实现 Bearer 校验，剩余：验证 401 与放行逻辑并在 OpenAPI 中声明 401）。

## Surprises & Discoveries

- 发现：`tsx` 在 CJS 输出下不支持 top-level await，需要改为显式 `async` 函数。
  Evidence: `openapi:generate` 报错 “Top-level await is currently not supported with the \"cjs\" output format”。

## Decision Log

- Decision: OpenAPI 由代码生成，作为发布与客户端生成的契约产物。
  Rationale: 减少手写成本并与实现保持一致，同时保持契约化输出。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: OpenAPI 规范输出路径为 `packages/protocol/openapi.json`，不生成 YAML。
  Rationale: 现有生成脚本与 SDK 生成链路均以 JSON 为输入，保留单一产物避免重复与漂移。
  Date/Author: 2026-02-13 / Wibus + Codex

- Decision: SDK 通过 heyapi 从 `packages/protocol/openapi.json` 自动生成。
  Rationale: 保证类型一致性，避免手工维护客户端。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: OpenAPI 生成使用 `@elysiajs/openapi` 插件而非 Swagger 插件。
  Rationale: 官方推荐 OpenAPI 插件并默认提供 `/openapi/json` 规范输出。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: SSE 验证必须包含与数据库事件的对照观测。
  Rationale: 确认流式通道输出与持久化事件一致，避免“流可连但事件缺失/乱序”的不可见问题。
  Date/Author: 2026-02-13 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

基线来自 ExecPlan 01：`apps/core-daemon` 已通过 Node + Elysia 启动，数据库与 Drizzle schema 已存在。`apps/core-daemon/src/modules/workspaces` 与 `apps/core-daemon/src/modules/runs` 已实现 WorkspaceSession 与 Run 的基础路由。`packages/protocol` 已包含 Zod DTO（`packages/protocol/src/schema`）与生成产物 `packages/protocol/openapi.json`。`packages/sdk` 已通过 heyapi 生成客户端代码（`packages/sdk/src`）。

本计划中的 “SSE” 指 Server-Sent Events：一种基于 HTTP 的单向流式输出协议。在本仓库中，SSE 对应 `GET /runs/:id/stream`，返回 `text/event-stream`，用于推送 Run 事件。所谓“观测”是指在客户端能看到流式事件，并能与数据库中已持久化的事件记录对应上。

## Plan of Work

先在 core-daemon 中建立并维持 OpenAPI 生成路径。使用 `@elysiajs/openapi` 插件输出 OpenAPI JSON，并由脚本写入 `packages/protocol/openapi.json`。若插件在 Node 环境无法稳定输出，则添加短期原型脚本验证并选择可行替代方案，再继续。

随后实现 API 路由并绑定数据库仓储逻辑。API 必须包含 WorkspaceSession 的 create/list/get、Run 的 create/get、RunEvent 的 append，以及 Run 的 SSE 流式读取。认证策略采用单用户 token，要求所有写请求与 SSE 订阅都携带 `Authorization: Bearer <token>`，未授权返回 401。请求与响应的类型必须集中在 `packages/protocol`，并与 OpenAPI 输出一致，同时在 OpenAPI 的 response 中显式声明 401 错误响应。

最后接入 heyapi。保持 `packages/sdk/openapi-ts.config.ts` 指向 `packages/protocol/openapi.json`，并在 `packages/sdk/src/index.ts` 重新导出生成客户端。所有入口应用只依赖 `packages/sdk` 而不直接拼装 HTTP 请求。

## Concrete Steps

在仓库根目录安装新增依赖并生成 OpenAPI：

    pnpm install
    pnpm --filter @bbot/core-daemon run openapi:generate

生成 SDK：

    pnpm --filter @bbot/sdk run sdk:generate

启动 core-daemon 后，进行基础 API 校验：

    curl -i -H "Authorization: Bearer $CORE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"name":"workspace-01"}' \
      http://localhost:3001/workspaces

追加 Run 事件：

    curl -i -H "Authorization: Bearer $CORE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"type":"run.progress","message":"Step 1","payload":{"step":1}}' \
      http://localhost:3001/runs/<runId>/events

验证鉴权失败返回 401：

    curl -i http://localhost:3001/workspaces

订阅 Run 流：

    curl -N -H "Authorization: Bearer $CORE_API_TOKEN" \
      http://localhost:3001/runs/<runId>/stream

## Validation and Acceptance

成功生成 `packages/protocol/openapi.json` 并可被 heyapi 消费，生成的 SDK 在 `packages/sdk` 内可被 TypeScript 正确引用。`POST /workspaces` 返回 201 并包含 workspace id；`GET /workspaces/:id` 返回相同对象。`POST /runs/:id/events` 返回 201 并将事件写入数据库；`GET /runs/:id/events` 能读到刚写入的事件。Run 的 SSE 接口返回 `text/event-stream`，当追加事件后能在流中看到对应事件，并与 `GET /runs/:id/events` 的结果一致。

## Idempotence and Recovery

OpenAPI 与 SDK 的生成脚本应可重复执行并覆盖旧产物。若生成失败，先删除生成输出目录再重新执行，不依赖手工修改生成文件。

## Artifacts and Notes

OpenAPI 输出的最小结构示例：

    {
      "openapi": "3.1.0",
      "info": {
        "title": "BBot Core API",
        "version": "0.1.0"
      }
    }

## Interfaces and Dependencies

本计划依赖 `@elysiajs/openapi` 插件、heyapi 以及现有的 Drizzle 数据库层。API 路由应放在 `apps/core-daemon/src` 下（例如 `app.ts`）并在 `apps/core-daemon/src/main.ts` 装配。`packages/protocol` 需提供 WorkspaceSession、Run、RunEvent 的 DTO 类型与错误响应类型，并生成 `packages/protocol/openapi.json` 作为 SDK 输入。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/project-overview/SKILL.md`、`.agents/skills/typescript/SKILL.md`、`.agents/skills/turborepo/SKILL.md`。

变更说明（2026-02-13）：移除对 OpenAPI YAML 的要求，统一以 `openapi.json` 作为唯一产物与 SDK 输入；补充 SSE“观测”定义与验证路径，并在 Decision Log 中明确该要求的原因，以与现状实现保持一致并减少误解。
