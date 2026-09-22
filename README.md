# UserScripts

A collection of userscripts for Violentmonkey / Tampermonkey, developed in a bun monorepo with Vite + [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey).

---

## Table of Contents

- [Introduction](#introduction)
- [Scripts](#scripts)
- [Install](#install)
- [Contributors](#contributors)
- [Contributing](#contributing)
- [License](#license)

---

## Introduction

This repository develops and maintains userscripts that enhance web pages with native-looking integrations — quality menus, batch downloads, and in-page actions that never make you leave the page.

Every script is built to blend into its target site: icons and styles are taken from the site itself first, falling back to [Lucide](https://lucide.dev/) only when the site provides nothing usable.

Scripts are built per-package and released independently via `<id>-v<version>` tags.

## Scripts

| Script                                                        | Userscript ID | Description                                                                                                                 |
| :------------------------------------------------------------ | :------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| [Hanime1 Download Manager](packages/hanime1-download-manager) | `h1dl`        | Native-style quality menu, batch download mode, and in-page downloads on hanime1. Languages: 繁體中文 / 简体中文 / English. |

## Install

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/)
2. Download the `.user.js` file from the latest [GitHub Release](../../releases) matching the script's id, or open it directly — the manager will prompt to install
3. Once installed, the script self-updates: `@updateURL` points at the released `meta.js`, so future tags of the same id are delivered automatically

## Contributors

<a href="https://github.com/OG-Open-Source/UserScripts/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=OG-Open-Source/UserScripts" alt="Contributor list and icons for OG-Open-Source/UserScripts"/>
</a>

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup, the scaffold command, style/icon guidelines, and the release workflow.

## License

### Primary Project License

The main source code and documentation in this repository are licensed under the [MIT License](https://opensource.org/license/MIT).

### Third-Party Components and Attributions

This project utilizes external components or code whose copyright and licensing requirements must be separately adhered to:

| Component Name                    | Source / Author | License Type | Location of License Document     | Hash Values                      |
| :-------------------------------- | :-------------- | :----------- | :------------------------------- | -------------------------------- |
| OG-Open-Source README.md Template | OG-Open-Source  | MIT          | /licenses/OG-Open-Source/LICENSE | 120aee1912f4c2c51937f4ea3c449954 |

---

© 2026 [OG-Open-Source](https://github.com/OG-Open-Source). All rights reserved.
