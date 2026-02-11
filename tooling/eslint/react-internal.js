import { defineConfig } from "eslint-config-hyoban";
import { turboConfig } from "./shared.js";

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * @type {import("eslint").Linter.Config[]} */
export const config = await defineConfig({ react: true }, turboConfig);
