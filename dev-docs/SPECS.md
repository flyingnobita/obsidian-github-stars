# Specs

## Commands

- `Clear cache` removes all stored cached star counts.
- `Refresh for current note` fetches fresh GitHub star counts for repositories in the active note, updates the cache, and may also update already-embedded star text depending on the refresh setting.
- `Embed star counts in current note` writes star counts into the active note as embedded `⭐ ...` text.
- `Remove embedded star counts from current note` removes embedded `⭐ ...` text from the active note.

## User Settings

- `Cache expiry` controls how long cached star counts remain fresh.
- `Number format` controls whether star counts are displayed as full numbers or abbreviated values.
- `GitHub API token (optional)` allows authenticated GitHub API requests for higher rate limits.
- `Update embedded stars on refresh` controls whether refreshes update embedded `⭐ ...` text in the active note.
- `Show token warnings on refresh` controls whether manual refresh warns when the GitHub token is missing or invalid.

## Refresh Behavior

- `Refresh for current note` only applies to the active note.
- `Refresh for current note` fetches fresh star counts from GitHub for repositories in the active note even if their cache entries are still valid.
- When `Update embedded stars on refresh` is enabled, refresh updates only links that already have embedded `⭐ ...` text in the active note and then rerenders the note.
- When `Update embedded stars on refresh` is enabled, Reading View and Live Preview refresh paths also update existing embedded `⭐ ...` text for repositories whose star counts were refreshed.
- If the same repository appears multiple times in the active note, refresh fetches it once and applies the result to all matching occurrences.
- When `Update embedded stars on refresh` is disabled, refresh rerenders the note without changing embedded `⭐ ...` text.
- If a refresh fetch fails for a repository, existing embedded star text for that repository is left unchanged.
- If one or more repository refreshes fail during a manual refresh, the plugin shows a single failure notice for that refresh attempt.

## Rendering Modes

- Reading View injects star counts into rendered HTML after GitHub repository links.
- Live Preview injects star counts as CodeMirror widgets after visible GitHub repository links.
- Embedded star text in the markdown file is distinct from transient rendered star counts.

## Embedded Star Rules

- The plugin detects existing embedded `⭐ ...` text and skips adding duplicate stars during normal rendering.
- Refresh never embeds stars for plain links. It only updates embedded `⭐ ...` text that already exists when the refresh setting is enabled.
- `Embed star counts in current note` writes or updates embedded `⭐ ...` text directly in the markdown file.
- `Remove embedded star counts from current note` removes embedded `⭐ ...` text while leaving the GitHub links intact.

## Authentication Behavior

- If no GitHub API token is configured, requests use the lower unauthenticated GitHub API rate limit.
- During a manual refresh of a note, token warnings are shown at most once even if the refresh processes multiple GitHub links.
- If GitHub rejects the configured token, the plugin logs a warning, shows a notice, and retries public repositories without authentication.

## Cache Behavior

- GitHub star counts are cached per repository using `owner/repo` as the cache key.
- Each cache entry stores the fetched star count and a timestamp.
- Cache expiry is lazy, not proactive. When an entry expires, the plugin does not schedule or run a background refresh automatically.
- A fresh API request only happens the next time the plugin tries to resolve stars for that repository and sees that the cached entry is missing or expired.
- Star lookups can be triggered by rendering a note in Reading View, rendering visible GitHub links in Live Preview, running `Refresh for current note`, or running `Embed star counts in current note`.
- If a cached entry is still within the configured expiry window, the cached value is used and no network request is made.
- If a request fails and a stale cache entry exists for the same repository, the stale cached value may still be returned.
- Clearing the cache removes stored cache entries but does not remove star text that is already rendered in the current UI.

## Supported URLs

- The plugin only processes GitHub repository URLs.
- Repository parsing extracts `owner/repo` from standard GitHub URLs and strips a trailing `.git` suffix from the repository name.
- Non-repository GitHub URLs and malformed links are ignored.
