/* eslint-env node */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
    // Prettier must be applied last to disable conflicting formatting rules.
    'prettier',
  ],
  rules: {
    // The editor core is intentionally framework-agnostic: forbid Vue imports
    // inside src/core so the boundary cannot regress accidentally. Use the
    // @typescript-eslint version which supports `allowTypeImports`.
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'vue',
            message: 'src/core must not import Vue. Move this to src/view or src/extensions.',
            allowTypeImports: false,
          },
        ],
        patterns: [
          {
            group: ['vue/*', '@vue/*', '@/*'],
            message:
              'src/core must not import Vue or view-layer modules. Put framework-specific code in src/view or src/extensions.',
            allowTypeImports: false,
          },
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': 'error',
    'vue/multi-word-component-names': 'off',
    'vue/no-v-html': 'off',
  },
  overrides: [
    // The view layer, extensions, and playground may use Vue freely.
    {
      files: [
        'src/view/**/*.ts',
        'src/view/**/*.vue',
        'src/extensions/**/*.ts',
        'src/extensions/**/*.vue',
        'src/env.d.ts',
        'playground/**/*',
      ],
      rules: {
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
}
