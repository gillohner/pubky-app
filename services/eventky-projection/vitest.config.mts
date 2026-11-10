import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: [
      'services/eventky-projection/src/**/*.test.ts',
      'src/core/services/eventky-feed-proxy/**/*.test.ts',
      'src/core/controllers/eventky-feed-proxy/**/*.test.ts',
    ],
  },
});
