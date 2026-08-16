# Changelog

## 0.6.0

#### 🚀 Enhancement

- **Reencode & CLI** is now **Reencode with ffmpeg**, and runs the command it builds over a few sampled seconds so the setting can be seen before it is used ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- **Compare Quality** is the sweep alone: there is no mode to pick, and the single-run quality, preset and resolution dropdowns have moved to the command builder ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- The square showing in the A/B window is written out as an ffmpeg command at the bottom of **Compare Quality**, with a button to copy it ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))

#### 🏠 Internal

- The sampled-stretch encoder and the A/B window are shared modules, so both encoding tabs run and draw the one comparison between them ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))

## 0.5.0

#### 🚀 Enhancement

- **Reencode & CLI** and **Compare Quality** have a **Resolution** dropdown that downscales the output, labelled with the size each fraction produces ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- A downscaled comparison is drawn back at the source's geometry, so both panes keep one zoom, pixel grid and coordinate system ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- Matrix mode sweeps resolution and scaler as extra axes grouping the grid's rows and columns, ticked to one value each so a default sweep is unchanged ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- A **Scaler** field beside the resolution picks the kernel the downscale resamples with, `lanczos` (sharper) or `bicubic` (softer) ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The A/B window switches a downscaled encode between **Blocks**, showing exactly the pixels that survived, and **Smooth**, showing what a player would ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The matrix preset list no longer tags the slower presets "slow in-browser" ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- Data savings are stated as a factor ("2.4× reduction", "1.3× inflation") beside the percentage, on every matrix square as well as the summaries ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The output console under both encode tabs is a fold that starts collapsed, showing its line count until you open it ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- Each output in a matrix sweep gets its own block of rows with a full-size title, so a second kernel stacks below rather than widening the table ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- **Single** and **Matrix** mode are a segmented control matching [clip-extractor](https://github.com/brain-bbqs/clip-extractor), both readable without opening a dropdown ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- A **Segments** count encodes that many stretches spread at random across the whole video, projecting the size from all of them and narrowing the range ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- **Compare Quality** asks only how long a stretch should be and how many: the sampler places them, so there is no start time to pick, and it defaults to five stretches of five seconds ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- Each sampled stretch is cut out of the source once and every encode reads that, instead of decoding the file from the start for every setting ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- Re-running at another setting reuses the stretches the last run measured, so the comparison is fair and a remote file is not downloaded again ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- A run encodes on several ffmpeg.wasm cores at once, so a matrix sweep finishes in a fraction of the time it took on one ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- One run button says what pressing it does: it turns into **Retry N failed** once a sweep leaves squares unmeasured, and the results section drops its legend and its own buttons ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The matrix results card is half again as wide as the rest of the page on a large screen, so a sweep's grid fits without scrolling sideways ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))

#### 🐛 Bug Fix

- A failed matrix square can be retried while the sweep is still running: it joins the queue instead of being unclickable until the end ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- **Stop** ends a run at once, terminating the encode in progress, instead of leaving the page locked and the bar filling until it finishes ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The ★ largest reduction is marked only once every combination has run, rather than moving from square to square as the grid fills in ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- A core that ran out of memory no longer takes every later square with it: the run gives its replacement the stretches back instead of failing on a missing input ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- An out-of-memory crash is reported as one, with the settings that bring it on, rather than as the core's own `memory access out of bounds` ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))
- The estimated savings under the A/B window covers every stretch a run encoded, instead of measuring all of their bytes against one stretch of the source and projecting a file several times too large ([#22](https://github.com/brain-bbqs/encoding-helper/pull/22))

## 0.4.0

#### 🚀 Enhancement

- **Compare Quality** has a **Matrix** mode that encodes the segment once per combination of the quality and preset dropdowns ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))
- The sweep fills in a grid of projected size, whole-file projection and encode time per square, marks the largest reduction ★ and loads it into the A/B window ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))
- Clicking any finished square shows it in the A/B window instead, and its settings can be pushed to the CLI command ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))
- The axes are tick lists, folded away behind a settings bar, with **Stop** to end a sweep while keeping what it measured ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))
- A square that failed can be run again by clicking it, or all of them at once from a **Retry** button ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))
- **Full Analysis** now carries the matrix as a table, and reports the settings the loaded comparison was actually encoded with ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))

#### 🏠 Internal

- A sweep writes the video into the encoder once and reuses it, rather than sending it across per combination, where the transferred buffer left every encode after the first failing ([#21](https://github.com/brain-bbqs/encoding-helper/pull/21))

## 0.3.3

#### 🐛 Bug Fix

- Wheel zoom in **Compare Quality** now holds the point under the cursor still, instead of drifting once the panes have been zoomed or panned ([#20](https://github.com/brain-bbqs/encoding-helper/pull/20))

## 0.3.2

#### 🚀 Enhancement

- The **x264 Preset** field now has an ⓘ explaining what it trades: the same quality at a given CRF, reached in fewer bytes the longer the encoder is given ([#19](https://github.com/brain-bbqs/encoding-helper/pull/19))
- A finished comparison leaves a full green bar instead of the word "Done." under an empty one ([#19](https://github.com/brain-bbqs/encoding-helper/pull/19))

#### 🐛 Bug Fix

- Compare Quality's progress bar measures the segment being encoded rather than the whole video, so it fills instead of stopping a tenth of the way along ([#19](https://github.com/brain-bbqs/encoding-helper/pull/19))
- The core's `Aborted()` exit line is kept out of the console, where it ended successful encodes looking like crashes ([#19](https://github.com/brain-bbqs/encoding-helper/pull/19))

## 0.3.1

#### 🚀 Enhancement

- **Compare Quality** now estimates data savings: a headline figure and two bars projecting the whole file from the encoded snippet ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))
- The projection applies the snippet's compression ratio to the source's real size, reading the sampled stretch's cost from the sample table where there is one ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))
- The projection carries a range, drawn on its bar, that narrows as more of the file is sampled ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))
- Added an **Estimate Detail** block with the numbers behind the headline, and the same projection to the **Full Analysis** document ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))

#### 🐛 Bug Fix

- A crashed ffmpeg.wasm core is replaced rather than reused, so one failed encode no longer fails every later one until reload ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))
- A crash now reports what to try instead of only `Aborted()` ([#18](https://github.com/brain-bbqs/encoding-helper/pull/18))

## 0.3.0

#### 🚀 Enhancement

- Renamed the **Report** tab to **Full Analysis** and moved it out of the tab row into a button beside the tabs ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- **Full Analysis** now produces a document: a title block, a linked table of contents, and every section in reading order with the ⓘ explainers written out inline ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The document carries the container explainer, bitrate plot, atom map, GOP histogram, seeking scatter and reencode result, charts included as inline SVG ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Added **Download HTML**, one self-contained file with no external assets, and **Save as PDF**, which prints the document rather than the page ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Dropped the indented text listing of the box tree, and the document's Video Track bitrate field now that the bitrate section carries it ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- The Markdown export renders explainers as paragraphs and bullets, names a chart it cannot carry, and uses `?tab=analysis` ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))

#### 🏠 Internal

- Moved the explainer copy shared by the tabs and the document into `src/lib/explainers.ts`, and extracted the GOP histogram and seeking scatter so the document plots the same run ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- Rebuilt the document's sections from a list of blocks (`kv`, `prose`, `badge`, `code`, `table`, `figure`), rendered in `src/lib/analysisDoc.ts` ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))
- An in-browser reencode now records its result in shared state ([#17](https://github.com/brain-bbqs/encoding-helper/pull/17))

## 0.2.9

#### 🚀 Enhancement

- Added a **Video Bitrate Over Time** card to the Inspect tab, plotting the video track's rate one window of playback at a time, straight from the sample table ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- A file whose rate really is constant gets an explanation instead of a flat line, decided by the frame sizes rather than the `btrt` box alone ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- Added peak, quietest and peak ÷ average readouts beside the plot ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))
- Dropped the Inspect tab's Video Track **Bitrate** field, since the new card's **Average** is the same number ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))

#### 🏠 Internal

- Synced `package-lock.json`'s own version field, which had been left behind at 0.2.7 ([#16](https://github.com/brain-bbqs/encoding-helper/pull/16))

## 0.2.8

#### 🚀 Enhancement

- Added − and + zoom buttons to the Compare Quality panes, so zooming no longer requires a scroll wheel or trackpad ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))
- Added a Play button, so the test segment can be watched straight through instead of only scrubbed frame by frame ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))
- Dropped the paragraph of hover/scroll/scrub instructions under the panes ([#15](https://github.com/brain-bbqs/encoding-helper/pull/15))

## 0.2.7

#### 🚀 Enhancement

- Replaced the Atom Map's indented tree with a horizontal map, a handful of rows tall whether the video runs ten seconds or ten hours ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Sized each box by how many boxes its subtree holds, so every box is drawn and labelled rather than reduced to a sliver ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Made the map zoomable, with a breadcrumb back out and neighbours merged into counted blocks when a file holds more boxes than fit ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Colored the map by top-level box, with a legend and a readout giving the offset and size of the box under the cursor ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))
- Made every block a button carrying its own offset and size, so those numbers are reachable by keyboard and screen reader ([#14](https://github.com/brain-bbqs/encoding-helper/pull/14))

## 0.2.6

#### 🚀 Enhancement

- Added the BBQS, CON and Talmo Lab watermarks framing the page, each linking to its own site ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Below 1420px of viewport width the BBQS mark is dropped and the footer bar flows into the document, where framing the page would overlap content ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Matched the footer links to [clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader), taking their lengths verbatim ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))
- Adopted those apps' indigo accent, `#4f46e5` light and `#818cf8` dark, in place of the previous blue ([#13](https://github.com/brain-bbqs/encoding-helper/pull/13))

## 0.2.5

#### 🚀 Enhancement

- Renamed the Inspect tab's "Format" field to "Container", with an ⓘ covering the container-vs-codec distinction and what each container can carry ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Added ⓘ explainers to the bitrate fields, including why the Overview's is labelled "overall" ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Metadata tag names are now readable labels, each with an ⓘ giving the raw name and its meaning, and encoder signatures are decoded in place ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Gave every tab a shareable URL (`?tab=…`), and a video loaded from a remote URL is recorded (`?src=…`) and re-opened automatically ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Retitled "CLI Command Builder" to **FFmpeg Command Builder** and gave it a plain-language preamble on reencoding, transcoding and remuxing ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Renamed the "Encode Test" tab to **Compare Quality**, and moved the in-browser engines into their own **Reencode In-Browser** tab ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Retitled the Inspect tab's first card to "Video Container Overview", with the container explainer under the heading and the field relabelled "Type" ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Reflowed the GOP explainer: it reads before the numbers, the I/P/B definitions are a list, and the sleap-io note has its own paragraph ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))

#### 🐛 Bug Fix

- Styled hyperlinks with the theme accent; they were falling back to the browser default `#0000EE`, nearly unreadable in dark mode ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))
- Fixed the two reencode engine descriptions rendering their markup as literal text ([#12](https://github.com/brain-bbqs/encoding-helper/pull/12))

## 0.2.4

#### 🚀 Enhancement

- Mirrored [clip-extractor](https://github.com/brain-bbqs/clip-extractor)'s header banner, and added its fixed "🐛 Report a bug" and "💡 Request a feature" footer links ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added an app version stamp to the footer, linking to the source repository ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Added a light/dark theme with a header toggle: the OS preference by default, an explicit override stored in `localStorage` ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))
- Reworded the subtitle, and removed the page footer credits and the drop zone's "nothing is uploaded" hint ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))

#### 🏠 Internal

- Added GitHub issue forms for bug reports and feature requests, plus a `config.yml` pointing general questions at EMBER and the BBQS helpdesk ([#11](https://github.com/brain-bbqs/encoding-helper/pull/11))

## 0.2.3

#### 🚀 Enhancement

- Added Google Analytics behind a GDPR consent banner, loaded only once the user accepts ([#10](https://github.com/brain-bbqs/encoding-helper/pull/10))

## 0.2.2

#### 🚀 Enhancement

- Added logo and favicon assets, wired into the browser tab, the app title and the README ([#8](https://github.com/brain-bbqs/encoding-helper/pull/8))

## 0.2.0

#### 🏠 Internal

- Added Storybook and Chromatic visual regression testing, plus a Playwright integration suite ([#5](https://github.com/brain-bbqs/encoding-helper/pull/5))
- Added the `reuse` pre-commit hook, `REUSE.toml`, `LICENSES/MIT.txt` and a root `LICENSE`, for REUSE compliance ([#6](https://github.com/brain-bbqs/encoding-helper/pull/6))

## 0.1.0

#### 🐛 Bug Fix

- Fixed the "exact" ffmpeg.wasm engine failing with "failed to import ffmpeg-core.js": it fetched the UMD core build where Vite's ES module worker needs the ESM one ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))

#### 🏠 Internal

- Refactored from a single static `index.html` into a TypeScript/Vite app, with build, lint, test and CI/CD infrastructure ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Deployed the app at the custom domain `encoding-helper.brain-bbqs.org` via a `public/CNAME` file ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Fixed `version-check.yml` to skip cleanly on this PR's first run, before `package.json` existed on `main` ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
- Added `configs/.codespellrc`, referenced by `.pre-commit-config.yaml` but missing ([#3](https://github.com/brain-bbqs/encoding-helper/pull/3))
