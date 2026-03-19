export interface CacheEntry {
	stars: number;
	timestamp: number;
}

export interface RepoRef {
	owner: string;
	repo: string;
}

export interface GitHubLinkMatch extends RepoRef {
	index: number;
	length: number;
	linkText: string;
}

export function shouldUseCachedEntry(
	entry: CacheEntry | undefined,
	cacheExpiryMinutes: number,
	now: number,
	forceRefresh = false
): boolean {
	if (!entry || forceRefresh) {
		return false;
	}

	const expiryTime = cacheExpiryMinutes * 60 * 1000;
	return now - entry.timestamp < expiryTime;
}

export function extractReposFromContent(content: string): RepoRef[] {
	const githubUrlRegex = /https?:\/\/(?:www\.)?github\.com\/([^/\s)#?]+)\/([^/\s)#?]+)(?:\/[^\s)]*)?/g;
	const repos = new Map<string, RepoRef>();
	let match;

	while ((match = githubUrlRegex.exec(content)) !== null) {
		const owner = match[1];
		let repo = match[2];

		if (repo.endsWith('.git')) {
			repo = repo.slice(0, -4);
		}

		repos.set(`${owner}/${repo}`, { owner, repo });
	}

	return Array.from(repos.values());
}

export function findGitHubLinkMatches(content: string): GitHubLinkMatch[] {
	const linkRegex = /(\[[^\]]*\]\(https?:\/\/(?:www\.)?github\.com\/([^/\s)]+)\/([^/\s)#?]+)[^)]*\))( ⭐ [\d,.]+[kMB]?)?/g;
	return collectLinkMatches(content, linkRegex);
}

export function findEmbeddedGitHubLinkMatches(content: string): GitHubLinkMatch[] {
	const embeddedLinkRegex = /(\[[^\]]*\]\(https?:\/\/(?:www\.)?github\.com\/([^/\s)]+)\/([^/\s)#?]+)[^)]*\))( ⭐ [\d,.]+[kMB]?)/g;
	return collectLinkMatches(content, embeddedLinkRegex);
}

export function rewriteGitHubLinksWithStars(
	content: string,
	matches: GitHubLinkMatch[],
	getFormattedStars: (match: GitHubLinkMatch) => string | null
): { content: string; updatedCount: number } {
	let updatedContent = content;
	let updatedCount = 0;

	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		const formattedStars = getFormattedStars(match);

		if (formattedStars === null) {
			continue;
		}

		const replacement = `${match.linkText} ${formattedStars}`;
		updatedContent =
			updatedContent.substring(0, match.index) +
			replacement +
			updatedContent.substring(match.index + match.length);
		updatedCount++;
	}

	return { content: updatedContent, updatedCount };
}

function collectLinkMatches(content: string, regex: RegExp): GitHubLinkMatch[] {
	const matches: GitHubLinkMatch[] = [];
	let match;

	while ((match = regex.exec(content)) !== null) {
		matches.push({
			index: match.index,
			length: match[0].length,
			linkText: match[1],
			owner: match[2],
			repo: match[3].replace(/\.git$/, ''),
		});
	}

	return matches;
}
