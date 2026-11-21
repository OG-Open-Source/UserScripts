# UserScripts

Userscripts for Violentmonkey / Tampermonkey that blend into the sites they enhance, built as a Bun + Vite ([vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey)) monorepo.

## Features

- **Core Capabilities**: A collection of independently released userscripts:

  | Script                                                        | Userscript ID | Description                                                                                                                                                                                                                         |
  | :------------------------------------------------------------ | :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | [Hanime1 Download Manager](packages/hanime1-download-manager) | `h1dl`        | Native-style quality menu, batch download mode, and in-page downloads on hanime1. Languages: 繁體中文 / 简体中文 / English.                                                                                                         |
  | [Page Translator](packages/page-translator)                   | `ptr`         | Tag-free automatic web page translator with CSS presentation, SPA lifecycle, volunteer site dictionaries (`static`/`dynamic`), BCP 47 language-vs-script routing, CJK auto-spacing (`js`/`w3c`/`both`), and `+-*` site delta rules. |

- **Problem Solved**: Enhancing web pages with native-looking integrations — quality menus, batch downloads, and in-page actions that never make you leave the page.
- **Key Advantage**: Every script is built to blend into its target site: icons and styles are taken from the site itself first, falling back to [Lucide](https://lucide.dev/) only when the site provides nothing usable. Scripts release independently and self-update once installed.

## Installation and Usage

### Prerequisites

- End users: any modern browser with a userscript manager — [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/)
- Developers: [Bun](https://bun.sh/) 1.2.0 or later (`engines.bun` in [package.json](package.json))

### Installation

**End users** — install a script from its latest [GitHub Release](../../releases):

1. Open the release matching the script's userscript ID.
2. Download the `.user.js` file, or open it directly — the userscript manager will prompt to install.
3. Once installed, the script self-updates: `@updateURL` points at the released `meta.js`, so future tags of the same ID are delivered automatically.

Each script is released independently via `<id>-v<version>` tags (Semantic Versioning 2.0.0, e.g. `h1dl-v1.1.0`).

**From source** — clone and build:

```bash
git clone https://github.com/OG-Open-Source/UserScripts.git
cd UserScripts
bun install
```

### Usage

Developer commands (run in the repository root):

```bash
bun run dev            # starts each script's Vite dev server with HMR and auto-installs into the browser manager
bun run build          # writes local dev builds to packages/<name>/.dist-dev/
bun run typecheck      # exits 0 when all types are valid
bun run check          # runs Biome lint and formatting checks
bun run test           # runs unit tests across packages/
```

End-user example: after installing Hanime1 Download Manager, video pages on hanime1 gain a native-style quality menu; picking a quality starts the download in place.

## Contributing

Contributions are welcome. By participating in this project, you agree to abide by the [Code of Conduct](https://github.com/OG-Open-Source/.github/blob/main/CODE_OF_CONDUCT.md).

1. Fork the repository and create a feature branch.
2. Make your changes and verify that all tests and linters pass (`bun run typecheck` is the project's configured check).
3. Sign off all commits using `git commit -s` to certify the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) (`Signed-off-by`).
4. Open a pull request and disclose any substantial AI-assisted code generation in the PR description.

See [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup, the scaffold command, style/icon guidelines, and the release workflow.

### Security

Please report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md). **Do not** report security vulnerabilities in public issues.

## License and Acknowledgments

This project is licensed under the [ISC License](LICENSE).

Third-party components retain their respective licenses (`opencc-js` is installed via package manager with `bun.lock` committed).

We thank every contributor who has helped improve this project. View the full list of contributors on the [contributors graph](https://github.com/OG-Open-Source/UserScripts/graphs/contributors).

<a href="https://github.com/OG-Open-Source/UserScripts/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=OG-Open-Source/UserScripts" alt="Contributor list and icons for OG-Open-Source/UserScripts"/>
</a>
