const rootDir = __dirname

module.exports = {
  apps: [
    {
      name: "omnicore-supervisor",
      cwd: rootDir,
      script: "pnpm",
      interpreter: "bash",
      args: ["--filter", "@bbot/omnicore", "dev:supervisor"],
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "omnicore-telegram",
      cwd: rootDir,
      script: "pnpm",
      interpreter: "bash",
      args: ["--filter", "@bbot/bot-telegram", "dev"],
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
}
