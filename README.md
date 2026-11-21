# UserScripts

Userscripts for Violentmonkey / Tampermonkey that blend into the sites they enhance, built as a Bun + Vite ([vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey)) monorepo.

## Features

- **Core Capabilities**: A collection of independently released userscripts:

  | Script                                                        | Userscript ID | Description                                                                                                                                                                                                                                  |
  | :------------------------------------------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | [Hanime1 Download Manager](packages/hanime1-download-manager) | `h1dl`        | Native-style quality menu, batch download mode, and in-page downloads on hanime1. Languages: 繁體中文 / 简体中文 / English.                                                                                                                  |
  | [Page Translator](packages/page-translator)                   | `ptr`         | Tag-free automatic web page translator with CSS presentation, SPA lifecycle, volunteer site dictionaries (`static`/`dynamic`/`scoped`), BCP 47 language-vs-script routing, CJK auto-spacing (`js`/`w3c`/`both`), and `+-*` site delta rules. |

- **Problem Solved**: Enhancing web pages with unobtrusive, in-page controls — quality menus, batch downloads, and non-destructive translation overlays that never force you off the page.
- **Key Advantage**: Scripts reuse the target site's native classes and icon fonts first, falling back to the shared **NovaKit Borderless (`oklch()`/`oklab()`)** UI design system (`@userscripts/shared`) with inline geometric SVGs, four-mode theme adaptation (`dark` / `light` / `system` / `host`), and `[data-us-ui]` cross-script collision guards when native primitives are unavailable. Each script releases independently and self-updates once installed.

## Installation and Usage

### Prerequisites

- End users: a modern browser with a userscript manager — [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/)
- Developers: [Bun](https://bun.sh/) `>= 1.2.0` (`engines.bun` in [package.json](package.json))

### Installation

**End users** — install a script from its latest [GitHub Release](https://github.com/OG-Open-Source/UserScripts/releases):

1. Open the release matching the script's userscript ID.
2. Download or open the `.user.js` asset — your userscript manager will prompt to install.
3. Installed scripts self-update automatically via `@updateURL` and `@downloadURL`.

Each script is released independently via `<id>-v<version>` tags (Semantic Versioning 2.0.0, e.g. `h1dl-v1.1.0`, `ptr-v1.0.0`).

**From source** — clone and install workspace dependencies:

```bash
git clone --recurse-submodules https://github.com/OG-Open-Source/UserScripts.git
cd UserScripts
bun install
```

### Usage

Developer commands (run in the repository root):

```bash
bun run check                 # runs Ultracite / Biome lint and formatting checks
bun run fix                   # auto-fixes lint and formatting issues
bun run new <name>            # scaffolds a new package under packages/
bun run --filter '*' dev      # starts each script's Vite dev server with HMR
bun run --filter '*' build    # writes local 0.0.0-dev builds to packages/<name>/.dist-dev/
bun run --filter '*' typecheck # runs TypeScript type checking across all packages
bun test ./packages           # runs unit tests across packages/
```

End-user example: after installing **Hanime1 Download Manager**, video pages on hanime1 gain a native-style quality menu, and clicking a quality starts the download in place without navigating away.

## Contributing

Contributions are welcome. By participating in this project, you agree to abide by the [Code of Conduct](https://github.com/OG-Open-Source/.github/blob/main/CODE_OF_CONDUCT.md).

1. Fork the repository and create a feature branch.
2. Make your changes and verify that all checks and tests pass (`bun run check`, `bun run typecheck`, `bun run test`).
3. Sign off all commits using `git commit -s` to certify the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) (`Signed-off-by`).
4. Open a pull request and disclose any substantial AI-assisted code generation in the PR description.

See [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup, the package scaffold tool, UI/UX guidelines, and the release workflow.

### Security

Please report security vulnerabilities privately via [GitHub Private Vulnerability Reporting](https://github.com/OG-Open-Source/UserScripts/security/advisories/new) or as described in [SECURITY.md](SECURITY.md). **Do not** report security vulnerabilities in public issues.

## License and Acknowledgments

This project is licensed under the [ISC License](LICENSE).

Third-party components retain their respective licenses (`opencc-js` is installed via package manager with `bun.lock` committed).

We thank every contributor who has helped improve this project. View the full list of contributors on the [contributors graph](https://github.com/OG-Open-Source/UserScripts/graphs/contributors).

<a href="https://github.com/OG-Open-Source/UserScripts/graphs/contributors">
  <img
    src="https://contrib.rocks/image?repo=OG-Open-Source/UserScripts"
    alt="Contributor list and icons for OG-Open-Source/UserScripts"
  >
</a>
