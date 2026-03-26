# Changelog

- Mar-27, 2026 - 12:53 AM +08 - [Released 1.5.0 with vault-wide star maintenance commands and CI enforcement]

## [1.5.0] - 2026-03-27

### Added
- Commands to refresh, embed, and remove GitHub star counts across all markdown notes in the vault
- GitHub Actions CI that installs dependencies, runs `pnpm test`, and runs `pnpm build` on pushes and pull requests
- Unit tests for vault-wide repo deduplication and embedded-star removal helpers

### Changed
- Refactored vault-wide refresh and removal flows to use shared helper logic covered by unit tests
- Added declared CodeMirror dependencies required for clean CI and reproducible installs

- Mar-19, 2026 - 10:59 PM +08 - [Refined refresh behavior, added tests, and updated docs]

## [1.4.0] - 2026-03-19

### Added
- Unit tests covering cache refresh and embedded star update behavior
- Refresh token warning setting for missing or invalid GitHub tokens
- Repo-local `AGENTS.md` and `dev-docs/SPECS.md`

### Changed
- `Refresh for current note` now bypasses valid cache entries for repositories in the active note
- Refreshes can update existing embedded stars without embedding plain links
- When enabled, embedded star updates can also happen on Reading View and Live Preview refresh paths
- Updated README and internal specs to match current behavior

### Fixed
- Invalid GitHub tokens now fall back to unauthenticated requests for public repositories
- Failed refreshes leave existing embedded star text unchanged and show one notice per refresh attempt

## [1.3.0] - 2026-03-19

### Removed
- Display Format setting — star counts are now always shown as `⭐ {stars}` (e.g. `⭐ 1.2k`)

### Changed
- Updated README with improved structure, badges, and documentation

### Fixed
- Corrected author name in `package.json`

## [1.2.1] - 2025-01-14

### Fixed
- Skip decoration when star count is already embedded in markdown

## [1.2.0]

### Changed
- Changed default cache expiry to 1 day (1440 minutes)

## [1.1.0]

### Added
- Abbreviated number formatting (e.g. 1.2k instead of 1,234)
- Commands to embed and remove star counts from markdown files

## [1.0.1]

### Fixed
- Minor bug fixes

## [1.0.0]

### Added
- Initial release
- Automatic GitHub star count display in Reading View and Live Preview
- Cache support to minimize API requests
- Optional GitHub API token for higher rate limits
