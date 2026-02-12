import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '', // input: './path/to/openapi.json', 
  output: {
    path: './src',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    {
      name: '@hey-api/client-ofetch',
      exportFromIndex: true,
    },
    '@tanstack/react-query',
    {
      name: 'zod',
      responses: false,
    },
    {
      name: '@hey-api/sdk',
      validator: true,
    },
  ],
});