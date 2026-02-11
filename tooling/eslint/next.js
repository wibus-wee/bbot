import { defineConfig } from "eslint-config-hyoban";
import pluginNext from "@next/eslint-plugin-next";
import { turboConfig } from "./shared.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = await defineConfig(
  { react: "next" },
  turboConfig,
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
);
