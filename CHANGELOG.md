# Changelog

## 1.3.1

#### 🚀 Enhancement

- The faststart badge and its explainer moved to the **MP4 Box / Atom Structure** card, beside the map of the box order they report ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- **This File's Container** folded into the **Video Container Overview** card, which now names the container in its heading and drops the Type row ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The MIME Type readout carries an ⓘ saying what a media type is ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The overview's four figures sit on one row, the MIME type taking the width left over rather than wrapping onto a line of its own ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Inspect's cards lead with what they measured, with the teaching text under it, and the page reads in a wider column so a row of figures is not left wrapping ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The Video Track card reports the file's **Chroma** subsampling, read out of its codec configuration, and its explainer no longer states a format for a file that declares none ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The Atom Map's legend keys only what it drew, dropping its note and any row for fragment indexes or collapsed runs the file has none of ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The Atom Map stops offering to zoom into a block that already fills the view, which used to grow the breadcrumb without changing the map ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Every figure read out of the file sits in a card of its own, the recessed panel the demo tiles use, with strings out of the file set as code ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The container explainer's mention of the **Atom Map** links to it, on the page and in the document ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Teach boxes carry a mark for what they are about — 🎥 for this file's container, 🎨 for chroma subsampling, 🚀 for faststart — rather than 💡 throughout ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The codec and chroma explainers no longer repeat the profile, level and subsampling format, which the track card lists as figures right above them ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The Atom Map drops the teach box describing the box tree and how to read the map, both of which the container overview and the readout under the map already say ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Each figure card is now as wide as its own label and value, rather than taking a fixed column share that left short readings in mostly empty cards ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Inspect reads overview, video track, atom map, GOP, bitrate, audio: the GOP card follows the map and the audio track comes last, in the document too ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The Educational switch sits in the header beside the light/dark toggle, one preference control for the app rather than one in the first card of two tabs ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The seeking test explains itself in a teach box like every other card, its results are spaced off the Run button, and both plots drop their captions ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- The ⓘ button's "i" is drawn rather than typed, so it sits centred in its circle on every platform instead of wherever the fallback font put it ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))

#### 🏠 Internal

- Tooltips throughout the app are shorter, most of all on Compare Quality, where several ran to three or four paragraphs ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Size factors now read "original 2.4× larger" or "encoded 1.3× larger" instead of "2.4× reduction", naming which file the factor belongs to ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))
- Every explainer, teach box, chart caption and knowledge-base record now lives in `src/lib/explainers.ts`, ordered as the app shows it ([#35](https://github.com/brain-bbqs/encoding-helper/pull/35))

## 1.3.0

#### 🚀 Enhancement

- The seeking test now samples 100 timestamps by default, and its per-sample table folds away behind a bar that carries the row count ([#33](https://github.com/brain-bbqs/encoding-helper/pull/33))

## 1.2.1

#### 🐛 Bug Fix

- The Compare Quality sweep no longer prints a progress line above the results grid; the bar and the squares themselves show what is encoding ([#32](https://github.com/brain-bbqs/encoding-helper/pull/32))

## 1.2.0

#### 🚀 Enhancement

- Compare Quality now reads back what earlier sweeps of the same file measured instead of encoding those squares again, with a tick box to turn the reuse off ([#31](https://github.com/brain-bbqs/encoding-helper/pull/31))
- The footer carries a **Clear sweep cache** button that forgets every stored measurement, beside the version stamp ([#31](https://github.com/brain-bbqs/encoding-helper/pull/31))

## 1.1.1

#### 🐛 Bug Fix

- The Compare Quality progress line now counts the squares being encoded instead of naming them, so it no longer runs to a paragraph that shifts the grid down the page ([#30](https://github.com/brain-bbqs/encoding-helper/pull/30))
- The results grid now highlights the clicked square immediately and it alone; ★ best keeps its star and accent figure instead of a competing outline ([#30](https://github.com/brain-bbqs/encoding-helper/pull/30))

## 1.1.0

#### 🚀 Enhancement

- The Side-by-Side window now plays every sampled stretch in turn and loops, its scrub bar drawn as the stretches themselves with the one on screen lit ([#29](https://github.com/brain-bbqs/encoding-helper/pull/29))

## 1.0.0

#### 🚀 Enhancement

- **Browse Demo Files** replaces **Load Sample** with a page of its own (`?demos`), listing the demo set published on EMBER dandiset 000527, grouped by what each file varies ([#28](https://github.com/brain-bbqs/encoding-helper/pull/28))
- The set is laid out as a card of tiles per theme, each in its own colour and packed to the width its files need, ordered outermost-in from the container to the structure inside the stream ([#28](https://github.com/brain-bbqs/encoding-helper/pull/28))
- Pressing a tile opens one detail card under that theme, in the theme's colour and pointing a notch at the tile it describes, carrying the only prose on the page ([#28](https://github.com/brain-bbqs/encoding-helper/pull/28))
- The demo set carries a recommended encode alongside the demonstrations: H.264 High, a slow preset, a keyframe every second and faststart, for video that has to seek well and stream ([#28](https://github.com/brain-bbqs/encoding-helper/pull/28))

#### 🐛 Bug Fix

- A refused byte-range read is now reported as the failed fetch it is, rather than reaching the parser as a file whose moov box is missing ([#28](https://github.com/brain-bbqs/encoding-helper/pull/28))

## 0.8.0

#### 🚀 Enhancement

- The Compare Quality sweep now starts ticked to high and medium quality, presets up to `fast`, and the 100% and 75% resolutions ([#26](https://github.com/brain-bbqs/encoding-helper/pull/26))
- The resolution tick list is laid out as a 2×2 grid ([#26](https://github.com/brain-bbqs/encoding-helper/pull/26))
- The sweep settings carry a "select all" button that ticks every value on every axis ([#26](https://github.com/brain-bbqs/encoding-helper/pull/26))
- The "Output console" line carries a caret and the same recessed-bar look as the sweep settings, marking it expandable ([#26](https://github.com/brain-bbqs/encoding-helper/pull/26))

## 0.7.0

#### 🚀 Enhancement

- An Educational switch at the top-right of the first card on **Inspect** and **Reencode with FFmpeg** (left off **Compare Quality**), remembered across reloads and on by default, hides every "teach" box and ⓘ tooltip across the tabs; Full Analysis always leaves them out regardless ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))
- **Inspect** carries a sticky "On this page" table of contents beside its sections, pydata-docs style ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))
- The subtitle's three goals and the Educational switch share the same 🎓 icon for "Learn more about codec parameters"; each tab carries the same icon as its goal, and every "teach" box is marked with 💡; the switch's state is also shareable via a `?edu=` link ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))
- The Compare Quality/A-B viewer's playback now loops instead of stopping at the end of the sampled stretch ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))
- **Inspect** folds Metadata Tags into the Video Container Overview card and the seeking test into the GOP/Keyframe Structure card, and moves the atom map ahead of the bitrate plot; the container-detail card is left out entirely with Educational off ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))

#### 🐛 Bug Fix

- Toggling Educational no longer collapses an open "Settings to sweep" panel on Compare Quality ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))

#### 🏠 Internal

- Dropped the sample-picker's "Encoding … from … of …" readout line beneath the trim track, and Compare Quality's intro explainer ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))
- The whole-file encode section's heading now reads "Reencode the Entire File Here" or "Transcode the Entire File Here", matching the button beneath it ([#25](https://github.com/brain-bbqs/encoding-helper/pull/25))

## 0.6.1

#### 🐛 Bug Fix

- Stopping a Compare Quality sweep and then changing which settings it sweeps no longer leaves the run button resuming into the old grid ([#24](https://github.com/brain-bbqs/encoding-helper/pull/24))

## 0.6.0

#### 🚀 Enhancement

- Six tabs are now three: **Inspect** holds the atom map and the GOP/seeking sections, and **Reencode with FFmpeg** (formerly **Reencode & CLI**) holds the whole-file in-browser encode ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- **Reencode with FFmpeg** runs the command it builds over a few sampled seconds, so a setting can be seen before it is used ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- Every encode now goes through ffmpeg: the WebCodecs "fast" engine, which could only approximate the CRF you asked for, is gone ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- A link naming one of the retired tabs opens where that content went, and the address bar is corrected to the tab it landed on ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- **Compare Quality** is the sweep alone: there is no mode to pick, and the single-run quality, preset and resolution dropdowns have moved to the command builder ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- The square showing in the A/B window is written out as an ffmpeg command at the bottom of **Compare Quality**, with a button to copy it ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- The loaded file's bar carries a **Reset** button at its right edge — the circular-arrow mark [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader) uses for the same gesture — which clears the file and brings the dropzone back rather than reopening the file picker ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- The whole-file button says which job it is doing: **Reencode and Save** for a source already in MP4, **Transcode and Save** for one in another container ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))
- The sample run on **Reencode with FFmpeg** is one fixed three-second stretch, picked on a track across the whole recording with a frame to scan by, modelled on [clip-extractor](https://github.com/brain-bbqs/clip-extractor)'s timeline ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))

#### 🐛 Bug Fix

- Loading one file after another releases the decoders the previous file held, instead of keeping one per file for the life of the page ([#23](https://github.com/brain-bbqs/encoding-helper/pull/23))

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
