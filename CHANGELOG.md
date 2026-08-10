# Changelog

## 0.2.4

#### 🚀 Enhancement

- Mirrored [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor)'s header banner (logo pinned left, title centered on the page) and added its fixed bottom-left footer links, "🐛 Report a bug" and "💡 Request a feature", which open the matching issue form ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added an app version stamp to the footer that links to the source repository, styled to match [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)'s; it uses the `__APP_VERSION__` build-time define, which was already wired up but unused ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added a light/dark theme with a sun/moon toggle in the header, mirroring [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader): the OS preference is the default, the toggle stores an explicit override in `localStorage`, and an inline script applies it before first paint. The whole stylesheet moved from hardcoded colors to CSS custom properties; the dark values are the app's previous palette, so dark mode is unchanged ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Reworded the subtitle to "Explore video file layouts &middot; Learn more about codec parameterizations &middot; Compare reencoding strategies", and removed the page footer credits (the `vibes`/companion-tool links and the ffmpeg.wasm GPL note) ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))

#### 🏠 Internal

- Added GitHub issue forms (`.github/ISSUE_TEMPLATE/`) for bug reports and feature requests, plus a `config.yml` pointing general questions at EMBER and the BBQS helpdesk, copied from [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor) ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))

## 0.2.3

#### 🚀 Enhancement

- Added Google Analytics with a GDPR consent banner: tracking is only loaded after the user explicitly accepts, modeled on [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) ([#10](https://github.com/brain-bbqs/encoding-helper/pull/10))

## 0.2.2

#### 🚀 Enhancement

- Added logo/favicon assets (`src/assets/`) and wired them into the app: browser favicon (SVG + PNG fallbacks + `favicon.ico`), a logo next to the app title, and a logo in the README ([#8](https://github.com/brain-bbqs/encoding-helper/pull/8))

## 0.2.0

#### 🏠 Internal

- Added Storybook (`stories/`) and Chromatic visual regression testing (both a Storybook build and a dedicated Playwright suite under `tests/chromatic/`), plus a Playwright integration test suite (`tests/integration/`), modeled on [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) ([#5](https://github.com/brain-bbqs/encoding-helper/pull/5))
- Added the `reuse` pre-commit hook, plus `REUSE.toml`, `LICENSES/MIT.txt`, and a root `LICENSE` file, to bring the repository into REUSE license compliance, modeled on [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) ([#6](https://github.com/brain-bbqs/encoding-helper/pull/6))

## 0.1.0

#### 🐛 Bug Fix

- Fixed the "exact" ffmpeg.wasm engine failing with "failed to import ffmpeg-core.js": it was fetching the UMD core build, but Vite bundles `@ffmpeg/ffmpeg`'s worker as an ES module, which only accepts the ESM core build ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))

#### 🏠 Internal

- Refactored from a single static `index.html` file into a TypeScript/Vite app, with project infrastructure (build config, linting, testing, CI/CD) modeled on [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Deployed the app at the custom domain `encoding-helper.brain-bbqs.org` via a `public/CNAME` file ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Fixed `version-check.yml` to skip cleanly on this PR's first run, since `package.json` doesn't exist yet on `main` for it to diff against ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Added `configs/.codespellrc` (was referenced by `.pre-commit-config.yaml` but missing) to skip lockfiles/binary assets and allow-list `reencode`/`ans`, both legitimate (sleap-io's function name and a binary-search variable, respectively) ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
