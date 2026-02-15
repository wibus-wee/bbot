# Core daemon requestId + logger

本 ExecPlan 是一个持续维护的文档，`Progress`、`Surprises & Discoveries`、`Decision Log` 与 `Outcomes & Retrospective` 必须随着执行更新。

本仓库包含 `/.agents/PLANS.md`，本 ExecPlan 必须遵循该文件要求并保持同步更新。

## Purpose / Big Picture

完成后，core-daemon 的每个 HTTP 请求都会得到一个可追踪的 request id（响应头 `x-request-id`），并在日志中输出结构化记录。使用者可以通过该 request id 把客户端请求与服务端日志一一对应，快速定位错误或性能问题。验证方式是启动 core-daemon 后访问 `/health`，在响应头看到 `x-request-id`，并在终端日志看到包含 request id 的请求起止日志。

## Progress

- [x] (2026-02-14 11:15Z) 完成现状调查与 ExecPlan 起草。
- [x] (2026-02-14 11:31Z) 使用 pino 实现共享 logger 与 request id 生成逻辑。
- [x] (2026-02-14 11:31Z) 在 core-daemon 插件中注入 request id 与请求日志。
- [x] (2026-02-14 11:31Z) 更新 `docs/roadmaps/MVP.md` 的 M0-LOG-01 状态。
- [x] (2026-02-14 11:34Z) 运行 `pnpm run check-types` 并确认无 TypeScript 错误。
- [x] (2026-02-14 11:48Z) 为 bot-telegram 的 core API 调用补齐 request id 透传。
- [x] (2026-02-14 11:51Z) 再次运行 `pnpm run check-types` 并确认无 TypeScript 错误。
- [ ] 完成手动验证并补充证据。

## Surprises & Discoveries

- Observation: core-daemon 未发现 request id 或统一 logger 相关实现，仅有直接的 `console.log`。
  Evidence: `apps/core-daemon/src/main.ts` 仅输出启动日志；`apps/core-daemon/src/plugins` 仅包含 `auth.ts` 与 `openapi.ts`。

## Decision Log

- Decision: 使用 `@bbot/shared` 提供的 `createId` 生成 request id，并在 `packages/shared` 内新增基于 pino 的结构化 logger。
  Rationale: 使用专用 logger 库获得稳定的 JSON 格式与可扩展的 child logger；同时复用现有 `nanoid`。
  Date/Author: 2026-02-14 / Wibus + Codex

- Decision: request id 通过响应头 `x-request-id` 返回，并允许读取同名请求头以实现上游透传。
  Rationale: 与常见实践一致，便于客户端链路追踪；透传可与网关/代理统一追踪链路。
  Date/Author: 2026-02-14 / Wibus + Codex

## Outcomes & Retrospective

尚未执行。

## Context and Orientation

core-daemon 入口位于 `apps/core-daemon/src/app.ts`，通过 Elysia 组装路由和插件；`apps/core-daemon/src/plugins/auth.ts` 是现有插件的参考模式。`packages/shared/src/index.ts` 导出通用工具，并已包含 `createId`（基于 `nanoid`）。本任务会新增基于 pino 的结构化 logger 并在 core-daemon 注入 request id。此处的 request id 指一个用于跨请求追踪的字符串标识；logger 指将结构化字段输出到标准输出的工具函数集合。

## Plan of Work

先在 `packages/shared` 新增一个基于 pino 的 logger 模块，提供 `createLogger` 与 `Logger` 类型，输出稳定的 JSON 行并支持 child logger 追加字段，同时把该模块从 `packages/shared/src/index.ts` 导出。然后在 `apps/core-daemon/src/plugins` 新增请求日志插件，使用 Elysia 的生命周期钩子为每个请求生成 request id、记录开始时间，并在 `onRequest`/`onAfterHandle`/`onError` 中输出请求日志，同时设置响应头 `x-request-id`。在 `apps/core-daemon/src/app.ts` 注入该插件，确保在 auth 之前执行，并把启动日志迁移到共享 logger。随后在 `apps/bot-telegram/src/api.ts` 为所有 core API 调用加入 `x-request-id` 透传，并在命令处理与 `streamRun` 中生成并传递 request id。完成实现后更新 `docs/roadmaps/MVP.md` 的 M0-LOG-01 为 DONE，并运行 `pnpm run check-types` 做类型校验。

## Concrete Steps

在仓库根目录执行以下步骤（路径为仓库相对路径）：

1) 新增共享 logger 模块并导出。
   - 新建 `packages/shared/src/logger.ts`，实现 `createLogger` 与 `Logger` 类型。
   - 修改 `packages/shared/src/index.ts` 导出该模块。

   使用 pnpm 添加依赖：

   pnpm --filter @bbot/shared add pino

2) 新增 core-daemon 请求日志插件。
   - 新建 `apps/core-daemon/src/plugins/request-logger.ts`。
   - 使用 `createId("req")` 生成 request id（若请求头 `x-request-id` 已存在则复用）。
   - 设置响应头 `x-request-id` 并在请求开始/结束/错误时记录日志。

3) 在 `apps/core-daemon/src/app.ts` 中 `.use(requestLogger)`，放在 `openapiPlugin` 之后、`authGuard` 之前。

4) 在 `apps/core-daemon/src/main.ts` 使用共享 logger 替换 `console.log` 启动日志。

5) 更新 bot-telegram 的 API 访问与流式请求，透传 request id。
   - 修改 `apps/bot-telegram/src/api.ts`，给所有 core API 调用增加可选 `requestId` 并设置 `x-request-id`。
   - 新增 `apps/bot-telegram/src/request-id.ts`。
   - 在 `apps/bot-telegram/src/bot.ts` 与 `apps/bot-telegram/src/commands/*` 生成 request id 并传入。
   - 在 `apps/bot-telegram/src/stream.ts` 将 `x-request-id` 传入 SSE 请求。

6) 更新 `docs/roadmaps/MVP.md`：将 M0-LOG-01 状态改为 DONE。

7) 运行类型检查（从仓库根目录）：

   pnpm run check-types

   预期结果：命令退出码为 0，无 TypeScript 错误输出。

8) 手动验证（从仓库根目录）：

   pnpm --filter @bbot/core-daemon run dev

   在新终端执行：

   curl -i http://localhost:3001/health

   预期结果：响应头包含 `x-request-id`，并在 core-daemon 终端看到 JSON 日志行（包含 request id、method、path、status、durationMs）。

## Validation and Acceptance

验证通过的标准：

- `curl -i http://localhost:3001/health` 的响应头包含 `x-request-id`，值为 `req_` 前缀或上游透传值。
- core-daemon 控制台输出两条结构化日志行（请求开始与结束，或开始与错误），字段包含 `requestId`、`method`、`path`、`status` 与 `durationMs`。
- `pnpm run check-types` 完成且无错误。

## Idempotence and Recovery

本改动仅新增文件与插件注入，可重复执行而不产生副作用。若日志输出格式不符合预期，可在 `packages/shared/src/logger.ts` 中调整字段，并重新运行类型检查与手动验证即可。

## Artifacts and Notes

期望日志示例（JSON 行，字段顺序不限）：

  {"level":"info","message":"request.start","requestId":"req_xxxxxx","method":"GET","path":"/health"}
  {"level":"info","message":"request.completed","requestId":"req_xxxxxx","method":"GET","path":"/health","status":200,"durationMs":3}

期望响应头示例：

  x-request-id: req_xxxxxx

## Interfaces and Dependencies

- `packages/shared/src/logger.ts`：新增 `createLogger(fields?: Record<string, unknown>)`，返回 pino logger 并支持 child logger 追加字段。
- `packages/shared/src/index.ts`：导出 `createLogger` 与 `Logger` 类型。
- `apps/core-daemon/src/plugins/request-logger.ts`：新增插件，导出 `requestLogger`，内部使用 `createId` 与 `createLogger`。
- `apps/core-daemon/src/app.ts`：在应用创建时 `.use(requestLogger)`。
- `apps/bot-telegram/src/api.ts`：为 core API 调用增加 `requestId` 并透传到 `x-request-id`。
- `apps/bot-telegram/src/request-id.ts`：生成 request id。
- `apps/bot-telegram/src/bot.ts` 与 `apps/bot-telegram/src/commands/*`：生成并传递 request id。
- `apps/bot-telegram/src/stream.ts`：SSE 请求透传 `x-request-id`。

变更记录：初始创建 ExecPlan 于 2026-02-14，用于补齐 M0-LOG-01。
变更记录：2026-02-14 根据要求改为使用 pino，并同步更新步骤与进度状态。
变更记录：2026-02-14 增加 bot-telegram 的 request id 透传接入说明，并更新进度。
