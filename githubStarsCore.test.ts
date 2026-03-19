import { describe, expect, it } from 'vitest';
import {
	extractReposFromContent,
	findEmbeddedGitHubLinkMatches,
	findGitHubLinkMatches,
	rewriteGitHubLinksWithStars,
	shouldUseCachedEntry,
} from './githubStarsCore';

describe('shouldUseCachedEntry', () => {
	it('uses a valid cache entry when refresh is not forced', () => {
		const entry = { stars: 42, timestamp: 1_000 };
		expect(shouldUseCachedEntry(entry, 10, 2_000, false)).toBe(true);
	});

	it('does not use an expired cache entry', () => {
		const entry = { stars: 42, timestamp: 1_000 };
		expect(shouldUseCachedEntry(entry, 1, 100_000, false)).toBe(false);
	});

	it('does not use a valid cache entry when refresh is forced', () => {
		const entry = { stars: 42, timestamp: 1_000 };
		expect(shouldUseCachedEntry(entry, 10, 2_000, true)).toBe(false);
	});
});

describe('extractReposFromContent', () => {
	it('deduplicates repositories and strips .git suffixes', () => {
		const content = `
[Repo](https://github.com/foo/bar)
https://github.com/foo/bar.git
https://github.com/baz/qux/tree/main
`;

		expect(extractReposFromContent(content)).toEqual([
			{ owner: 'foo', repo: 'bar' },
			{ owner: 'baz', repo: 'qux' },
		]);
	});
});

describe('refresh-related embedded star behavior', () => {
	it('finds only links that already have embedded stars', () => {
		const content = `
[Embedded](https://github.com/foo/embedded) ⭐ 1.2k
[Plain](https://github.com/foo/plain)
`;

		expect(findEmbeddedGitHubLinkMatches(content)).toEqual([
			expect.objectContaining({ owner: 'foo', repo: 'embedded' }),
		]);
	});

	it('updates only embedded stars and leaves plain links untouched', () => {
		const content = `
[Embedded](https://github.com/foo/embedded) ⭐ 1.2k
[Plain](https://github.com/foo/plain)
`;
		const matches = findEmbeddedGitHubLinkMatches(content);
		const result = rewriteGitHubLinksWithStars(content, matches, (match) => {
			return match.repo === 'embedded' ? '⭐ 2.0k' : null;
		});

		expect(result.updatedCount).toBe(1);
		expect(result.content).toContain('[Embedded](https://github.com/foo/embedded) ⭐ 2.0k');
		expect(result.content).toContain('[Plain](https://github.com/foo/plain)\n');
		expect(result.content).not.toContain('[Plain](https://github.com/foo/plain) ⭐');
	});

	it('updates embedded occurrences of the same repo while leaving plain occurrences plain', () => {
		const content = `
[Embedded](https://github.com/foo/shared) ⭐ 1.2k
[Plain](https://github.com/foo/shared)
`;
		const matches = findEmbeddedGitHubLinkMatches(content);
		const result = rewriteGitHubLinksWithStars(content, matches, () => '⭐ 2.0k');

		expect(result.updatedCount).toBe(1);
		expect(result.content).toContain('[Embedded](https://github.com/foo/shared) ⭐ 2.0k');
		expect(result.content).toContain('[Plain](https://github.com/foo/shared)\n');
		expect(result.content).not.toContain('[Plain](https://github.com/foo/shared) ⭐');
	});

	it('leaves embedded stars unchanged when refresh data is unavailable', () => {
		const content = `
[Embedded](https://github.com/foo/embedded) ⭐ 1.2k
`;
		const matches = findEmbeddedGitHubLinkMatches(content);
		const result = rewriteGitHubLinksWithStars(content, matches, () => null);

		expect(result.updatedCount).toBe(0);
		expect(result.content).toBe(content);
	});
});

describe('explicit embed command behavior', () => {
	it('writes stars for plain and already-embedded links', () => {
		const content = `
[Embedded](https://github.com/foo/embedded) ⭐ 1.2k
[Plain](https://github.com/foo/plain)
`;
		const matches = findGitHubLinkMatches(content);
		const result = rewriteGitHubLinksWithStars(content, matches, (match) => {
			if (match.repo === 'embedded') {
				return '⭐ 2.0k';
			}

			if (match.repo === 'plain') {
				return '⭐ 10';
			}

			return null;
		});

		expect(result.updatedCount).toBe(2);
		expect(result.content).toContain('[Embedded](https://github.com/foo/embedded) ⭐ 2.0k');
		expect(result.content).toContain('[Plain](https://github.com/foo/plain) ⭐ 10');
	});
});
