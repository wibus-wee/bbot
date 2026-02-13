# Centralize Repo-Root Env Loading with Shared Parser + Turbo Option B

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md is checked in at `/.agents/PLANS.md`. This document must be maintained in accordance with that file.

## Purpose / Big Picture

完成后，所有应用在任何工作目录下运行时都会从各自应用目录加载 `.env`，并且环境变量解析逻辑集中在 `packages/shared`。同时，Turborepo 采用 Option B：显式声明环境变量列表，但仅在真正需要 env 的任务上生效，避免编译类任务因 `.env` 变化而无意义失效。可观察行为是：在 repo 根目录执行 `pnpm --filter @bbot/core-daemon dev` 或 `pnpm --filter @bbot/bot-telegram dev` 时，能够读取各自应用目录中的 `.env` 变量；当对应 `.env` 变化时，相关的 dev 任务会重新运行，而不影响无关的 build/check-types 任务。

## Progress

- [x] (2026-02-12 18:05Z) 创建 ExecPlan，完成上下文调研并记录关键约束。
- [x] (2026-02-12 18:25Z) 实现 shared env 解析模块并接入 bot-telegram / core-daemon。
- [x] (2026-02-12 18:25Z) 引入 env key registry + turbo 同步脚本，更新 `turbo.json` 为 Option B。
- [ ] 验证运行与缓存行为，记录结果。

## Surprises & Discoveries

- Observation: Turborepo 在包目录下执行任务时，`dotenv/config` 默认只会加载该包目录下的 `.env`，不会自动读取 repo root。
  Evidence: 当前 `apps/bot-telegram/src/main.ts` 与 `apps/core-daemon/src/main.ts` 依赖 `dotenv/config`，但 Turbo 任务工作目录是包目录。
- Observation: Turbo 的缓存哈希是在任务启动前计算的，`dotenv` 在进程内加载的变量不会自动进入缓存哈希。
  Evidence: Turbo 文档强调需要将 `.env` 放入 `inputs` 才能触发缓存失效（仓库现有 `turbo.json` 已在 build 里这样做）。

## Decision Log

- Decision: 采用 Option B（任务级 `env` 列表 + `.env` inputs），不使用 `globalEnv`，避免 env 变化影响编译缓存；shared env loader 负责统一加载应用目录 `.env`。
  Rationale: `env` 只应影响确实读取 env 的任务；避免编译类任务在 runtime env 变化时失效，并明确 env 边界在 app 目录。
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

- Not started yet.

## Context and Orientation

当前仓库为 pnpm + Turborepo monorepo。应用目录下各自维护 `.env` 文件，且多个应用通过 env loader 读取环境变量。核心相关文件如下：

- `apps/bot-telegram/src/main.ts`：读取 `process.env.BOT_TOKEN` 并启动 Telegram Bot。
- `apps/core-daemon/src/config.ts`：用 Zod 解析 `process.env`，包含 `DATABASE_URL/PORT/CORE_API_TOKEN/NODE_ENV`。
- `packages/shared/src/index.ts`：目前仅导出 `createId`。
- `turbo.json`：当前在 `build` 任务中把 `.env*` 作为 inputs，导致所有 build 都受 `.env` 影响。

这里“Option B”指的是：使用 Turbo 的任务级 `env` 明确声明需要参与哈希的环境变量，并且只对实际依赖 `.env` 的任务添加 `.env` 作为 inputs，不影响编译类任务。

## Plan of Work

首先在 `packages/shared` 新增 env 解析模块，确保任何包在自己的工作目录运行时，也能稳定找到应用目录 `.env` 并完成 Zod 校验。该模块需要：

1) 可重复调用而不重复加载 `.env`。
2) 通过工作目录定位应用根目录（默认 `process.cwd()`）。
3) 暴露一个 `loadEnv(schema)` 方法，先加载应用目录 `.env`，再用 Zod 解析 `process.env`。
4) 提供应用级 env key 常量数组，作为各应用环境变量的单一来源。

随后修改 app 入口使用 shared env loader：

- `apps/bot-telegram/src/main.ts` 改为 `loadEnv` + Zod schema 校验 `BOT_TOKEN`。
- `apps/core-daemon/src/config.ts` 改为先 `loadEnv`，再解析自身 schema，避免重复逻辑。

接着实现 Turbo Option B：

- 移除 `build.inputs` 中的 `.env*`，避免所有 build 被 `.env` 影响。
- 在需要 env 的应用包内新增 `turbo.json` 覆盖配置，给 `dev`（以及其它实际依赖 env 的任务）加 `env` 与 `inputs`：
  - `env`: 由应用级 env key 常量生成
  - `inputs`: `"$TURBO_DEFAULT$"`, `".env"`, `".env.*"`

为了减少人工同步成本，在 `tooling/scripts` 中新增 `sync-turbo-env.ts`：

- 读取 `packages/shared/src/env/keys.ts` 中的应用级 env key 常量。
- 更新 `apps/bot-telegram/turbo.json` 与 `apps/core-daemon/turbo.json` 中 `dev` 任务的 `env` 列表（按字母排序）。
- 提供 root 脚本 `pnpm run turbo:sync-env` 供日常维护。

## Concrete Steps

在 repo 根目录执行下列步骤（命令与文件路径需要逐字一致）：

1) 新增 shared env 模块文件。

    创建 `packages/shared/src/env/index.ts` 与 `packages/shared/src/env/keys.ts`。

    `index.ts` 中实现：

        - resolveRepoRoot(startDir?: string): string | null
        - loadRepoDotenv(): void (只加载一次)
        - loadEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T>

2) 更新 `packages/shared/src/index.ts`，导出 env 模块。

3) 更新应用入口：

    - `apps/bot-telegram/src/main.ts` 用 `loadEnv` 替换 `process.env` 直接读取。
    - `apps/core-daemon/src/config.ts` 调用 `loadEnv` 后再做 Zod parse。

4) 更新依赖与配置：

    - 在 `packages/shared/package.json` 增加 `dotenv` 与 `zod` 依赖（如果 zod 已在上层使用，仍需明确依赖）。
    - 在 `turbo.json` 移除 `build.inputs` 中的 `.env*`。
    - 在 `apps/bot-telegram/turbo.json` 与 `apps/core-daemon/turbo.json` 添加包级任务配置覆盖（`extends: ["//"]`）。

5) 新增同步脚本：

    - 创建 `tooling/scripts/sync-turbo-env.ts`。
    - 在 root `package.json` 增加脚本 `turbo:sync-env` 指向该脚本。

## Validation and Acceptance

1) 运行 Bot：

    在 repo 根目录执行：

        pnpm --filter @bbot/bot-telegram dev

    预期：若 `apps/bot-telegram/.env` 中有 `BOT_TOKEN`，Bot 正常启动；缺失时应报 “Missing BOT_TOKEN” 或 Zod 校验错误。

2) 运行 Core Daemon：

        pnpm --filter @bbot/core-daemon dev

    预期：若 `apps/core-daemon/.env` 中设置 `PORT` 或 `DATABASE_URL`，日志应使用对应值；否则使用默认值。

3) 校验 Turbo 配置同步：

        pnpm turbo:sync-env

    预期：应用包级 `turbo.json` 的 `env` 列表更新为与应用级 env key 常量一致的列表，重复运行不会产生额外差异。

4) 观察缓存粒度：

    - 修改 `apps/*/.env` 后运行 `turbo run build`，预期只有 env 相关任务（或配置指定的任务）受影响。
    - 修改对应应用的 `.env` 后运行 `turbo run dev`，预期相关应用重新启动。

## Idempotence and Recovery

所有步骤均为可重复执行的增量修改，不包含破坏性操作。`sync-turbo-env` 可重复运行，若产生异常差异可回退 `turbo.json` 或重跑脚本恢复。

## Artifacts and Notes

示例（预期新增的 `apps/bot-telegram/turbo.json` 结构）：

    {
      "extends": ["//"],
      "tasks": {
        "dev": {
          "inputs": [
            "$TURBO_DEFAULT$",
            "$TURBO_ROOT$/.env",
            "$TURBO_ROOT$/.env.*"
          ]
        }
      }
    }

## Interfaces and Dependencies

- `packages/shared/src/env/index.ts` 需要依赖 `dotenv` 与 `zod`。
- `loadEnv` 的签名必须保持：

    export const loadEnv = <T extends z.ZodTypeAny>(schema: T): z.infer<T> => { ... }

- `packages/shared/src/env/keys.ts` 必须导出应用级 env 列表：

    export const BOT_TELEGRAM_ENV_KEYS: readonly string[]
    export const CORE_DAEMON_ENV_KEYS: readonly string[]

- `tooling/scripts/sync-turbo-env.ts` 需要能读取应用级 env 列表，并稳定修改应用包级 `turbo.json` 中 `dev` 任务的 `env` 列表。

---

Plan change note: 从 root `.env` 切换为应用目录 `.env`，并保持任务级 `env` 列表，避免 runtime env 变化影响编译缓存；同步脚本改为更新应用包级 `turbo.json`。
