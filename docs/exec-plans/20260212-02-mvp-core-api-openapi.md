# MVP Core API：WorkspaceSession/Run 接口与 OpenAPI/heyapi 管线

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。本计划建立在 `docs/exec-plans/20260212-01-mvp-foundation.md` 已完成的基础之上。

## Purpose / Big Picture

完成本计划后，core-daemon 将提供可用的 HTTP API，用于创建与查询 WorkspaceSession、创建 Run 并追加日志事件，同时提供 Run 的 SSE 流式接口。OpenAPI 规范由代码生成并写入仓库，heyapi 使用该规范生成 TypeScript SDK，Telegram/Web/TUI 可直接复用生成客户端进行调用。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [ ] (2026-02-12 00:00Z) 产出 OpenAPI 生成管线与规范输出文件。
- [ ] (2026-02-12 00:00Z) 完成 WorkspaceSession 与 Run 的核心 API 路由。
- [ ] (2026-02-12 00:00Z) 完成 Run SSE 流式接口并验证。
- [ ] (2026-02-12 00:00Z) 完成 heyapi 生成客户端并被 SDK 包装导出。
- [ ] (2026-02-12 00:00Z) 完成单用户鉴权策略与验证。

## Surprises & Discoveries

暂无。

## Decision Log

- Decision: OpenAPI 由代码生成，作为发布与客户端生成的契约产物。
  Rationale: 减少手写成本并与实现保持一致，同时保持契约化输出。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: OpenAPI 规范输出路径为 `packages/protocol/openapi.yaml`。
  Rationale: 协议边界集中在 protocol 包内，便于 SDK 与其他入口复用。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: SDK 通过 heyapi 从 `packages/protocol/openapi.yaml` 自动生成。
  Rationale: 保证类型一致性，避免手工维护客户端。
  Date/Author: 2026-02-12 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

基线来自 ExecPlan 01：`apps/core-daemon` 已通过 Node + Elysia 启动，数据库与 Drizzle schema 已存在。`packages/core/src/index.ts` 目前仍为内存态 Core，需要开始对接数据库与 API 层。`packages/protocol` 目前为空，可用于放置 OpenAPI 输出与 DTO 定义。`packages/sdk` 目前为空，需要作为 heyapi 生成目标。

## Plan of Work

先在 core-daemon 中建立 OpenAPI 生成路径。优先使用 Elysia 的 OpenAPI 生成插件（例如 `@elysiajs/swagger`）输出 JSON，再在构建或脚本阶段转换为 YAML 并写入 `packages/protocol/openapi.yaml`。若插件在 Node 环境无法稳定输出，则添加短期原型脚本验证并选择可行替代方案，再继续。

随后实现 API 路由并绑定数据库仓储逻辑。API 必须包含 WorkspaceSession 的 create/list/get、Run 的 create/get、RunEvent 的 append，以及 Run 的 SSE 流式读取。认证策略采用单用户 token，要求所有写请求与 SSE 订阅都携带 `Authorization: Bearer <token>`，未授权返回 401。请求与响应的类型必须集中在 `packages/protocol`，并与 OpenAPI 输出一致。

最后接入 heyapi。新增 `packages/sdk` 的生成脚本与配置文件（例如 `heyapi.config.ts`），并在 `packages/sdk/src/index.ts` 重新导出生成客户端。所有入口应用只依赖 `packages/sdk` 而不直接拼装 HTTP 请求。

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

订阅 Run 流：

    curl -N -H "Authorization: Bearer $CORE_API_TOKEN" \
      http://localhost:3001/runs/<runId>/stream

## Validation and Acceptance

成功生成 `packages/protocol/openapi.yaml` 并可被 heyapi 消费，生成的 SDK 在 `packages/sdk` 内可被 TypeScript 正确引用。`POST /workspaces` 返回 201 并包含 workspace id；`GET /workspaces/:id` 返回相同对象。Run 的 SSE 接口返回 `text/event-stream` 并能看到 `run.queued` 等事件。

## Idempotence and Recovery

OpenAPI 与 SDK 的生成脚本应可重复执行并覆盖旧产物。若生成失败，先删除生成输出目录再重新执行，不依赖手工修改生成文件。

## Artifacts and Notes

OpenAPI 输出的最小结构示例：

    openapi: 3.1.0
    info:
      title: BBot Core API
      version: 0.1.0

## Interfaces and Dependencies

本计划依赖 Elysia 的 OpenAPI/Swagger 生成插件、YAML 序列化库（如 `yaml`）、heyapi 以及现有的 Drizzle 数据库层。API 路由应放在 `apps/core-daemon/src/http` 下的模块中，并在 `apps/core-daemon/src/main.ts` 装配。`packages/protocol` 需提供 WorkspaceSession、Run、RunEvent 的 DTO 类型与错误响应类型。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/project-overview/SKILL.md`、`.agents/skills/typescript/SKILL.md`、`.agents/skills/turborepo/SKILL.md`。
