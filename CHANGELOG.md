# Changelog

## 0.3.0

#### 🚀 Enhancement

- Renamed the **Report** tab to **Full Analysis** and moved it out of the tab row: it is now a single button aligned to the right of the content column, carrying a document-with-download icon. It was never a seventh place to look, it was the one control on that row that produces something, and sharing the row (and the word "report", which the footer already uses for "🐛 Report a bug") made it read as both a view and an issue-reporting feature ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- What the button produces is now an actual document rather than a page of cards: a title block naming the file with its container, codec, resolution, frame rate, duration and size, a linked table of contents, and every section in reading order. The explainers that live behind an ⓘ on the page are written out inline, since nobody can hover a saved file ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The document now carries the analyses the report used to leave behind: this file's container explainer, the **Video Bitrate Over Time** stats with the plot itself (including the constant-bitrate and too-few-frames cases), the GOP histogram, the seeking test's scatter plot, the chroma-subsampling and faststart notes, and the result of an in-browser reencode. Charts travel as inline SVG, so they survive into the saved file ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The document draws the **atom map** itself. It is the same map the Atom Map tab shows, minus the parts that need a hand (no zoom, no breadcrumb, no hover readout), with its legend, and with each block's offset and size kept as a `title` so the exported HTML still reveals them on hover. Which labels fit is decided while the document is built, since nothing runs inside it to measure itself later ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Dropped the indented text listing of the box tree that the old report printed, in the document and in the Markdown export alike. It only ever restated what the map draws, and on a fragmented recording it ran to tens of thousands of lines; the map is the whole of what this section says now ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Added **Download HTML**: the whole document as one self-contained file with its stylesheet inlined and no external asset, script or font, so it opens the same from a downloads folder, an email attachment or an air-gapped machine ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The panel now shows that exact file, rendered in an iframe from the same string the download writes and the print dialog prints, so there is no preview that can disagree with what you save. **Save as PDF** prints the document itself instead of the page, which replaces the old trick of hiding every other element behind `@media print` — pressing Ctrl+P anywhere in the app now prints the page you are looking at rather than a blank sheet ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Dropped the Video Track section's **Bitrate** field from the document, now that the bitrate section below it carries the average alongside the plot, matching the split the Inspect tab already made ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The Markdown export keeps up: explainers arrive as paragraphs and bullets rather than one run-on line, and a chart it cannot carry is named rather than dropped. Its `?tab=` value is now `analysis` ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))

#### 🏠 Internal

- Moved the explainer copy shared by the tabs and the document into `src/lib/explainers.ts`, so the page and the exported document cannot explain the same number two different ways, and extracted the GOP histogram and the seeking scatter plot from the GOP & Seeking tab so the document plots the same run rather than only tabulating it ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Replaced the report's three section shapes with sections built from a list of blocks (`kv`, `prose`, `badge`, `code`, `table`, `figure`), so adding content to the document is a matter of listing blocks rather than teaching a renderer a new layout. Rendering lives in `src/lib/analysisDoc.ts`, state-gathering in `src/ui/analysisTab.ts` ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- An in-browser reencode now records its result in shared state, which the previously unused `reencodeResult` field was always meant to hold ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))

## 0.2.9

#### 🚀 Enhancement

- Added a **Video Bitrate Over Time** card to the Inspect tab, plotting the video track's rate one window of playback at a time (roughly one per second, bounded so a 10-second clip and a 10-hour recording both draw a readable number of steps) against the track average. The Inspect tab could only say what the bitrate averaged to, which is the one thing a variable-bitrate encode is guaranteed not to be doing at any given moment; the plot shows where the bits actually went. It is measured straight from the container's sample table, so no decoding is involved, and hovering a window gives its rate and frame count ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- The plot is replaced by an explanation for a file whose rate really was held constant, since it would only ever draw a flat line. A `btrt` box declaring the same number as both the track's average and its maximum is not enough on its own: muxers routinely write the computed average into both fields whatever the encoder was doing (the bundled `mice.mp4` is a CRF encode that does exactly this), so the frame sizes have to agree before the plot is suppressed. Where the declaration and the frames disagree, the card plots the measurement and says why the declaration cannot be taken at face value ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- Added peak, quietest and peak ÷ average readouts beside the plot, the last being how much bandwidth headroom playback needs beyond the average, and cross-referenced the new card from the Overview's **Overall Bitrate** explainer ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- Dropped the **Bitrate** field from the Inspect tab's Video Track card, since the new card's **Average** is the same number measured the same way; its ⓘ explainer moved across with it. A file with too few frames to divide into windows still gets the average there, with a note in place of the plot. The Report tab continues to list the video track's bitrate, having no plot to carry it ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))

#### 🏠 Internal

- Synced `package-lock.json`'s own version field, which had been left behind at 0.2.7 ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))

## 0.2.8

#### 🚀 Enhancement

- Added − and + zoom buttons to the Compare Quality panes, so zooming no longer requires a scroll wheel or a trackpad. They step the zoom by 1.5× around the middle of the pane, both panes staying in sync as with the wheel, and each disables itself at the end of the zoom range the wheel already clamped to ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))
- Added a Play button, so the test segment can be watched straight through instead of only scrubbed frame by frame. Both panes are decoded per frame, so playback is paced off the wall clock and drops frames when decoding cannot keep up rather than drifting into slow motion; the button doubles as Pause, dragging the slider mid-playback moves the playhead, and playing from the end starts the segment over ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))
- Dropped the paragraph of hover/scroll/scrub instructions under the panes ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))

## 0.2.7

#### 🚀 Enhancement

- Replaced the Atom Map's indented tree with a horizontal map: left to right across the file, each row down one level of nesting. The tree grew one row per box, which for a fragmented recording (a `moof`+`mdat` pair per fragment) meant thousands of rows; the map is a handful of rows tall whether the video runs ten seconds or ten hours ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Sized each box by how many boxes its subtree holds rather than by its bytes, siblings splitting their parent's width between them. That is the split that makes the narrowest box as wide as it can be, so every box in the file is drawn and labelled at once instead of a `moov` under 1% of the file being reduced to an unreadable sliver ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Made the map zoomable: clicking any box narrows the view to it and a breadcrumb walks back out. A file with more boxes than the panel has room for never drops any, only merges neighbours into a block saying how many it stands for, and a merged run is cut as soon as it is wide enough to draw — so a 20,000-fragment file striates into blocks whose density is the fragmentation, rather than becoming one anonymous bar ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Colored the map by which top-level box each box belongs to (`moov`, `mdat`, `moof`, or everything else), with a legend and a readout naming the box under the cursor and giving its offset and size; `moof`, `mfra`, `free` and `skip` are named there too, where the tree had labelled only `ftyp`, `moov` and `mdat`. The palette was checked for colorblind separation and contrast against both themes' card surface ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Every block is a button carrying its own offset and size, so the numbers the tree spelled out are reachable by keyboard and screen reader as well as by hovering. The Report tab still writes the whole tree out as indented text ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))

## 0.2.6

#### 🚀 Enhancement

- Added the BBQS corner watermark from [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), circle-cropped and linking to [brain-bbqs.org](https://brain-bbqs.org), fixed to the top-left of the page ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Added the CON watermark to the bottom-right of the footer bar, linking to [centerforopenneuroscience.org](https://centerforopenneuroscience.org), again matching bbqs-uploader ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Added the Talmo Lab logo to the left of CON, linking to [talmolab.org](https://talmolab.org/), with the lab's name set beneath it since the flask carries no wordmark of its own the way the CON artwork does. The lab draws that flask with a near-black outline that vanishes against the dark theme, so each theme loads the stroke variant it can see ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Below 1420px of viewport width there is no longer room for the watermarks to frame the page without overlapping content, so the BBQS mark is dropped and the footer bar flows into the document instead of staying fixed ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Matched the bottom-left footer links to [brain-bbqs/clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [brain-bbqs/bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader): they were set at 13px against those apps' 0.92rem, which read visibly smaller. Their lengths are now taken verbatim, so the three footers are pixel-identical ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Adopted those apps' indigo accent, `#4f46e5` light and `#818cf8` dark, in place of the previous `#2952cc`/`#6c9fff` blue. The footer links inherit the accent, so matching them meant matching it everywhere; buttons, tabs, links and the print stylesheet shift with it ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))

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
