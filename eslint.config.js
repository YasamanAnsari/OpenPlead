'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'dist/', 'assets/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Size guards: a file past this is two files; a function past this is hiding a decision table.
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 20],
    },
  },
  // The renderer runs in the pet window; the sprite tool evaluates functions inside a headless page.
  {
    files: ['src/renderer/**/*.js', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // The pages are classic scripts sharing one global scope, so `/* exported */` and `/* global */` apply.
  { files: ['src/renderer/**/*.js'], languageOptions: { sourceType: 'script' } },
  // The live harnesses are one long scenario each, by design.
  { files: ['scripts/live-*.js'], rules: { complexity: ['error', 40] } },
  // Test files are as long as their cases.
  { files: ['test/**/*.js'], rules: { 'max-lines': 'off' } },
];
