import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default defineConfig(
  { ignores: ['dist', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // the ideographic space (U+3000) is typography in the Chinese text of the templates; script code still checks it
      'no-irregular-whitespace': 'off',
      'vue/no-irregular-whitespace': ['error', { skipHTMLTextContents: true }],
    },
  },
  {
    rules: {
      // TypeScript already checks every name, against the DOM and Bun types
      'no-undef': 'off',
      // the components are this app's own, and one word says what each is (Icon, Toast, Popover)
      'vue/multi-word-component-names': 'off',
    },
  },
);
