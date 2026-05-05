import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import importPlugin from 'eslint-plugin-import';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,

  // Global language options
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Import plugin setup
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
  },

  // Ignore patterns
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/prisma/generated/',
      '**/src/generated/',
      '**/*.test.ts',
      'vitest.*.config.ts',
      'eslint.config.js',
      '**/prisma.config.ts',
      '**/prisma/seed.ts',
      'tests/integration/setup.ts',
    ],
  },

  // Core rules
  {
    rules: {
      // TypeScript - strict but practical
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',

      // Fastify route handlers are async by convention
      '@typescript-eslint/require-await': 'off',

      // Import ordering - disabled for monorepo workspace compatibility
      'import/order': 'off',
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'off',

      // Unicorn - modern JS best practices
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/import-style': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/prefer-type-error': 'off',
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/prefer-string-slice': 'error',

      // SonarJS - code quality
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/prefer-single-boolean-return': 'off',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/pseudo-random': 'off',

      // General best practices
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-throw-literal': 'error',
      'no-return-await': 'off',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
    },
  },

  // Override for config files
  {
    files: ['**/*.config.{ts,js}', '**/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
