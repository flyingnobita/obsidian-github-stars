import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, requestUrl } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';


interface GitHubStarsSettings {
	cacheExpiry: number; // Time in minutes before cache expires
	displayFormat: string; // Format for displaying stars (e.g., "⭐ {stars}")
	apiToken: string; // Optional GitHub API token for higher rate limits
	numberFormat: 'full' | 'abbreviated'; // Number formatting style
}

const DEFAULT_SETTINGS: GitHubStarsSettings = {
	cacheExpiry: 60, // Default cache expiry: 60 minutes
	displayFormat: "⭐ {stars}",
	apiToken: "",
	numberFormat: 'abbreviated'
}

// Interface for cache entries	
interface CacheEntry {
	stars: number;
	timestamp: number;
}

/**
 * Build the CodeMirror 6 ViewPlugin for Live Preview star count display.
 * The plugin and widget classes are defined inside this function so they
 * can capture a reference to the main Obsidian plugin instance.
 */
function buildGitHubStarsViewPlugin(plugin: GitHubStarsPlugin) {
	class StarsWidget extends WidgetType {
		constructor(private owner: string, private repo: string) {
			super();
		}

		eq(other: StarsWidget): boolean {
			return this.owner === other.owner && this.repo === other.repo;
		}

		toDOM(): HTMLElement {
			const span = document.createElement('span');
			span.addClass('github-stars-count');

			// Use cached value for instant rendering when available
			const cacheKey = `${this.owner}/${this.repo}`;
			const cachedEntry = plugin.cache[cacheKey];
			const now = Date.now();
			const expiryTime = plugin.settings.cacheExpiry * 60 * 1000;

			if (cachedEntry && (now - cachedEntry.timestamp < expiryTime)) {
				span.setText(plugin.formatStarCount(cachedEntry.stars));
				return span;
			}

			// Show loading state and fetch asynchronously
			span.addClass('github-stars-loading');
			span.setText('⭐ ...');

			plugin.getStarCount(this.owner, this.repo).then(stars => {
				span.removeClass('github-stars-loading');
				if (stars !== null) {
					span.setText(plugin.formatStarCount(stars));
				} else {
					span.setText('⭐ ?');
					span.addClass('github-stars-error');
				}
			}).catch(() => {
				span.removeClass('github-stars-loading');
				span.setText('⭐ ?');
				span.addClass('github-stars-error');
			});

			return span;
		}
	}

	class StarsViewPlugin {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		destroy() {}

		buildDecorations(view: EditorView): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();
			const githubUrlRegex = /https?:\/\/(www\.)?github\.com\/([^/\s)#?]+)\/([^/\s)#?]+)(\/[^\s)]*)?\/?(#[^\s)]*)?/g;

			for (const { from, to } of view.visibleRanges) {
				const text = view.state.doc.sliceString(from, to);
				let match;

				while ((match = githubUrlRegex.exec(text)) !== null) {
					const owner = match[2];
					let repo = match[3];

					if (repo.endsWith('.git')) {
						repo = repo.slice(0, -4);
					}

					const matchEnd = from + match.index + match[0].length;
					let insertPos = matchEnd;

					// If inside a markdown link [text](url), place widget after the closing )
					if (matchEnd < view.state.doc.length) {
						const charAfter = view.state.doc.sliceString(matchEnd, matchEnd + 1);
						if (charAfter === ')') {
							insertPos = matchEnd + 1;
						}
					}

					// Skip if a star count is already embedded in the text
					const textAfter = view.state.doc.sliceString(insertPos, Math.min(insertPos + 20, view.state.doc.length));
					if (/^ ⭐ [\d,.]+[kMB]?/.test(textAfter)) {
						continue;
					}

					builder.add(
						insertPos,
						insertPos,
						Decoration.widget({
							widget: new StarsWidget(owner, repo),
							side: 1,
						})
					);
				}
			}

			return builder.finish();
		}
	}

	return ViewPlugin.fromClass(StarsViewPlugin, {
		decorations: (value: StarsViewPlugin) => value.decorations,
	});
}

export default class GitHubStarsPlugin extends Plugin {
	settings: GitHubStarsSettings;
	cache: Record<string, CacheEntry> = {};

	async onload() {
		// Load settings
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('star', 'Github stars', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Processing GitHub stars...');

			// Get the active markdown view
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				// Force refresh by triggering the markdown processor
				activeView.previewMode.rerender(true);
				new Notice('GitHub star counts refreshed!');
			} else {
				new Notice('No active markdown view found');
			}
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('github-stars-ribbon-class');

		// Load cache from data
		try {

			const loadedCache = await this.loadData();

			// Check if we have a cache property in the loaded data
			if (loadedCache && loadedCache.cache) {
				this.cache = loadedCache.cache;
			}
		} catch (error) {
			console.error('Error loading cache:', error);
		}

		// Register the markdown post processor to find and enhance GitHub links (Reading View)
		this.registerMarkdownPostProcessor(this.processMarkdown.bind(this));

		// Register the CodeMirror 6 editor extension for Live Preview support
		this.registerEditorExtension(buildGitHubStarsViewPlugin(this));

		// Add settings tab
		this.addSettingTab(new GitHubStarsSettingTab(this.app, this));

		// Add a command to clear the cache
		this.addCommand({
			id: 'clear-github-stars-cache',
			name: 'Clear cache',
			callback: () => {
				this.cache = {};
				this.saveSettings();
				new Notice('GitHub stars cache cleared');
			}
		});

		// Add a command to refresh star counts for the current note
		this.addCommand({
			id: 'refresh-github-stars',
			name: 'Refresh for current note',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						// Force refresh by triggering the markdown processor
						activeView.previewMode.rerender(true);
						new Notice('Refreshing GitHub star counts...');
					}
					return true;
				}
				return false;
			}
		});

		// Add a command to embed star counts directly into the markdown file
		this.addCommand({
			id: 'embed-github-stars',
			name: 'Embed star counts in current note',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						this.embedStarCounts();
					}
					return true;
				}
				return false;
			}
		});

		// Add a command to remove embedded star counts from the file
		this.addCommand({
			id: 'remove-embedded-github-stars',
			name: 'Remove embedded star counts from current note',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						this.removeEmbeddedStarCounts();
					}
					return true;
				}
				return false;
			}
		});
	}

	onunload() {
		// Save settings when plugin is unloaded
		this.saveSettings();
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Store cache separately if it exists in the loaded data
		if (data && data.cache) {
			this.cache = data.cache;
		}
	}

	async saveSettings() {
		// Save both settings and cache in the same data object
		const dataToSave = {
			...this.settings,
			cache: this.cache
		};
		await this.saveData(dataToSave);
	}

	/**
	 * Process markdown content to find and enhance GitHub links
	 */
	async processMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Find all links in the document
		const links = el.querySelectorAll('a');

		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			const url = link.getAttribute('href');

			if (!url) {
				continue;
			}

			// Check if the link is a GitHub repository URL
			const repoInfo = this.extractRepoInfo(url);
			if (repoInfo) {
				// Skip if a star count is already embedded in the text after the link
				const nextSibling = link.nextSibling;
				if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE
					&& nextSibling.textContent && /^\s*⭐ [\d,.]+[kMB]?/.test(nextSibling.textContent)) {
					continue;
				}

				// Create a span to hold the star count with loading indicator
				const starSpan = document.createElement('span');
				starSpan.addClass('github-stars-count');
				starSpan.addClass('github-stars-loading');
				starSpan.setText('⭐ ...');

				// Insert the star count after the link
				link.after(starSpan);

				// Get star count and update the span using async/await
				try {
					const stars = await this.getStarCount(repoInfo.owner, repoInfo.repo);
					starSpan.removeClass('github-stars-loading');

					if (stars !== null) {
						const formattedStars = this.formatStarCount(stars);
						starSpan.setText(formattedStars);
					} else {
						starSpan.setText('⭐ ?');
						starSpan.addClass('github-stars-error');
					}
				} catch (error) {
					console.error(`Error getting star count for ${repoInfo.owner}/${repoInfo.repo}:`, error);
					starSpan.removeClass('github-stars-loading');
					starSpan.setText('⭐ ?');
					starSpan.addClass('github-stars-error');
				}
			}
		}
	}

	/**
	 * Extract repository owner and name from a GitHub URL
	 * Returns null if the URL is not a valid GitHub repository URL
	 */
	extractRepoInfo(url: string): { owner: string, repo: string } | null {
		// Match GitHub repository URLs
		// Examples:
		// - https://github.com/owner/repo
		// - https://github.com/owner/repo/
		// - https://github.com/owner/repo/tree/master
		// - https://github.com/owner/repo/blob/master/README.md
		// - https://www.github.com/owner/repo
		// - http://github.com/owner/repo

		// First, normalize the URL
		const normalizedUrl = url.trim().toLowerCase();

		// Check if it's a GitHub URL
		if (!normalizedUrl.includes('github.com')) {
			return null;
		}

		// Extract owner and repo using regex
		const githubRegex = /https?:\/\/(www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(\/.*)?$/;
		const match = url.match(githubRegex);

		if (match && match[2] && match[3]) {
			const owner = match[2];
			let repo = match[3];

			// Remove .git suffix if present
			if (repo.endsWith('.git')) {
				repo = repo.slice(0, -4);
			}

			return { owner, repo };
		}

		return null;
	}

	/**
	 * Get star count for a GitHub repository
	 * Uses cache if available and not expired
	 */
	async getStarCount(owner: string, repo: string): Promise<number | null> {
		const cacheKey = `${owner}/${repo}`;

		// Check if we have a valid cache entry
		if (this.cache[cacheKey]) {
			const entry = this.cache[cacheKey];
			const now = Date.now();
			const expiryTime = this.settings.cacheExpiry * 60 * 1000; // Convert minutes to milliseconds

			// If cache entry is still valid, use it
			if (now - entry.timestamp < expiryTime) {
				return entry.stars;
			}
		}

		try {
			// Fetch star count from GitHub API
			const headers: Record<string, string> = {
				'Accept': 'application/vnd.github.v3+json',
				'User-Agent': 'Obsidian-GitHub-Stars-Plugin'
			};

			// Add API token if available
			if (this.settings.apiToken && this.settings.apiToken.trim() !== '') {
				headers['Authorization'] = `token ${this.settings.apiToken.trim()}`;
			}

			const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

			const response = await requestUrl({
				url: apiUrl,
				headers: headers,
				method: 'GET'
			});

			// Handle rate limiting
			const rateLimitRemaining = response.headers['X-RateLimit-Remaining'];
			const rateLimitReset = response.headers['X-RateLimit-Reset'];

			if (rateLimitRemaining === '0' && rateLimitReset) {
				const resetTime = new Date(parseInt(rateLimitReset) * 1000);
				const now = new Date();
				const minutesUntilReset = Math.ceil((resetTime.getTime() - now.getTime()) / (60 * 1000));

				console.warn(`GitHub API rate limit exceeded. Resets in ${minutesUntilReset} minutes.`);

				// If we have a cached value, use it even if expired
				if (this.cache[cacheKey]) {
					return this.cache[cacheKey].stars;
				}

				return null;
			}

			if (response.status === 404) {
				console.error(`Repository ${owner}/${repo} not found`);
				return null;
			}

			if (response.status !== 200) {
				console.error(`Failed to fetch star count for ${owner}/${repo}: ${response.status}`);

				// If we have a cached value, use it even if expired
				if (this.cache[cacheKey]) {
					return this.cache[cacheKey].stars;
				}

				return null;
			}

			const data = response.json;

			if (!data || typeof data.stargazers_count !== 'number') {
				console.error(`Invalid response data for ${owner}/${repo}`);
				return null;
			}

			const stars = data.stargazers_count;

			// Update cache
			this.cache[cacheKey] = {
				stars,
				timestamp: Date.now()
			};

			// Save cache to disk
			this.saveSettings();

			return stars;
		} catch (error) {
			console.error(`Error fetching star count for ${owner}/${repo}:`, error);

			// If we have a cached value, use it even if expired
			if (this.cache[cacheKey]) {
				return this.cache[cacheKey].stars;
			}

			return null;
		}
	}

	/**
	 * Embed star counts directly into the markdown file content.
	 * Inserts or updates inline star text (e.g. "⭐ 1.2k") after each GitHub link.
	 */
	async embedStarCounts(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active markdown view found');
			return;
		}

		const file = activeView.file;
		let content = await this.app.vault.read(file);

		// Match markdown links to GitHub repos, with optional existing star count.
		// Group 1: full markdown link  Group 2: owner  Group 3: repo  Group 4: existing star text
		const linkRegex = /(\[[^\]]*\]\(https?:\/\/(?:www\.)?github\.com\/([^/\s)]+)\/([^/\s)#?]+)[^)]*\))( ⭐ [\d,.]+[kMB]?)?/g;

		const matches: Array<{
			index: number;
			length: number;
			linkText: string;
			owner: string;
			repo: string;
		}> = [];

		let match;
		while ((match = linkRegex.exec(content)) !== null) {
			matches.push({
				index: match.index,
				length: match[0].length,
				linkText: match[1],
				owner: match[2],
				repo: match[3].replace(/\.git$/, ''),
			});
		}

		if (matches.length === 0) {
			new Notice('No GitHub links found in current note');
			return;
		}

		new Notice(`Fetching star counts for ${matches.length} repositories...`);

		// Process in reverse order so earlier positions are not shifted by replacements
		let updatedCount = 0;
		for (let i = matches.length - 1; i >= 0; i--) {
			const m = matches[i];
			const stars = await this.getStarCount(m.owner, m.repo);
			if (stars !== null) {
				const formatted = this.formatStarCount(stars);
				const replacement = `${m.linkText} ${formatted}`;
				content = content.substring(0, m.index) + replacement + content.substring(m.index + m.length);
				updatedCount++;
			}
		}

		if (updatedCount > 0) {
			await this.app.vault.modify(file, content);
			new Notice(`Embedded star counts for ${updatedCount} GitHub links`);
		} else {
			new Notice('Could not fetch star counts for any repositories');
		}
	}

	/**
	 * Remove embedded star counts from the markdown file content
	 */
	async removeEmbeddedStarCounts(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active markdown view found');
			return;
		}

		const file = activeView.file;
		let content = await this.app.vault.read(file);

		// Match GitHub markdown links followed by an embedded star count
		const starRegex = /(\[[^\]]*\]\(https?:\/\/(?:www\.)?github\.com\/[^)]+\)) ⭐ [\d,.]+[kMB]?/g;
		const newContent = content.replace(starRegex, '$1');

		if (newContent !== content) {
			await this.app.vault.modify(file, newContent);
			new Notice('Removed embedded star counts');
		} else {
			new Notice('No embedded star counts found');
		}
	}

	/**
	 * Format star count according to settings
	 */
	formatStarCount(stars: number): string {
		const formatted = this.settings.displayFormat.replace('{stars}', this.formatNumber(stars));
		return formatted;
	}

	/**
	 * Format number with thousands separators or abbreviate for large numbers
	 */
	formatNumber(num: number): string {
		// Use full format if configured
		if (this.settings.numberFormat === 'full') {
			return num.toLocaleString();
		}

		// Otherwise use abbreviated format
		// For numbers less than 1000, just use locale string
		if (num < 1000) {
			return num.toLocaleString();
		}

		// For numbers 1000 or greater, use abbreviations
		if (num < 10000) {
			// 1.2k format for 1000-9999
			return (num / 1000).toFixed(1) + 'k';
		} else if (num < 1000000) {
			// 12k format for 10000-999999
			return Math.round(num / 1000) + 'k';
		} else {
			// 1.2M format for 1000000+
			return (num / 1000000).toFixed(1) + 'M';
		}
	}
}

class GitHubStarsSettingTab extends PluginSettingTab {
	plugin: GitHubStarsPlugin;

	constructor(app: App, plugin: GitHubStarsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Cache expiry')
			.setDesc('Time in minutes before the GitHub star count cache expires')
			.addText(text => text
				.setPlaceholder('60')
				.setValue(this.plugin.settings.cacheExpiry.toString())
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue > 0) {
						this.plugin.settings.cacheExpiry = numValue;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Display format')
			.setDesc('Format for displaying star counts. Use {stars} as a placeholder for the number.')
			.addText(text => text
				.setPlaceholder('⭐ {stars}')
				.setValue(this.plugin.settings.displayFormat)
				.onChange(async (value) => {
					if (value.includes('{stars}')) {
						this.plugin.settings.displayFormat = value;
						await this.plugin.saveSettings();
					} else {
						new Notice('Display format must include {stars} placeholder');
					}
				}));

		new Setting(containerEl)
			.setName('Number format')
			.setDesc('How to format star counts')
			.addDropdown(dropdown => dropdown
				.addOption('full', 'Full numbers (e.g., 1,234)')
				.addOption('abbreviated', 'Abbreviated (e.g., 1.2k)')
				.setValue(this.plugin.settings.numberFormat)
				.onChange(async (value: 'full' | 'abbreviated') => {
					this.plugin.settings.numberFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitHub API token (optional)')
			.setDesc('Personal access token for GitHub API to increase rate limits')
			.addText(text => text
				.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (value) => {
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
				}));

		// Add a button to clear the cache
		new Setting(containerEl)
			.setName('Clear cache')
			.setDesc('Clear the GitHub stars cache')
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(async () => {
					this.plugin.cache = {};
					await this.plugin.saveSettings();
					new Notice('GitHub stars cache cleared');
				}));
	}
}
