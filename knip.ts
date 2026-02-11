import { defineConfig } from "knip";

export default defineConfig({
  entry: [
    "apps/*/src/**/*.{ts,tsx}",
    "apps/*/dev/**/*.{ts,tsx}",
    "packages/*/src/**/*.{ts,tsx}",
    "packages/*/dev/**/*.{ts,tsx}",
    "tooling/eslint/*.{js,mjs,cjs}",
    "tooling/scripts/**/*.{ts,js,mjs,cjs}",
    "tests/**/*.{ts,tsx}",
  ],
  project: [
    "apps/*/src/**/*.{ts,tsx}",
    "apps/*/dev/**/*.{ts,tsx}",
    "packages/*/src/**/*.{ts,tsx}",
    "packages/*/dev/**/*.{ts,tsx}",
    "tests/**/*.{ts,tsx}",
  ],
});
