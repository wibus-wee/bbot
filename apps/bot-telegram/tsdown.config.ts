import { defineConfig } from "tsdown"

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
  external: [/^node:/],
  noExternal: [/^@bbot\//],
  outExtensions() {
    return { js: ".js" }
  },
  fixedExtension: false,
})
