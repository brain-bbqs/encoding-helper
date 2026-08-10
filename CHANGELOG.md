# Changelog

## 0.2.6

#### 🚀 Enhancement

- Added the BBQS corner watermark from [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), circle-cropped and linking to [brain-bbqs.org](https://brain-bbqs.org), fixed to the top-left of the page ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Added the CON watermark to the bottom-right of the footer bar, linking to [centerforopenneuroscience.org](https://centerforopenneuroscience.org), again matching bbqs-uploader ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Added the Talmo Lab logo to the left of CON, linking to [talmolab.org](https://talmolab.org/), with the lab's name set beneath it since the flask carries no wordmark of its own the way the CON artwork does. The lab draws that flask with a near-black outline that vanishes against the dark theme, so each theme loads the stroke variant it can see ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Below 1420px of viewport width there is no longer room for the watermarks to frame the page without overlapping content, so the BBQS mark is dropped and the footer bar flows into the document instead of staying fixed ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))

## 0.2.5

#### 🚀 Enhancement

- Renamed the Inspect tab's "Format" field to "Container" and gave it an ⓘ explainer covering the container-vs-codec distinction plus, per container (MP4, QuickTime, Matroska, WebM, Ogg, MP3, WAVE, FLAC, ADTS, MPEG-TS, HLS), which video and audio codecs it can carry and where it plays ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Added ⓘ explainers to the bitrate fields, including why the Overview's is labelled "overall" (whole file, every track plus container overhead, versus the per-track figures below it) ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Explained the Metadata Tags card: tag names are now shown as readable labels backed by a knowledge base of MP4/QuickTime atoms, ID3v2 frames, Vorbis comments and RIFF INFO chunks, each with an ⓘ giving the raw name and what it means. This answers what `©too` is (the encoding tool; the leading `©` is byte `0xA9`, QuickTime's text-atom marker, not a copyright statement), and recognizable encoder signatures such as `Lavf60.16.100` are decoded in place ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Gave every tab a shareable URL (`?tab=…`), restored on load and navigable with browser back/forward; a video loaded from a remote URL is also recorded (`?src=…`) and re-opened automatically, so a link carries both the file and the tab ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Added a plain-language preamble to the CLI Command Builder describing what reencoding, transcoding and remuxing are and how they differ ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Moved the GOP explainer directly under the "GOP / Keyframe Structure" heading so it reads before the numbers, matching the Atom Map tab ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Renamed the "Encode Test" tab to "Compare Quality" ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Retitled the Inspect tab's first card to "Video Container Overview" with the container explainer as a description under the heading (rather than an ⓘ popover) and the field itself relabelled "Type" ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Broke the I/P/B-frame definitions in the GOP explainer out into a bulleted list, and moved the sleap-io note to its own paragraph linking to the [`sio reencode` CLI reference](https://io.sleap.ai/latest/cli/#sio-reencode) ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Retitled "CLI Command Builder" to "FFmpeg Command Builder", linked to [ffmpeg's install page](https://ffmpeg.org/download.html), and explained why running ffmpeg natively is preferable to the in-browser engines for real work ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Moved the in-browser reencode engines out of the Reencode & CLI tab into their own "Reencode In-Browser" tab, to the right of Compare Quality. Both engines already processed the whole video and saved it to a file of your choosing; the new tab says so up front ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))

#### 🐛 Bug Fix

- Styled hyperlinks with the theme accent color; they were falling back to the browser default `#0000EE`, which was nearly unreadable in dark mode (the sleap-io link on the Reencode & CLI card) ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Fixed the two reencode engine descriptions rendering their markup as literal text, so "No CRF control &mdash; WebCodecs…" showed the raw entity ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))

## 0.2.4

#### 🚀 Enhancement

- Mirrored [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor)'s header banner (logo pinned left, title centered on the page) and added its fixed bottom-left footer links, "🐛 Report a bug" and "💡 Request a feature", which open the matching issue form ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added an app version stamp to the footer that links to the source repository, styled to match [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)'s; it uses the `__APP_VERSION__` build-time define, which was already wired up but unused ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added a light/dark theme with a sun/moon toggle in the header, mirroring [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader): the OS preference is the default, the toggle stores an explicit override in `localStorage`, and an inline script applies it before first paint. The whole stylesheet moved from hardcoded colors to CSS custom properties; the dark values are the app's previous palette, so dark mode is unchanged ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Reworded the subtitle to "Explore video file layouts &middot; Learn more about codec parameterizations &middot; Compare reencoding strategies", and removed the page footer credits (the `vibes`/companion-tool links and the ffmpeg.wasm GPL note) along with the drop zone's "nothing is uploaded" hint ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))

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
