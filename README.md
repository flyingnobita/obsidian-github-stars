# GitHub Stars Plugin

Display the number of stars next to GitHub repository links.

_Note: This plugin currently only display the stars in **Reading View**. In the future I hope to support it in Live Preview as well._

## Features

-   Automatically detects GitHub repository URLs in your notes
-   Displays the star count next to each GitHub repository link
-   Caches star counts to minimize API requests
-   Configurable display format for star counts
-   Optional GitHub API token support for higher rate limits
-   Supports abbreviated number formatting (e.g., 1.2k instead of 1,234)
-   Command to refresh star counts for the current note

## Examples

When you include a GitHub repository URL in your notes, the plugin will automatically enhance it to show the star count:

![Obsidian GitHub Stars Plugin Screenshot](obsidian-github-stars-screenshot.png)

## Configuration

The plugin can be configured in the Settings tab:

-   **Cache Expiry**: Time in minutes before the GitHub star count cache expires (default: 60 minutes)
-   **Display Format**: Format for displaying star counts. Use `{stars}` as a placeholder for the number (default: `⭐ {stars}`)
-   **Number Format**: Choose between full numbers (e.g., 1,234) or abbreviated format (e.g., 1.2k)
-   **GitHub API Token**: Optional personal access token for GitHub API to increase rate limits

## Commands

The plugin adds the following commands:

-   **Refresh GitHub Stars for Current Note**: Refreshes all GitHub star counts in the current note
-   **Clear GitHub Stars Cache**: Clears the cached star counts

## GitHub API Rate Limits

The GitHub API has rate limits for unauthenticated requests (60 requests per hour). If you use GitHub extensively in your notes, you might want to add a GitHub personal access token in the plugin settings to increase this limit (5,000 requests per hour for authenticated requests).

To create a GitHub personal access token:

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token"
3. Give it a name and select the "public_repo" scope
4. Click "Generate token"
5. Copy the token and paste it in the plugin settings

## Roadmap

-   [ ] Support for Live Preview mode

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
