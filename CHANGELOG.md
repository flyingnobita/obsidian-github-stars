# Changelog

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
