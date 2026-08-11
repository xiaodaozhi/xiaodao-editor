import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

// Two modes:
//  - `vite` / `vite dev` -> serves the playground (index.html -> playground/main.ts)
//  - `vite build`         -> library build of src/index.ts -> dist/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build'

  return {
    plugins: [
      vue(),
      isBuild &&
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
    build: isBuild
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
      : undefined,
  }
})
