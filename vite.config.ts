import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

// Three modes:
//  - `vite` / `vite dev`    -> serves the playground (index.html -> playground/main.ts)
//  - `vite build`           -> library build of src/index.ts -> dist/
//  - `vite build --mode demo` -> playground SPA build with App.vue -> dist-demo/
export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build'
  const isDemo = mode === 'demo'
  const isLibBuild = isBuild && !isDemo

  return {
    plugins: [
      vue(),
      isLibBuild &&
        dts({
          include: ['src'],
          insertTypesEntry: true,
          tsconfigPath: './tsconfig.json',
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: isLibBuild
      ? {
          lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'BlockEditor',
            fileName: 'block-editor',
            formats: ['es', 'umd'],
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              globals: { vue: 'Vue' },
              exports: 'named',
            },
          },
        }
      : isDemo
        ? {
            outDir: 'dist-demo',
            emptyOutDir: true,
          }
        : undefined,
  }
})
