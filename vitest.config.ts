import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Vitest config for the block-editor unit tests.
// - `@vitejs/plugin-vue` is required because Equation.ts transitively imports
//   the `SafeHtml.vue` SFC (and tests may mount EquationBlock).
// - `happy-dom` provides a lightweight DOM so component tests (edit/submit/
//   cancel flows) and `document`-based code can run in Node.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.{test,spec}.{ts,vue}'],
    css: false,
  },
});
