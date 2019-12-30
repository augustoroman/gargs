// TODO: Should some of this stuff be lifted to root `.eslintrc`!?
module.exports = {
  overrides: [{
    files: ['**/*'],
    plugins: ['@typescript-eslint'],
    rules: {
      'no-underscore-dangle': 'off',
      'no-param-reassign': 'off',
      'no-plusplus': 'off',
      'no-bitwise': 'off',
      'prefer-rest-params': 'off',
      'no-extra-parens': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { 'argsIgnorePattern': '^_' },
      ],

      '@typescript-eslint/no-namespace': 'off',
      // These two rules are from JS, but have trouble with TS's constructors
      // that just assign member variables. Boo!
      'no-empty-function': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',

      // Allow for..of since modern JS works fine with that and it's efficient.
      // Usually I prefer .forEach, but sequential async is best with for..of.
      'no-restricted-syntax': [
        'error',
        'ForInStatement',
        'LabeledStatement',
        'WithStatement',
      ],
      'no-await-in-loop': 'off',

      // TS doesn't want `.ts` extensions on imports, but eslint requires it.
      'import/extensions': 'off',
      // Also, seems eslint doesn't resolve imports correctly, but TS catches that.
      'import/no-unresolved': 'off',
    },
  }],
};
