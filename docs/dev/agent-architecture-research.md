# BBot 架构深度调研报告（多入口/TUI/GUI/Chat，参考 pi-mono）

> 目标：帮你把“覆盖 TUI / GUI / Chat 的统一入口 + 自举开发”的理念落成可执行路线，并给出在 BBot 仓库内可以直接落地的架构建议与开发路径。

---

## 0. TL;DR（结论先行）

**核心原则**：
1) **Core-first，Transport-thin**：核心运行时必须是唯一真相（单一 agent loop + run 事件流），TUI/GUI/Chat 都是“薄适配”。
2) **一套 Run 事件模型打通所有入口**：消息、工具、日志、状态变更都写入同一 Run 事件流，UI 只是订阅/回放。
3) **自举/狗粮优先**：BBot 自己开发 BBot（改代码、跑测试、写文档）应当是主路径；每个入口只改“展示/输入”，不改业务语义。

**你卡住的关键点**：不是“入口够不够多”，而是 **Core 的可用性**（本地可用 / 可解释 / 可回放 / 可扩展）。一旦 Core 上手、跑通和稳定，入口只是“皮肤”。

---

## 1) 你现在的仓库现状（从 bbot repo 看）

### 已有结构
- monorepo（pnpm + turbo），有 core-daemon、agent、adapters、sdk 方向的骨架。
- MVP 路线里明确了 **Core daemon + pi-mono runtime + Telegram** 作为最小可用闭环。

### 已有领域模型（MVP 里体现）
- WorkspaceSession / Run / ToolCall / EventLog（核心一致）。
- Run 的执行与日志流式回推是中心。

### 你卡住的点（我观察）
- 你想“一口气覆盖 TUI / GUI / Chat”，但目前**缺少一个“能用于日常开发/使用”的稳定核心路径**。
- 你需要的不是新入口，而是 **“一条稳定的自举路径”**，即：
  1) 本地启动 core-daemon
  2) 输入一个任务（哪怕是 CLI）
  3) core-run 触发工具调用，写回 repo
  4) run 事件可回放（让你知道发生了什么）

---

## 2) 参考架构与模式（可直接复用）

### 2.1 OpenClaw 的核心架构模式（强参考）
> 来源：OpenClaw docs（本机）

**关键点**：
- **Gateway 作为唯一入口与消息表面聚合**：所有聊天通道只连接一个 Gateway；它维护单一 Run 生命周期，并用 WS 发送事件流。
- **事件驱动 + 流式输出**：Run 的生命周期事件（start/end/error）与 assistant/tool delta 统一输出。
- **薄客户端**：客户端只订阅事件，不持有业务状态。

**启示**：
- 你需要一个“中心 Gateway/Daemon”，以 WebSocket/SSE 发出 Run 事件，TUI/GUI/Chat 都是同一事件流的订阅者。

**参考文档**：
- `/opt/homebrew/lib/node_modules/openclaw/docs/concepts/architecture.md`
- `/opt/homebrew/lib/node_modules/openclaw/docs/concepts/agent-loop.md`

---

### 2.2 pi-mono / pi-agent-core 模式（你明确采用）
> 来源：BBot 本地 `.agents/skills/pi-mono/SKILL.md`

**关键点**：
- **统一 LLM API**，跨 provider 的工具调用一致。
- **事件流驱动 agent**：message_update / tool_call / done 事件。
- **context serialization** 可恢复/回放。

**启示**：
- 你的“Run”模型可以直接对齐 pi-agent-core 的事件流；避免再发明一次事件类型。

---

### 2.3 经验性通用模式（行业共识）
> 以下为工程通用共识（非单一来源）

- **单一 Run 语义**：一个用户输入 → 一个 Run → N 个工具调用 → 1 个最终结果。
- **事件溯源**：Run 内所有事件可回放，UI 不保存业务状态。
- **工具调用落盘**：工具结果 + 参数 + 返回必须持久化，便于审计与复现。
- **可视化入口 = 只读 + 轻交互**（先读后写）。

---

## 3) 针对 BBot 的推荐架构（最小可落地）

### 3.1 一个“唯一真相”核心（Core/Daemon）

**核心职责**：
- Run 生命周期管理
- 工具调用调度
- 持久化（Run / ToolCall / EventLog）
- 事件流输出（SSE/WS）

**不要做**：
- 不要在 UI 里执行业务逻辑
- 不要让多个入口各自运行 agent loop


### 3.2 多入口只是“适配层”

**抽象方式**：
```
[Chat/TUI/GUI] -> [Transport Adapter] -> [Core API] -> [Run + Events]
```

**好处**：
- Chat/TUI/GUI 不会复制逻辑
- 所有入口共享同一 Run 事件流


### 3.3 Run 事件流（建议最小字段）

```
RunStart  {runId, sessionId, input, startedAt}
ToolCall  {toolName, args, callId}
ToolResult{callId, result, latency}
AssistantDelta {textChunk}
RunEnd    {status, result, duration}
```

**所有入口**都订阅同样事件流，只是显示形式不同。


### 3.4 “自举开发”最佳入口优先级

1) CLI / Chat（开发本体）
2) TUI / Web 只读（回放）
3) GUI / 多入口扩展

换句话说：**先做到“你每天用它开发自己”，再谈其它入口**。

---

### 3.5 BBot 现有 Run/Event 现状核对（你已经有的）

> 结论先行：**你“概念上已经有 Run 事件”**，但目前分散在 **ExecPlan 文档 + omnicore 事件总线**，需要收敛为**单一 Run 事件协议**。

**(A) 文档层已有 RunEvent 体系**
- `docs/exec-plans/archived/20260212-02-mvp-core-api-openapi.md` 明确：
  - RunEvent 追加 API 已完成（`POST /runs/:id/events`）
  - Run 的 SSE 流从数据库 `run_events` 读取
  - OpenAPI/SDK 已对齐

**(B) 代码层已有事件总线（omnicore）**
- `packages/omnicore/src/domain/events.ts` 里已有事件类型：
  - `agent.run.start` / `agent.message` / `agent.summary`
  - `action.requested` / `action.executed`（含 `tool_call`）
  - 这套事件模型已经接近 Run/Event 语义

**映射关系（建议收敛为统一 RunEvent）**
- `agent.run.start` → `run.started`
- `agent.message` → `assistant.delta` / `assistant.message`
- `action.requested` + `tool_call` → `tool.called`
- `action.executed` → `tool.result`
- `agent.summary` → `run.completed`

**落地结论**
- 你已经有“Run 事件”的**概念与部分实现**，下一步是把它**固化为唯一协议**，并让所有入口只订阅这一套流。

---

## 4) 针对“你卡住的问题”的具体建议

### 4.1 你真正缺的不是入口，而是：

- **可持续使用的最小工作流**（从输入任务到工具调用再到写回 repo）。
- **稳定的 Run 事件流**（调试友好）。
- **一个像“现实可用工具”的入口**（哪怕只是 Telegram/CLI）。


### 4.2 推荐你先把“自举路径”做完

**先完成闭环**：
1) CLI/Telegram 输入任务
2) Agent 执行工具
3) 输出写回 repo
4) Run 日志可回放

这样你就能用它开发自己，避免“空想 UI”。


### 4.3 入口扩展策略（推荐顺序）

- **Telegram / CLI（必做）**
- **TUI 只读 Run Stream（可选）**
- **WebUI 只读（可选）**
- **GUI / mac app（最后）**

---

## 5) 建议落地路线（3步）

### Step 1. “日常可用”闭环
- 让 core-daemon + Telegram/CLI 跑起来
- 让 agent 直接修改 repo
- 让 Run 事件可被回放

### Step 2. 只读 UI
- TUI / WebUI 只做 Run stream 订阅
- UI 不执行工具，只负责渲染

### Step 3. 多入口扩展
- 只做 transport adapter（输入/输出）
- 不复制业务逻辑

---

## 6) 你可以直接写进 BBot 的“决策文本”

**关键定调**：

> BBot 采用 core-first 架构。所有入口（TUI/GUI/Chat）仅为 transport adapters，不拥有业务逻辑。所有任务执行与工具调用只能在 core-daemon 内部发生。所有入口通过订阅统一的 Run 事件流进行展示，保证单一语义与可回放性。BBot 的第一性目标是“自举开发”，即使用 BBot 本身完成 BBot 的开发工作流。

---

## 7) 参考文档（本机可验证）

- OpenClaw Architecture: `/opt/homebrew/lib/node_modules/openclaw/docs/concepts/architecture.md`
- OpenClaw Agent Loop: `/opt/homebrew/lib/node_modules/openclaw/docs/concepts/agent-loop.md`
- pi-mono 参考：`/Users/wibus/dev/bbot/.agents/skills/pi-mono/SKILL.md`

---

## 8) 外部案例与细节拆解（逐层）

> **方法：从上到下**（理念 → 核心 → 运行时 → 入口 → UI/体验 → 可扩展性）逐层拆解，并映射到 BBot。

### 8.1 pi‑mono 体系（最直接的“多入口”参考）

**8.1.1 顶层理念与拆分**
- **pi‑mono monorepo** 明确把“核心能力”与“界面入口”分包：
  - `pi-ai`（统一 LLM API）
  - `pi-agent-core`（Agent 运行时）
  - `coding-agent`（CLI/TUI + 多模式入口）
  - `tui`（终端 UI 库）
  - `web-ui`（Web GUI 聊天界面）
  - 以及 Slack bot 等外部入口
  - 参考：https://github.com/badlogic/pi-mono

**映射到 BBot**：
- 这与“Core-first / Transport-thin”完全一致：核心（agent runtime + run/event）应独立于入口实现。

---

**8.1.2 多入口模式（最关键）**
- `pi-coding-agent` 明确了 **四种入口模式**：
  1) **interactive**（交互式 TUI）
  2) **print/JSON**（单次调用输出，便于脚本化）
  3) **RPC**（进程级集成，供外部工具调用）
  4) **SDK embedding**（作为库被嵌入产品）
  - 参考：https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
  - 原文 raw： https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/README.md

**映射到 BBot**：
- 你的“多入口”不该仅仅是 UI，而应当是“**运行模式的差异**”：
  - TUI / GUI / Chat 只是表现层
  - 但 print/JSON 与 RPC 才是“工程集成级入口”

---

**8.1.3 TUI 具体细节（终端侧）**
- `pi-tui` 的核心是 **差分渲染 + 组件模型 + overlay**，支持类编辑器 UX、inline images，避免 flicker。
  - 参考： https://github.com/badlogic/pi-mono/tree/main/packages/tui
  - raw： https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/tui/README.md

**映射到 BBot**：
- 如果你要 TUI，先把 **Run 事件流 → UI 组件** 做成最小可用，再考虑复杂交互。

---

**8.1.4 Web GUI 具体细节**
- `pi-web-ui` 提到 **ChatPanel + AgentInterface + ArtifactsPanel** 的组合形态，另外还包括存储层（IndexedDB）与 provider 抽象。
  - 参考： https://github.com/badlogic/pi-mono/tree/main/packages/web-ui
  - raw： https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/web-ui/README.md

**映射到 BBot**：
- GUI 的关键不是“聊天气泡”，而是“**Artifacts/产物面板**”，用于承载工具输出、文件、日志等。

---

### 8.2 OpenClaw 体系（多入口 + GUI/Canvas 的实践）

**8.2.1 多入口渠道**
- OpenClaw 以 Gateway 统一接入 Telegram/WhatsApp/Slack 等渠道，核心运行时保持一致。
  - 参考： https://github.com/openclaw/openclaw
  - Channels docs： https://docs.openclaw.ai/channels

**映射到 BBot**：
- 这就是“Transport-thin”：所有渠道只是消息适配，不应持有业务状态。

---

**8.2.2 GUI/Canvas 机制**
- OpenClaw 允许 agent 控制本地 GUI Canvas（HTML/CSS/JS + A2UI），作为“GUI 入口/输出面”。
  - 参考： https://docs.openclaw.ai/platforms/mac/canvas

**映射到 BBot**：
- 你要 GUI，不一定先做完整 App；可以先做“**Agent 控制的 HTML 面板**”，以 Run 事件驱动。

---

### 8.3 综合模式（总结成 BBot 的“工程指南”）

1) **核心与入口剥离**：Core = Run/Tool/Event；入口 = 协议适配 + UI 表现。
2) **多模式入口优先级**：先 CLI / Chat / JSON / RPC，再做 GUI。
3) **Artifacts 作为 GUI 核心**：比“聊天窗口”更重要。
4) **Run 事件流是唯一真相**：所有入口只订阅/回放，不自行推理。

---

## 9) 下一步建议（你醒来可直接做）

1) 明确 **Core-daemon API 只负责 Run + 工具 + 事件流**，入口不可包含运行逻辑。  
2) 把 Telegram/CLI 的输入统一通过 Core API 发起 Run（不再让入口直接跑 agent）。  
3) TUI/Web 先只读订阅 Run stream；等核心稳定再做“可写入口”。  
4) 写一个 **“BBot 自举任务清单”**（比如：自动写 README / 自动生成 roadmap / 自动跑 tests）作为狗粮任务。  

---

---

## 10) 你要的“全都要”——完整规范草案（Run 事件协议 / CLI+RPC+GUI 最小接口 / Artifacts 数据结构）

> 目标：把“入口多元化 + Run 事件唯一真相”落成可执行规范，后续可以直接写成 ExecPlan 或实现。

### 10.1 Run 事件协议（唯一真相）

**原则**：
- 所有入口只订阅 Run 事件流；不自行推理状态。
- 事件必须可回放、可审计、可追踪（traceId）。

**建议事件类型（最小集）**：
```
run.created
run.started
assistant.delta
assistant.message
tool.called
tool.result
run.completed
run.failed
run.canceled
```

**事件字段建议**（伪 Schema）
```
RunEvent {
  id: string,
  runId: string,
  sessionId: string,
  type: string,
  createdAt: ISODate,
  traceId: string,
  payload: Record<string, any>
}
```

**payload 示例**
- `run.started`: { model: "gpt-4o", temperature: 0.2 }
- `assistant.delta`: { text: "partial chunk" }
- `assistant.message`: { role:"assistant", content:[...] }
- `tool.called`: { toolName, args, toolCallId }
- `tool.result`: { toolCallId, result, ok, latencyMs }
- `run.completed`: { summary, tokens, cost }
- `run.failed`: { error, retryable }
- `run.canceled`: { reason }

**与现有 omnicore 映射**（强制收敛）
- `agent.run.start` → `run.started`
- `agent.message` → `assistant.delta` / `assistant.message`
- `action.requested`(+tool_call) → `tool.called`
- `action.executed` → `tool.result`
- `agent.summary` → `run.completed`

---

### 10.2 CLI / RPC / GUI 最小接口规范

**核心理念**：入口必须是“薄适配”，不执行 agent loop。

#### 10.2.1 CLI / TUI

**最小命令**：
- `bbot run "task"` → 创建 Run + 订阅事件流
- `bbot run --json "task"` → 仅输出 JSON 结果（print/JSON 模式）
- `bbot session list` / `bbot session resume <id>`

**CLI 行为规范**：
- 输入任务 -> 调用 Core API -> 监听 SSE
- 默认渲染 assistant delta + tool log
- 可加 `--quiet` 只输出 final message

#### 10.2.2 RPC / SDK

**最小 RPC**：
- `POST /runs` 创建 Run
- `POST /runs/:id/events` 追加事件
- `GET /runs/:id/stream` SSE 流
- `GET /runs/:id` 查询 Run

**SDK 要求**：
- 生成 SDK（heyapi）应包含 RunEvent 类型
- SDK 必须有 stream helper（SSE client）

#### 10.2.3 GUI / Web UI

**最小 GUI**：
- ChatPanel（输入 + assistant stream）
- ArtifactsPanel（展示工具输出/文件）
- RunLogPanel（事件流回放）

**渲染策略**：
- 不同步“业务状态”，只渲染 Run 事件流

---

### 10.3 Artifacts 数据结构（GUI 的核心）

**为什么重要**：GUI 的价值不在聊天气泡，而在“产物面板”（文件/链接/图表/日志）。

**最小 Artifacts Schema**：
```
Artifact {
  id: string,
  runId: string,
  kind: "file"|"link"|"image"|"table"|"log"|"chart",
  title?: string,
  payload: any,
  createdAt: ISODate
}
```

**常见 payload**：
- file: { path, mime, size }
- link: { url, label }
- image: { path|url, width, height }
- table: { columns, rows }
- log: { text }

**事件绑定**：
- `tool.result` 触发 artifacts 生成（可由 tool executor 负责）
- GUI 只负责渲染，不负责生成

---

### 10.4 最小落地路线（与现有系统对齐）

1) **统一 RunEvent 协议** → 收敛 omnicore 事件到 run_events。
2) **Core API 只做 Run + Event + Stream**。
3) **CLI/Telegram/TUI/Web** 都只订阅 event stream。
4) **Artifacts** 作为 tool executor 输出，GUI 只展示。

---

## 11) 下一步：要不要生成 ExecPlan？

如果你想落地，我可以直接在 `docs/exec-plans/` 写：
- `run-event-protocol-v1.md`
- `artifacts-panel-v1.md`
- `cli-rpc-entry-v1.md`

告诉我即可。
