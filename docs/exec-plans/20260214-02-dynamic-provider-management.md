# Dynamic Agent Provider Management

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The PLANS.md requirements live at `.agents/PLANS.md` from the repository root. This plan must be maintained in accordance with that file.

## Purpose / Big Picture

这次改动的目标是让运行中的系统可以通过 HTTP 接口动态增删 LLM 提供商（provider），并且真正的运行配置直接来自数据库（`system_configs`），而不是环境变量。完成后，用户可以在不重启服务的情况下，用接口添加一个 provider、切换当前 provider、删除 provider，然后触发一个新的 run，并看到该 run 使用新的 provider 配置生效。

## Progress

- [x] (2026-02-14 20:10Z) 创建 ExecPlan 并完成相关代码阅读与决策。
- [x] (2026-02-14 20:32Z) 实现 provider 管理接口（协议、路由、持久化）并保证响应不泄露明文 API key。
- [x] (2026-02-14 20:34Z) 实现从数据库读取 provider 配置的 runtime resolver，并接入 runs/compaction。
- [x] (2026-02-14 20:36Z) 调整 agent runtime 配置与 compactor 的 API key 获取路径，避免依赖 env。
- [x] (2026-02-14 20:37Z) 运行 SDK 生成与类型检查，完成验证与记录。
- [x] (2026-02-14 20:38Z) 添加从 .env 导入 provider 的临时迁移脚本。

## Surprises & Discoveries

- Observation: `@mariozechner/pi-agent-core` 支持 `getApiKey` 回调，允许每次 LLM 调用动态获取 key。
  Evidence: `node_modules/.pnpm/@mariozechner+pi-agent-core@0.52.9_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-agent-core/dist/agent.d.ts`。
- Observation: `getModel` 在找不到模型时返回 `undefined`，需要显式校验以避免运行时崩溃。
  Evidence: `node_modules/.pnpm/@mariozechner+pi-ai@0.52.9_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/models.js`。

## Decision Log

- Decision: Provider 配置完全存储在 `system_configs` 中，不再依赖环境变量，运行时直接读取数据库。
  Rationale: 满足“运行时动态增删”与“不使用 env”诉求。
  Date/Author: 2026-02-14, Wee

- Decision: Provider 限制为 `KnownProvider`（`pi-ai` 内置 provider），模型限制为该 provider 的内置模型列表。
  Rationale: 现有 `getModel` 只支持内置模型，强行允许未知模型会导致运行时 `undefined`。
  Date/Author: 2026-02-14, Wee

- Decision: 使用 `system_configs` 的两个 key 管理 provider 列表与当前激活项：`agent.providers` 与 `agent.activeProviderId`。
  Rationale: 复用现有表与 CRUD，减少 schema 改动。
  Date/Author: 2026-02-14, Wee

- Decision: 新增独立的 provider 管理接口（`/agent/providers`），不直接暴露 `system_configs`。
  Rationale: 需要强校验与脱敏输出，避免明文 key 泄露。
  Date/Author: 2026-02-14, Wee

- Decision: 当 `activeProviderId` 缺失且仅存在一个 provider 时，运行时自动使用该 provider。
  Rationale: 降低首次迁移的摩擦，同时避免在多 provider 下隐式选择。
  Date/Author: 2026-02-14, Wee

- Decision: 对已知依赖 API key 的 provider 强制校验 `apiKey` 是否存在，`amazon-bedrock` 与 `google-vertex` 允许为空。
  Rationale: 避免无 key 的 provider 在运行时隐式回退到环境变量。
  Date/Author: 2026-02-14, Wee

- Decision: DB 驱动的运行时默认禁用 MCP（`mcpServers: []`）。
  Rationale: 现阶段未实现 MCP 的 DB 配置与权限控制，先保持安全默认值。
  Date/Author: 2026-02-14, Wee

## Outcomes & Retrospective

已完成 provider 管理接口与运行时接入，系统配置不再依赖 env 读取 provider 信息。迁移脚本可一键把现有 .env 中的 provider 配置写入数据库。遗留事项主要是密钥加密与 MCP 配置的 DB 化。

## Context and Orientation

本仓库的核心入口是 `apps/core-daemon`，它是一个 Elysia HTTP 服务，负责处理所有 run 与工作区（workspace）的生命周期。LLM 调用发生在 `packages/agent`，其中 `runAgent` 会构建系统 prompt、选择模型，并创建 `@mariozechner/pi-agent-core` 的 `Agent`。

目前全局配置存储在 `system_configs` 表（`packages/database/schemas/index.ts`），并通过 `apps/core-daemon/src/modules/system-configs` 提供 CRUD API。`RunDispatcher`（`apps/core-daemon/src/modules/runs/dispatcher.ts`）在每次运行时会调用 `runAgent`，但它现在只使用 `loadAgentConfig()`（基于环境变量）。Compaction（`packages/agent/src/compaction/compactor.ts`）也通过 `getEnvApiKey` 从环境变量取 key。

“Provider” 在此计划中指 `@mariozechner/pi-ai` 内置的 `KnownProvider`（例如 `openai`, `anthropic` 等）。本计划不涉及 ACP，也不允许通过接口配置 ACP 命令。

## Plan of Work

第一步是定义 provider 管理接口与协议类型。在 `packages/protocol/src/schema` 新增 `agent-providers.ts`，定义请求与响应的 Zod schema，包括 provider 列表响应、创建/更新请求、激活请求等。响应必须脱敏 API key，只暴露 `apiKeyPreview`（例如后四位）和 `hasApiKey`。在 `packages/protocol/src/index.ts` 中导出该 schema，使 core-daemon 能复用。

第二步是在 core-daemon 添加一个新的模块，例如 `apps/core-daemon/src/modules/agent-providers`，并在 `apps/core-daemon/src/app.ts` 注册。模块内部应通过 `system_configs` 读写两个 key：`agent.providers`（数组）与 `agent.activeProviderId`（当前 ID）。需要实现以下行为：

当 `GET /agent/providers` 被调用时，返回当前 provider 列表与 `activeProviderId`；当 `POST /agent/providers` 被调用时，创建新的 provider（使用 `createId("provider")` 生成 ID）并可选激活；当 `PUT /agent/providers/:id` 被调用时，更新已存在 provider，若 `apiKey` 未提供则保持旧值；当 `DELETE /agent/providers/:id` 被调用时，如果该 provider 处于激活状态则返回 409，要求先切换；当 `POST /agent/providers/:id/activate` 被调用时，更新 `agent.activeProviderId`。

第三步是实现运行时配置解析。新增一个 resolver（例如 `apps/core-daemon/src/modules/agent-providers/runtime.ts`），它会读取 `agent.providers` 与 `agent.activeProviderId`，校验 provider 与 model 是否属于 `pi-ai` 内置集合（使用 `getProviders()` 与 `getModels(provider)`），并构造 `AgentRuntimeConfig`。该 resolver 还必须提供 API key 给 agent runtime：在 `runAgent` 创建 `Agent` 时传入 `getApiKey` 回调。为了做到这一点，需要在 `packages/agent/src/config.ts` 增加 `apiKey?: string` 与 `headers?: Record<string, string>` 字段，并在 `packages/agent/src/index.ts` 使用它们组装 `Model` 和 `Agent`。

第四步是接入 runs 与 compaction。`apps/core-daemon/src/modules/runs/dispatcher.ts` 中应改为使用新的 resolver，而不是 `loadAgentConfig()`；`apps/core-daemon/src/modules/workspaces/service.ts` 中的 compaction 逻辑也应改为使用该 resolver，并将 `apiKey` 传入 `compactMessages`。`packages/agent/src/compaction/compactor.ts` 需要支持显式 `apiKey` 参数，优先使用传入的 key，避免依赖 `getEnvApiKey`。

最后，运行 SDK 生成与类型检查，确保协议与接口一致。

补充：提供一个临时迁移脚本，将现有 `.env` 的 `AGENT_PROVIDER/AGENT_MODEL/AGENT_BASE_URL` 与对应 API key 写入 `system_configs`，并设置为 active provider。

## Concrete Steps

在仓库根目录执行以下步骤：

1) 新增协议 schema 并导出。

   修改文件：
   - `packages/protocol/src/schema/agent-providers.ts`（新增）
   - `packages/protocol/src/index.ts`

2) 新增 core-daemon provider 模块与 service。

   修改或新增文件：
   - `apps/core-daemon/src/modules/agent-providers/index.ts`
   - `apps/core-daemon/src/modules/agent-providers/service.ts`
   - `apps/core-daemon/src/modules/agent-providers/runtime.ts`
   - `apps/core-daemon/src/app.ts`

3) 调整 agent runtime 与 compaction。

   修改文件：
   - `packages/agent/src/config.ts`
   - `packages/agent/src/index.ts`
   - `packages/agent/src/compaction/compactor.ts`
   - `apps/core-daemon/src/modules/runs/dispatcher.ts`
   - `apps/core-daemon/src/modules/workspaces/service.ts`

4) 生成 SDK 与类型检查。

   在仓库根目录执行：

     pnpm run workflow:sdk
     pnpm run check-types

预期现象：SDK 生成后包含新的 `/agent/providers` 相关方法；类型检查无报错。

5) 运行临时迁移脚本（可选，用于把当前 .env 写入数据库）。

     pnpm tsx tooling/scripts/migrate-agent-providers.ts

## Validation and Acceptance

启动 core-daemon 后，使用 curl 验证行为（示例请求仅展示形状）：

- 添加 provider：

    curl -X POST http://localhost:3001/agent/providers \
      -H "Authorization: Bearer <CORE_API_TOKEN>" \
      -H "Content-Type: application/json" \
      -d '{"provider":"openai","model":"gpt-5.2-codex","apiKey":"sk-...","baseUrl":"https://api.openai.com/v1","activate":true}'

  预期：返回 JSON 中包含新 provider 的 `id`，并且 `apiKeyPreview` 只有后四位。

- 列出 provider：

    curl http://localhost:3001/agent/providers \
      -H "Authorization: Bearer <CORE_API_TOKEN>"

  预期：响应包含 `activeProviderId`，providers 列表不包含明文 `apiKey`。

- 激活 provider：

    curl -X POST http://localhost:3001/agent/providers/<id>/activate \
      -H "Authorization: Bearer <CORE_API_TOKEN>"

  预期：`activeProviderId` 更新为目标 ID。

- 删除激活中的 provider：

    curl -X DELETE http://localhost:3001/agent/providers/<id> \
      -H "Authorization: Bearer <CORE_API_TOKEN>"

  预期：返回 409，提示先切换 active provider。

然后创建一个 run（使用现有 `/workspaces/:id/runs` 接口），观察 run 成功并使用新 provider。若 provider 配置无效，应得到明确的错误并记录为 failed。

## Idempotence and Recovery

所有步骤均为可重复执行的配置操作，不涉及数据库 schema 迁移。重复创建 provider 时应返回新的 ID；更新/激活操作可以重复调用。若配置错误导致 run 失败，切换 `activeProviderId` 或修复该 provider 后再次创建 run 即可恢复。

## Artifacts and Notes

以下是 `agent.providers` 在 `system_configs` 中的推荐存储形状（示例）：

    {
      "id": "provider_abc123",
      "provider": "openai",
      "model": "gpt-5.2-codex",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "headers": { "OpenAI-Beta": "responses=1" },
      "createdAt": "2026-02-14T20:00:00.000Z",
      "updatedAt": "2026-02-14T20:00:00.000Z"
    }

## Interfaces and Dependencies

在 `packages/protocol/src/schema/agent-providers.ts` 中定义并导出以下 schema 与类型：

- `agentProviderResponse`：用于单个 provider 的返回，包含 `id`, `provider`, `model`, `baseUrl`, `headers`, `apiKeyPreview`, `hasApiKey`, `createdAt`, `updatedAt`。
- `agentProviderListResponse`：包含 `activeProviderId` 与 `providers` 列表。
- `createAgentProviderBody`：用于创建 provider，字段包含 `provider`, `model`, `apiKey`, 可选 `baseUrl`, `headers`, `activate`。
- `updateAgentProviderBody`：用于更新 provider，字段可选，若不传 `apiKey` 则保留原值。

在 `apps/core-daemon/src/modules/agent-providers/runtime.ts` 中定义：

- `resolveAgentRuntimeConfig(db: Database): Promise<AgentRuntimeConfig>`，从 `system_configs` 读取 provider，并返回运行时配置；如果没有 active provider，则抛出可读错误。

在 `packages/agent/src/index.ts` 中确保：

- 如果 `config.apiKey` 存在，则向 `Agent` 传入 `getApiKey`，只对当前 provider 返回该 key。
- 构造 `model` 时合并 `baseUrl` 与 `headers`。

在 `packages/agent/src/compaction/compactor.ts` 中确保：

- `compactMessages` 支持可选 `apiKey` 参数，并在 summarization 调用中优先使用该 key。

Plan updated 2026-02-14: Marked implementation complete, added migration script, and recorded new runtime decisions.
