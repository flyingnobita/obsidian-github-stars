import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['main.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'obsidianmd/commands/no-plugin-id-in-command-id': 'off',
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'eslint.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
	]),
);
