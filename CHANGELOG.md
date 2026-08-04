# Changelog

## 0.1.0

#### 🐛 Bug Fix

- Fixed the "exact" ffmpeg.wasm engine failing with "failed to import ffmpeg-core.js": it was fetching the UMD core build, but Vite bundles `@ffmpeg/ffmpeg`'s worker as an ES module, which only accepts the ESM core build ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))

#### 🏠 Internal

- Refactored from a single static `index.html` file into a TypeScript/Vite app, with project infrastructure (build config, linting, testing, CI/CD) modeled on [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Deployed the app at the custom domain `encoding-helper.brain-bbqs.org` via a `public/CNAME` file ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Fixed `version-check.yml` to skip cleanly on this PR's first run, since `package.json` doesn't exist yet on `main` for it to diff against ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Added `configs/.codespellrc` (was referenced by `.pre-commit-config.yaml` but missing) to skip lockfiles/binary assets and allow-list `reencode`/`ans`, both legitimate (sleap-io's function name and a binary-search variable, respectively) ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
