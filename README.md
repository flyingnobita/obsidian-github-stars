# GitHub Stars Plugin

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-green?style=for-the-badge)](CHANGELOG.md)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2FHEAD%2Fcommunity-plugin-stats.json&query=%24%5B%22github-stars%22%5D.downloads&logo=obsidian&label=downloads&style=for-the-badge&color=7C3AED)](https://obsidian.md/plugins?id=github-stars)

An Obsidian plugin that automatically displays GitHub star counts next to repository links in your notes — in both Reading View and Live Preview. Star counts can also be embedded directly into your markdown, making them visible outside Obsidian.

## ✨ Features

- Automatically detects GitHub repository URLs in your notes
- Displays the star count next to each GitHub repository link in both **Reading View** and **Live Preview**
- Embed star counts directly into your markdown files so they are **visible outside Obsidian**
- Caches star counts to minimize API requests
- Optional GitHub API token support for higher rate limits
- Supports abbreviated number formatting (e.g., 1.2k instead of 1,234)
- Commands to refresh, embed, and remove star counts

## 📸 Examples

When you include a GitHub repository URL in your notes, the plugin will automatically enhance it to show the star count:

![Obsidian GitHub Stars Plugin Screenshot](obsidian-github-stars-screenshot.png)  
_Star counts displayed inline next to GitHub repository links in Reading View._

## 📦 Installation

1. Open **Obsidian Settings** → **Community plugins**
2. Disable **Safe mode** if prompted
3. Click **Browse** and search for "GitHub Stars"
4. Click **Install**, then **Enable**

## ⚙️ Configuration

The plugin can be configured in the Settings tab:

- **Cache Expiry**: Time in minutes before the GitHub star count cache expires (default: 1440 minutes / 1 day)
- **Number Format**: Choose between full numbers (e.g., 1,234) or abbreviated format (e.g., 1.2k)
- **GitHub API Token**: Optional personal access token to increase the API rate limit from 60 to 5,000 requests per hour. To generate one:
    1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
    2. Click "Generate new token"
    3. Give it a name and select the "public_repo" scope
    4. Click "Generate token"
    5. Copy the token and paste it in the plugin settings

## 💻 Commands

The plugin adds the following commands:

- **Refresh for current note**: Refreshes all GitHub star counts in the current note
- **Clear cache**: Clears the cached star counts
- **Embed star counts in current note**: Writes star counts (e.g. `⭐ 1.2k`) directly into the markdown file after each GitHub link. Re-running updates existing counts.
- **Remove embedded star counts from current note**: Strips all embedded star counts from the file

## ❤️ Support This Project

You can support this project by:

- ⭐ Starring this repo
- 🔀 Making a pull request

## 📄 License

[MIT](LICENSE) © Flying Nobita
