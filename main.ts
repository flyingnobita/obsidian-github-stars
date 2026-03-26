import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, requestUrl } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { extractReposFromContent, extractUniqueReposFromContents, findEmbeddedGitHubLinkMatches, findGitHubLinkMatches, GitHubLinkMatch, removeEmbeddedGitHubStars, RepoRef, rewriteGitHubLinksWithStars, shouldUseCachedEntry } from './githubStarsCore';


interface GitHubStarsSettings {
	cacheExpiry: number; // Time in minutes before cache expires
	apiToken: string; // Optional GitHub API token for higher rate limits
	numberFormat: 'full' | 'abbreviated'; // Number formatting style
	updateEmbeddedStarsOnRefresh: boolean; // Whether refresh updates embedded star counts in the note
	showTokenWarnings: boolean; // Whether manual refresh shows warnings for missing or invalid tokens
}

const DEFAULT_SETTINGS: GitHubStarsSettings = {
	cacheExpiry: 1440, // Default cache expiry: 1440 minutes (1 day)
	apiToken: "",
	numberFormat: 'abbreviated',
	updateEmbeddedStarsOnRefresh: true,
	showTokenWarnings: true
}

// Interface for cache entries	
interface CacheEntry {
	stars: number;
	timestamp: number;
}

interface StarCountFetchResult {
	stars: number | null;
	refreshedFromGitHub: boolean;
	fetchFailed: boolean;
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
					plugin.scheduleEmbeddedStarUpdate([{ owner: this.owner, repo: this.repo }]);
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
	activeRefreshRunId = 0;
	lastMissingTokenWarningRefreshId = 0;
	lastInvalidTokenWarningRefreshId = 0;
	pendingEmbeddedUpdateRepos = new Set<string>();
	pendingEmbeddedUpdateTimer: ReturnType<typeof setTimeout> | null = null;

	async onload() {
		// Load settings
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('star', 'Github stars', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Processing GitHub stars...');

			this.refreshCurrentNote();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('github-stars-ribbon-class');

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
						this.refreshCurrentNote();
					}
					return true;
				}
				return false;
			}
		});

		// Add a command to refresh star counts for every markdown note in the vault
		this.addCommand({
			id: 'refresh-github-stars-all-notes',
			name: 'Refresh for all notes',
			callback: () => {
				void this.refreshAllNotes();
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

		// Add a command to embed star counts in every markdown note in the vault
		this.addCommand({
			id: 'embed-github-stars-all-notes',
			name: 'Embed star counts in all notes',
			callback: () => {
				void this.embedStarCountsForAllNotes();
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

		// Add a command to remove embedded star counts from every markdown note in the vault
		this.addCommand({
			id: 'remove-embedded-github-stars-all-notes',
			name: 'Remove embedded star counts from all notes',
			callback: () => {
				void this.removeEmbeddedStarCountsFromAllNotes();
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
		if (typeof this.settings.updateEmbeddedStarsOnRefresh !== 'boolean'
			&& data && typeof data.refreshEmbeddedStars === 'string') {
			this.settings.updateEmbeddedStarsOnRefresh = data.refreshEmbeddedStars === 'update';
		}
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

	private getActiveMarkdownFileView(): MarkdownView | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			return null;
		}

		return activeView;
	}

	private requireActiveFile(view: MarkdownView): NonNullable<MarkdownView['file']> | null {
		const file = view.file;
		if (!file) {
			new Notice('No active markdown view found');
			return null;
		}

		return file;
	}

	private getCachedStars(owner: string, repo: string): number | null {
		const stars = this.cache[`${owner}/${repo}`]?.stars;
		return typeof stars === 'number' ? stars : null;
	}

	private getFormattedCachedStars(match: GitHubLinkMatch): string | null {
		const stars = this.getCachedStars(match.owner, match.repo);
		return stars === null ? null : this.formatStarCount(stars);
	}

	private rerenderMarkdownView(view: MarkdownView): void {
		view.previewMode.rerender(true);
	}

	private rerenderAllOpenMarkdownViews(): void {
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				this.rerenderMarkdownView(view);
			}
		});
	}

	private getRepoCacheKey(owner: string, repo: string): string {
		return `${owner}/${repo}`;
	}

	private shouldShowTokenWarningDuringRefresh(): boolean {
		return this.settings.showTokenWarnings && this.activeRefreshRunId > 0;
	}

	scheduleEmbeddedStarUpdate(repos: RepoRef[]): void {
		if (!this.settings.updateEmbeddedStarsOnRefresh || repos.length === 0) {
			return;
		}

		for (const { owner, repo } of repos) {
			this.pendingEmbeddedUpdateRepos.add(this.getRepoCacheKey(owner, repo));
		}

		if (this.pendingEmbeddedUpdateTimer !== null) {
			return;
		}

		this.pendingEmbeddedUpdateTimer = setTimeout(() => {
			void this.flushScheduledEmbeddedStarUpdates();
		}, 50);
	}

	private async flushScheduledEmbeddedStarUpdates(): Promise<void> {
		const pendingKeys = new Set(this.pendingEmbeddedUpdateRepos);
		this.pendingEmbeddedUpdateRepos.clear();

		if (this.pendingEmbeddedUpdateTimer !== null) {
			clearTimeout(this.pendingEmbeddedUpdateTimer);
			this.pendingEmbeddedUpdateTimer = null;
		}

		if (pendingKeys.size === 0) {
			return;
		}

		await this.rewriteActiveNoteStars({
			findMatches: findEmbeddedGitHubLinkMatches,
			noLinksNotice: null,
			progressNotice: null,
			successNotice: null,
			fetchLatest: false,
			failureNotice: null,
			shouldRewriteMatch: (match) => pendingKeys.has(this.getRepoCacheKey(match.owner, match.repo)),
		});
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
						this.scheduleEmbeddedStarUpdate([repoInfo]);
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
	async getStarCount(owner: string, repo: string, forceRefresh = false): Promise<number | null> {
		const result = await this.fetchStarCount(owner, repo, forceRefresh);
		return result.stars;
	}

	private async fetchStarCount(owner: string, repo: string, forceRefresh = false): Promise<StarCountFetchResult> {
		const cacheKey = this.getRepoCacheKey(owner, repo);
		const entry = this.cache[cacheKey];
		if (shouldUseCachedEntry(entry, this.settings.cacheExpiry, Date.now(), forceRefresh)) {
			return {
				stars: entry.stars,
				refreshedFromGitHub: false,
				fetchFailed: false,
			};
		}

		try {
			const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
			const hasToken = this.settings.apiToken.trim() !== '';

			if (!hasToken
				&& this.shouldShowTokenWarningDuringRefresh()
				&& this.lastMissingTokenWarningRefreshId !== this.activeRefreshRunId) {
				console.warn('GitHub Stars: No GitHub API token configured. Requests will use the lower unauthenticated rate limit. Add a valid token in plugin settings for higher limits.');
				this.lastMissingTokenWarningRefreshId = this.activeRefreshRunId;
			}

			let response = await this.fetchRepoDetails(apiUrl, hasToken);

			if (response.status === 401 && hasToken) {
				if (this.shouldShowTokenWarningDuringRefresh()
					&& this.lastInvalidTokenWarningRefreshId !== this.activeRefreshRunId) {
					console.warn(`GitHub Stars: GitHub API token was rejected for ${owner}/${repo}. Retrying without authentication. Add a valid token in plugin settings for higher limits.`);
					new Notice('GitHub API token was rejected. Retrying without authentication.');
					this.lastInvalidTokenWarningRefreshId = this.activeRefreshRunId;
				}

				response = await this.fetchRepoDetails(apiUrl, false);
			}

			const rateLimitRemaining = response.headers['X-RateLimit-Remaining'];
			const rateLimitReset = response.headers['X-RateLimit-Reset'];

			if (rateLimitRemaining === '0' && rateLimitReset) {
				const resetTime = new Date(parseInt(rateLimitReset) * 1000);
				const now = new Date();
				const minutesUntilReset = Math.ceil((resetTime.getTime() - now.getTime()) / (60 * 1000));

				console.warn(`GitHub API rate limit exceeded. Resets in ${minutesUntilReset} minutes.`);
				return this.getFailedFetchResult(cacheKey);
			}

			if (response.status === 404) {
				console.error(`Repository ${owner}/${repo} not found`);
				return this.getFailedFetchResult(cacheKey);
			}

			if (response.status !== 200) {
				console.error(`Failed to fetch star count for ${owner}/${repo}: ${response.status}`);
				return this.getFailedFetchResult(cacheKey);
			}

			const data = response.json;

			if (!data || typeof data.stargazers_count !== 'number') {
				console.error(`Invalid response data for ${owner}/${repo}`);
				return this.getFailedFetchResult(cacheKey);
			}

			const stars = data.stargazers_count;
			this.cache[cacheKey] = {
				stars,
				timestamp: Date.now()
			};
			this.saveSettings();

			return {
				stars,
				refreshedFromGitHub: true,
				fetchFailed: false,
			};
		} catch (error) {
			console.error(`Error fetching star count for ${owner}/${repo}:`, error);
			return this.getFailedFetchResult(cacheKey);
		}
	}

	private getFailedFetchResult(cacheKey: string): StarCountFetchResult {
		const cachedStars = this.cache[cacheKey]?.stars ?? null;
		return {
			stars: cachedStars,
			refreshedFromGitHub: false,
			fetchFailed: true,
		};
	}

	private async fetchRepoDetails(apiUrl: string, useToken: boolean) {
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': 'Obsidian-GitHub-Stars-Plugin',
			'X-GitHub-Api-Version': '2022-11-28'
		};

		if (useToken) {
			headers['Authorization'] = `Bearer ${this.settings.apiToken.trim()}`;
		}

		return requestUrl({
			url: apiUrl,
			headers,
			method: 'GET'
		});
	}

	private async refreshCurrentNote(): Promise<void> {
		const activeView = this.getActiveMarkdownFileView();
		if (!activeView) {
			new Notice('No active markdown view found');
			return;
		}

		this.activeRefreshRunId += 1;
		const file = this.requireActiveFile(activeView);
		if (!file) {
			return;
		}

		const content = await this.app.vault.read(file);
		const repos = extractReposFromContent(content);
		const refreshResults = new Map<string, StarCountFetchResult>();
		let hadRefreshFailure = false;

		if (repos.length > 0) {
			await Promise.all(repos.map(async ({ owner, repo }) => {
				const result = await this.fetchStarCount(owner, repo, true);
				refreshResults.set(this.getRepoCacheKey(owner, repo), result);
				hadRefreshFailure = hadRefreshFailure || result.fetchFailed;
			}));
		}

		if (this.settings.updateEmbeddedStarsOnRefresh) {
			new Notice('Refreshing GitHub star counts and updating embedded stars...');
			await this.updateEmbeddedStarCounts(refreshResults);
			if (hadRefreshFailure) {
				new Notice('Some GitHub star counts could not be refreshed.');
			}
			this.rerenderMarkdownView(activeView);
			return;
		}

		if (hadRefreshFailure) {
			new Notice('Some GitHub star counts could not be refreshed.');
		}
		this.rerenderMarkdownView(activeView);
		new Notice('Refreshing GitHub star counts...');
	}

	private async refreshAllNotes(): Promise<void> {
		this.activeRefreshRunId += 1;
		new Notice('Refreshing GitHub star counts for all notes...');

		const markdownFiles = this.app.vault.getMarkdownFiles();
		const contents = await Promise.all(markdownFiles.map((file) => this.app.vault.read(file)));
		const uniqueRepos = extractUniqueReposFromContents(contents);

		const refreshResults = new Map<string, StarCountFetchResult>();
		let hadRefreshFailure = false;

		for (const repo of uniqueRepos) {
			const result = await this.fetchStarCount(repo.owner, repo.repo, true);
			refreshResults.set(this.getRepoCacheKey(repo.owner, repo.repo), result);
			hadRefreshFailure = hadRefreshFailure || result.fetchFailed;
		}

		let updatedLinks = 0;
		if (this.settings.updateEmbeddedStarsOnRefresh) {
			updatedLinks = await this.updateEmbeddedStarCountsForAllNotes(refreshResults);
		}

		this.rerenderAllOpenMarkdownViews();

		if (hadRefreshFailure) {
			new Notice('Finished refreshing all notes, but some GitHub star counts could not be refreshed.');
		}

		if (this.settings.updateEmbeddedStarsOnRefresh) {
			new Notice(`Refreshed ${uniqueRepos.length} repositories across all notes and updated ${updatedLinks} embedded star counts.`);
		} else {
			new Notice(`Refreshed ${uniqueRepos.length} repositories across all notes.`);
		}
	}

	private async updateEmbeddedStarCountsForAllNotes(refreshResults: Map<string, StarCountFetchResult>): Promise<number> {
		let totalUpdatedLinks = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = await this.app.vault.read(file);
			const matches = findEmbeddedGitHubLinkMatches(content);
			if (matches.length === 0) {
				continue;
			}

			const result = rewriteGitHubLinksWithStars(content, matches, (match) => {
				if (refreshResults.get(this.getRepoCacheKey(match.owner, match.repo))?.refreshedFromGitHub !== true) {
					return null;
				}
				return this.getFormattedCachedStars(match);
			});

			if (result.updatedCount > 0) {
				await this.app.vault.modify(file, result.content);
				totalUpdatedLinks += result.updatedCount;
			}
		}

		return totalUpdatedLinks;
	}

	private async updateEmbeddedStarCounts(refreshResults: Map<string, StarCountFetchResult>): Promise<void> {
		await this.rewriteActiveNoteStars({
			findMatches: findEmbeddedGitHubLinkMatches,
			noLinksNotice: null,
			progressNotice: null,
			successNotice: null,
			fetchLatest: false,
			failureNotice: null,
			shouldRewriteMatch: (match) => refreshResults.get(this.getRepoCacheKey(match.owner, match.repo))?.refreshedFromGitHub === true,
		});
	}

	/**
	 * Embed star counts directly into the markdown file content.
	 * Inserts or updates inline star text (e.g. "⭐ 1.2k") after each GitHub link.
	 */
	async embedStarCounts(): Promise<void> {
		await this.rewriteActiveNoteStars({
			findMatches: findGitHubLinkMatches,
			noLinksNotice: 'No GitHub links found in current note',
			progressNotice: (count) => `Fetching star counts for ${count} repositories...`,
			successNotice: (count) => `Embedded star counts for ${count} GitHub links`,
			fetchLatest: false,
			failureNotice: 'Could not fetch star counts for any repositories',
			shouldRewriteMatch: () => true,
		});
	}

	/**
	 * Remove embedded star counts from the markdown file content
	 */
	async removeEmbeddedStarCounts(): Promise<void> {
		const activeView = this.getActiveMarkdownFileView();
		if (!activeView) {
			new Notice('No active markdown view found');
			return;
		}

		const file = this.requireActiveFile(activeView);
		if (!file) {
			return;
		}

		const content = await this.app.vault.read(file);
		const result = removeEmbeddedGitHubStars(content);

		if (result.removedCount > 0) {
			await this.app.vault.modify(file, result.content);
			new Notice('Removed embedded star counts');
		} else {
			new Notice('No embedded star counts found');
		}
	}

	async embedStarCountsForAllNotes(): Promise<void> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		let totalUpdatedLinks = 0;

		new Notice(`Embedding star counts across ${markdownFiles.length} notes...`);

		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			const matches = findGitHubLinkMatches(content);
			if (matches.length === 0) {
				continue;
			}

			for (const match of matches) {
				await this.getStarCount(match.owner, match.repo);
			}

			const result = rewriteGitHubLinksWithStars(content, matches, (match) => this.getFormattedCachedStars(match));
			if (result.updatedCount > 0) {
				await this.app.vault.modify(file, result.content);
				totalUpdatedLinks += result.updatedCount;
			}
		}

		this.rerenderAllOpenMarkdownViews();
		new Notice(`Embedded star counts for ${totalUpdatedLinks} GitHub links across all notes.`);
	}

	async removeEmbeddedStarCountsFromAllNotes(): Promise<void> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		let filesUpdated = 0;
		let totalRemoved = 0;

		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			const result = removeEmbeddedGitHubStars(content);

			if (result.removedCount > 0) {
				await this.app.vault.modify(file, result.content);
				filesUpdated += 1;
				totalRemoved += result.removedCount;
			}
		}

		this.rerenderAllOpenMarkdownViews();

		if (filesUpdated > 0) {
			new Notice(`Removed ${totalRemoved} embedded star counts from ${filesUpdated} notes.`);
		} else {
			new Notice('No embedded star counts found in any notes.');
		}
	}

	private async rewriteActiveNoteStars(options: {
		findMatches: (content: string) => GitHubLinkMatch[];
		noLinksNotice: string | null;
		progressNotice: ((count: number) => string) | null;
		successNotice: ((count: number) => string) | null;
		fetchLatest: boolean;
		failureNotice: string | null;
		shouldRewriteMatch: (match: GitHubLinkMatch) => boolean;
	}): Promise<number> {
		const activeView = this.getActiveMarkdownFileView();
		if (!activeView) {
			new Notice('No active markdown view found');
			return 0;
		}

		const file = this.requireActiveFile(activeView);
		if (!file) {
			return 0;
		}

		const content = await this.app.vault.read(file);
		const matches = options.findMatches(content);

		if (matches.length === 0) {
			if (options.noLinksNotice) {
				new Notice(options.noLinksNotice);
			}
			return 0;
		}

		if (options.progressNotice) {
			new Notice(options.progressNotice(matches.length));
		}

		if (options.fetchLatest) {
			for (const match of matches) {
				await this.getStarCount(match.owner, match.repo, true);
			}
		} else {
			for (const match of matches) {
				await this.getStarCount(match.owner, match.repo);
			}
		}

		const result = rewriteGitHubLinksWithStars(content, matches, (match) => {
			if (!options.shouldRewriteMatch(match)) {
				return null;
			}

			return this.getFormattedCachedStars(match);
		});

		if (result.updatedCount > 0) {
			await this.app.vault.modify(file, result.content);
			if (options.successNotice) {
				new Notice(options.successNotice(result.updatedCount));
			}
			return result.updatedCount;
		}

		if (options.failureNotice) {
			new Notice(options.failureNotice);
		}

		return 0;
	}

	/**
	 * Format star count according to settings
	 */
	formatStarCount(stars: number): string {
		return `⭐ ${this.formatNumber(stars)}`;
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

		new Setting(containerEl)
			.setName('Update embedded stars on refresh')
			.setDesc('When enabled, refreshing updates existing embedded star text. When disabled, embedded star text is left unchanged and may show an older value than the refreshed star count.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.updateEmbeddedStarsOnRefresh)
				.onChange(async (value) => {
					this.plugin.settings.updateEmbeddedStarsOnRefresh = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show token warnings on refresh')
			.setDesc('When enabled, manual refresh warns if the GitHub token is missing or invalid.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showTokenWarnings)
				.onChange(async (value) => {
					this.plugin.settings.showTokenWarnings = value;
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
