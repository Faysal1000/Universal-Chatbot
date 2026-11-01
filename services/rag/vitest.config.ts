import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) compiles tests so Nest's decorator metadata, which drives dependency
// injection, is emitted exactly as in the tsc production build.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/contracts/generated/**', 'src/main.*.ts', 'src/instrumentation.ts'],
    },
  },
});
