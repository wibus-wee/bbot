import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import replace from "@rollup/plugin-replace"
import { defineConfig } from "tsdown"

const configDir = fileURLToPath(new URL(".", import.meta.url))
const promptPath = resolve(
  configDir,
  "../../packages/agent/src/prompts/gpt-5.2-codex-prompt.md",
)
const systemPrompt = readFileSync(promptPath, "utf-8").trim()

export default defineConfig({
  entry: ["src/main.ts"],
  format: "cjs",
  outDir: "dist",
  platform: "node",
  target: "node18",
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: false,
  external: [/^node:/, "undici"],
  noExternal: [/^@bbot\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        "globalThis.__SYSTEM_PROMPT__": JSON.stringify(systemPrompt),
      },
    }),
  ],
  outExtensions() {
    return { js: ".js" }
  },
  fixedExtension: false,
})
