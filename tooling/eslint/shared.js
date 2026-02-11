import turboPlugin from "eslint-plugin-turbo";

export const turboConfig = {
  plugins: {
    turbo: turboPlugin,
  },
  rules: {
    "turbo/no-undeclared-env-vars": "warn",
  },
};
