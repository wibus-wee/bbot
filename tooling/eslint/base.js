import { defineConfig } from "eslint-config-hyoban";
import { turboConfig } from "./shared.js";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = await defineConfig({}, turboConfig);
