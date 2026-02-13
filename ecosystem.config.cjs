module.exports = {
  apps: [
    {
      name: "bbot-core",
      cwd: "apps/core-daemon",
      script: "dist/main.js",
      watch: false,
      autorestart: true,
    },
    {
      name: "bbot-telegram",
      cwd: "apps/bot-telegram",
      script: "dist/main.js",
      watch: false,
      autorestart: true,
    },
  ],
}
