# MVP 基础：Workspace 持久化、Bun/Elysia 启动与 Postgres 基线

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

仓库内已有 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件的要求并保持同步更新。

## Purpose / Big Picture

完成本计划后，使用者可以在本机通过 Docker Compose 启动 PostgreSQL，通过 Bun + Elysia 启动 core-daemon，并在 `/health` 看到包含数据库连通性的健康状态。核心领域模型完成从 DemoSession 到 WorkspaceSession 的命名收敛，数据库具备 WorkspaceSession、Run、RunEvent、ToolExecution、UserMessage 的基础表结构，为后续 API 与 Agent 落地提供持久化基线。

## Progress

- [x] (2026-02-12 00:00Z) 已完成仓库现状调查并创建 ExecPlan。
- [ ] (2026-02-12 00:00Z) 完成 Docker Compose 的 PostgreSQL 基线与环境变量约定。
- [ ] (2026-02-12 00:00Z) 完成 WorkspaceSession 领域命名与核心内存模型重命名。
- [ ] (2026-02-12 00:00Z) 完成 Drizzle schema 与迁移基线，并能成功迁移。
- [ ] (2026-02-12 00:00Z) 完成 Bun + Elysia 的 core-daemon 启动与 `/health` 校验。

## Surprises & Discoveries

- 现状：`apps/core-daemon/src/main.ts` 为空，`packages/database/schemas/index.ts` 为空，`packages/agent/src/index.ts` 为空，`packages/core/src/index.ts` 仍是内存态 DemoSession 实现。
  Evidence: 直接查看上述文件无业务实现。

## Decision Log

- Decision: 将 DemoSession 命名统一为 WorkspaceSession。
  Rationale: “Demo” 误导目标定位，而 WorkspaceSession 同时覆盖维护已有项目与原型开发。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: core-daemon 使用 Bun 运行时与 Elysia 框架。
  Rationale: 与当前选型对齐，便于后续 OpenAPI 与类型系统一体化。
  Date/Author: 2026-02-12 / Wibus + Codex

- Decision: 数据库使用 Docker Compose 启动的 `postgres:latest`。
  Rationale: MVP 以可用性与快速迭代为优先，镜像升级风险可通过版本锁定后续处理。
  Date/Author: 2026-02-12 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

当前仓库为 pnpm + Turborepo 的单体仓库。`apps/core-daemon` 是核心后端入口，但目前没有实现；`packages/core` 中已有一个内存态 Core 类，依赖 `packages/domain` 的 DemoSession 类型；`packages/database/schemas` 尚无表定义；`apps/bot-telegram` 仅有最小化 /start 响应。这里的“Core Daemon”指的是统一管理 WorkspaceSession 与 Run 的后端进程；“WorkspaceSession”指一个与项目绑定的持久工作空间；“Run”指一个可记录日志和工具调用的执行单元。

## Plan of Work

先建立可复现的数据库基础与配置约束，在 `infra/docker/docker-compose.yml` 中定义 `postgres:latest`，并在 core-daemon 的环境变量中提供 `DATABASE_URL` 与端口约定。随后完成 DemoSession 到 WorkspaceSession 的全链路命名调整，覆盖 `packages/domain` 与 `packages/core`，保持内存实现可以继续工作但不再使用旧名。接着引入 Drizzle 的 schema 与迁移基线，在 `packages/database/schemas` 下定义表与公共字段 helpers，并建立 `drizzle.config.ts` 连接到该 schema。最后以 Bun + Elysia 方式补齐 `apps/core-daemon/src/main.ts`，在 `/health` 内执行一个最小 `select 1` 来验证数据库连通性，并输出结构化 JSON 结果。

为了降低 Bun 与 Drizzle 驱动兼容性风险，需要增加一个短生命周期的 db-smoke 脚本（例如 `apps/core-daemon/dev/db-smoke.ts`）来验证连接与简单查询。如果失败，优先切换到 `postgres-js` 以外的驱动或调整连接方式，再继续下游工作。

## Concrete Steps

在仓库根目录执行依赖安装并启动数据库：

    pnpm install
    docker compose -f infra/docker/docker-compose.yml up -d
    docker compose -f infra/docker/docker-compose.yml ps

新增或修改核心文件后，生成并执行迁移：

    pnpm run db:generate
    pnpm run db:migrate

启动 core-daemon（按本计划添加的脚本名为准，例如 `dev`）：

    pnpm --filter @bbot/core-daemon run dev

健康检查：

    curl -i http://localhost:3001/health

## Validation and Acceptance

启动数据库与 core-daemon 后，访问 `http://localhost:3001/health` 应返回 HTTP 200，响应体是 JSON 且包含 `status: "ok"` 与 `db: "ok"`。`pnpm run db:migrate` 应成功执行，不出现 schema 缺失或连接失败错误。

## Idempotence and Recovery

Docker Compose 可重复执行 `up -d` 且不破坏数据。迁移失败时先修复 schema 或配置，再重复执行 `pnpm run db:migrate`。若需要完全重置数据库，可停止并移除容器与卷后重新启动，但必须在文档中明确该操作会清空数据。

## Artifacts and Notes

健康检查期望输出示例：

    HTTP/1.1 200 OK
    content-type: application/json

    {"status":"ok","db":"ok"}

## Interfaces and Dependencies

本计划依赖 Bun、Elysia、Drizzle ORM、PostgreSQL 与 zod。配置解析推荐集中在 `apps/core-daemon/src/config.ts`，并导出 `config.databaseUrl` 与 `config.port`。数据库 schema 必须使用 `packages/database/schemas` 作为唯一来源，并在 `packages/database/src/index.ts` 导出可复用的 `db` 实例。

执行前需阅读以下技能指南以保持风格一致：`.agents/skills/project-overview/SKILL.md`、`.agents/skills/drizzle/SKILL.md`、`.agents/skills/typescript/SKILL.md`、`.agents/skills/turborepo/SKILL.md`。
