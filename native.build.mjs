import { Editor, defineSchema } from './src/core/index.ts';
import { build } from 'vite';

await build({
  configFile: false,
  logLevel: 'error',
  build: {
    outDir: '.', emptyOutDir: false, minify: false, write: true,
    lib: { entry: 'native.check.ts', formats: ['es'], fileName: () => 'native.bundle.mjs' },
    rollupOptions: { external: ['vue', 'node:path', 'node:url', 'node:fs'] },
  },
});
