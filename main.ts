import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, requestUrl } from 'obsidian';


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

		// Register the markdown post processor to find and enhance GitHub links
		this.registerMarkdownPostProcessor(this.processMarkdown.bind(this));

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

			const data = await response.json();

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
