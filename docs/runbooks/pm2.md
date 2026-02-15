# PM2 运行模式说明

## 基本概念

- PM2 默认使用 fork 模式：每个 app 只有一个进程。
- Cluster 模式需要显式配置：`exec_mode: "cluster"` + `instances`。
- Cluster 模式通过 Node.js cluster 启多个 worker，多个进程共享同一个端口。
- `pm2 reload` 在 Cluster 模式下可以做到滚动重载；fork 模式只能用 `pm2 restart`。

## 本仓库当前配置

- `ecosystem.config.cjs` 未设置 `exec_mode` / `instances`，因此当前是 fork 模式。
- `pm2 restart ecosystem.config.cjs` 会同时重启 `bbot-core` 与 `bbot-telegram`。

## 自重启与 SIGUSR1

- `core-daemon` 与 `bot-telegram` 均监听 `SIGUSR1`，收到信号后会启动 `tooling/restart/index.ts` 并优雅退出。
- 可手动执行 `kill -USR1 <pid>`，或在 Telegram 里使用 `/restart` 触发自重启。
- `tooling/restart/index.ts` 会构建两个 app，并执行 `pm2 restart ecosystem.config.cjs`，确保两者一起重启。
- 若未来对 `core-daemon` 使用 Cluster，需避免每个 worker 都触发脚本；建议只由单个实例触发，或直接在运维层调用 `pm2 restart`。

## 选择 Cluster 的注意事项

- Cluster 更适合无状态的 HTTP 服务（例如 `core-daemon`）。
- `bot-telegram` 使用长轮询处理 Telegram 更新，多实例会导致重复消费或竞态，通常不建议开启 Cluster。
- 如果需要为 `core-daemon` 启用 Cluster，可在 `ecosystem.config.cjs` 为该 app 增加 `exec_mode` 与 `instances`。
