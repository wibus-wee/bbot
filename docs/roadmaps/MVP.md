# MVP Roadmap

**范围与目标**
- 单用户、本地 Core Daemon、pi-mono Agent Runtime
- Telegram 作为首入口，能在 Telegram 内驱动开发本仓库（自举）
- Agent 可持久 Session、可执行 Tool、可审计 Run
- 数据持久化（Drizzle + PostgreSQL）
- Web/TUI 仅提供最小可控入口

**里程碑**

| Milestone | Focus | Exit Criteria |
| --- | --- | --- |
| M0 | 基础工程与配置 | 能本地启动 core-daemon 空服务并连通 DB |
| M1 | 领域模型与持久化 | WorkspaceSession/Run/ToolCall 等核心表可用 |
| M2 | Core API 与 SDK | 核心命令/查询 API 与 SDK 贯通 |
| M3 | Agent Runtime 与 Tools | pi-mono 工具调用闭环可跑通 |
| M4 | Telegram 入口 | Telegram 可创建会话、触发任务、接收日志 |
| M5 | 最小多入口与测试 | Web/TUI 最小入口 + BDD 核流程可验证 |

**任务清单**

| ID | Task | Scope | Depends On | Deliverable | Acceptance | Status | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0-ENV-01 | 定义统一配置与环境变量 schema | `apps/core-daemon`, `packages/shared` |  | `config.ts` + `.env.example` | 启动失败时给出明确缺失项 | TODO | TBD |
| M0-CORE-01 | core-daemon Elysia skeleton + health | `apps/core-daemon` | M0-ENV-01 | `/health` endpoint | `curl /health` 返回 200 | TODO | TBD |
| M0-INFRA-01 | Docker Compose 提供 PostgreSQL | `infra/docker` |  | `docker-compose.yml` | `postgres:latest` 暴露端口可连接 | TODO | TBD |
| M0-DB-01 | Postgres 连接初始化与迁移基线 | `packages/adapters`, `packages/core` | M0-ENV-01, M0-INFRA-01 | DB client + migration runner | 能执行一次空迁移 | TODO | TBD |
| M0-LOG-01 | 统一日志与请求追踪 | `apps/core-daemon`, `packages/shared` | M0-CORE-01 | logger + requestId | 每个请求可追踪 | TODO | TBD |
| M1-DOMAIN-01 | 设计 WorkspaceSession/Run/ToolCall/EventLog 领域模型 | `packages/domain` | M0-DB-01 | domain types | 领域模型可被 core 引用 | TODO | TBD |
| M1-DB-02 | Drizzle schema + migrations | `packages/database` | M1-DOMAIN-01 | tables + migrations | `drizzle` 生成并可 migrate | TODO | TBD |
| M1-CORE-02 | Session/Run repository | `packages/core` | M1-DB-02 | repo interfaces + implementations | CRUD 可用且覆盖基础校验 | TODO | TBD |
| M1-PROTOCOL-01 | 定义稳定 DTO 与事件协议 | `packages/protocol` | M1-DOMAIN-01 | DTO schemas | DTO 与 domain 映射明确 | TODO | TBD |
| M2-API-00 | 定义 OpenAPI Spec（单一真相） | `apps/core-daemon`, `packages/protocol` | M1-CORE-02 | `openapi.yaml` | Spec 覆盖核心资源与错误码 | TODO | TBD |
| M2-API-01 | Core API: create/list/get WorkspaceSession | `apps/core-daemon`, `packages/core` | M2-API-00 | REST endpoints | 创建后可查询回读 | TODO | TBD |
| M2-API-02 | Core API: create Run + append logs | `apps/core-daemon`, `packages/core` | M2-API-00 | Run endpoints | Run 状态可推进并可查询 | TODO | TBD |
| M2-API-03 | Core API: event stream (SSE) | `apps/core-daemon` | M2-API-02 | `/runs/:id/stream` | 客户端可实时收到日志 | TODO | TBD |
| M2-SDK-01 | heyapi 生成 TypeScript SDK | `packages/sdk` | M2-API-00 | generated client | 可一键生成并被 bot/web/tui 复用 | TODO | TBD |
| M2-AUTH-01 | 单用户鉴权策略 | `apps/core-daemon`, `packages/sdk` | M2-API-01 | token-based auth | 未授权请求返回 401 | TODO | TBD |
| M3-AGENT-01 | pi-mono model provider 接入 | `packages/agent` | M0-ENV-01 | model factory | 可切换指定 model | TODO | TBD |
| M3-AGENT-02 | Agent loop with tool calling | `packages/agent` | M3-AGENT-01 | agent runner | 工具调用闭环可完成 | TODO | TBD |
| M3-TOOLS-01 | 实现 `read`/`write`/`edit`/`search` | `packages/adapters` | M3-AGENT-02 | tool implementations | 针对 repo 可读写搜索 | TODO | TBD |
| M3-TOOLS-02 | 实现 `bash` with allowlist | `packages/adapters` | M3-TOOLS-01 | bash executor | 非允许命令被拒绝 | TODO | TBD |
| M3-TOOLS-03 | Tool 调用日志落盘 | `packages/core` | M2-API-02, M3-TOOLS-01 | tool call log | Run 可回放工具结果 | TODO | TBD |
| M3-SKILL-01 | Skills 发现与加载 | `packages/agent` | M3-TOOLS-01 | skill loader | 支持 `packages/agent/skills` 与 `./.agents/skills` | TODO | TBD |
| M3-SKILL-02 | Skills 权限边界 | `packages/agent` | M3-SKILL-01 | allowlist policy | 外部技能不能直接用 `bash` | TODO | TBD |
| M3-CTX-01 | Repo context bootstrap | `packages/agent` | M3-AGENT-02 | context builder | 自动加载 `AGENTS.md` 与 `docs/prd/*` | TODO | TBD |
| M3-RUNNER-01 | Core Run 调度器 | `packages/core` | M2-API-02, M3-AGENT-02 | run queue | Run 状态机可推进 | TODO | TBD |
| M4-BOT-01 | Telegram bot skeleton (grammY) | `apps/bot-telegram` | M2-SDK-01 | bot startup | bot 可响应 /ping | TODO | TBD |
| M4-BOT-02 | /new 创建 WorkspaceSession | `apps/bot-telegram` | M2-API-01, M4-BOT-01 | command handler | 返回 session id | TODO | TBD |
| M4-BOT-03 | 用户消息触发 Run | `apps/bot-telegram` | M2-API-02, M4-BOT-01 | message handler | 文本可创建 Run | TODO | TBD |
| M4-BOT-04 | Run 日志流式回推 | `apps/bot-telegram` | M2-API-03 | streaming relay | Telegram 可实时看到进度 | TODO | TBD |
| M4-BOT-05 | 单用户绑定与防护 | `apps/bot-telegram` | M2-AUTH-01 | allowlist | 未授权用户被拒绝 | TODO | TBD |
| M5-WEB-01 | WebUI 最小入口 | `apps/webui` | M2-SDK-01 | session list + run view | 可查看 session 和 run | TODO | TBD |
| M5-TUI-01 | TUI 最小入口 | `apps/tui` | M2-SDK-01 | session list + run view | 可查看 session 和 run | TODO | TBD |
| M5-BDD-01 | BDD: 新建会话 | `packages/testkit` | M2-API-01 | cucumber feature | 流程可复现 | TODO | TBD |
| M5-BDD-02 | BDD: 执行任务与工具调用 | `packages/testkit` | M3-TOOLS-03 | cucumber feature | 工具调用可追踪 | TODO | TBD |
| M5-BDD-03 | BDD: Telegram 入口闭环 | `packages/testkit`, `apps/bot-telegram` | M4-BOT-04 | cucumber feature | bot 到 run 闭环 | TODO | TBD |

**定义完成 (DoD)**
- Telegram 内可创建 WorkspaceSession 并持续复用
- Telegram 文本可触发 Run，Run 调用 `read/write/edit/search/bash`
- Run 日志可流式回推，结果可在 Web/TUI 继续查看
- Core Daemon 重启后会话与 Run 不丢失
- BDD 覆盖至少三个核心流程（新建、执行、回放）

**风险与注意**
- Tool `bash` 权限边界必须先落地再开放外部技能
- Repo 自举需要稳定的 context 采集策略，避免 prompt 膨胀
- SSE/streaming 需要统一背压与断线重连策略
- Bun 运行时兼容性与依赖生态需要提前验证
