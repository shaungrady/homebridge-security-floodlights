module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
	},
	ignorePatterns: ['**/*.spec.*', '**/test/'],
	plugins: ['@typescript-eslint'],
	extends: [
		'eslint:recommended',
		'airbnb-typescript/base',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended',
		'prettier',
	],
	rules: {
		'no-restricted-syntax': 'off',
		'@typescript-eslint/member-delimiter-style': [
			'error',
			{
				multiline: {
					delimiter: 'none',
				},
			},
		],
	},
}
