<p align="center">
  <img src="src/assets/encoding-helper-icon.svg" alt="Encoding Helper logo" width="120" height="120" />
</p>

# Encoding Helper

**Live:** https://encoding-helper.brain-bbqs.org

A didactic, in-browser video **encoding lab**. Load an MP4 and it inspects the container, teaches you how MP4 storage and H.264 encoding actually work (tied to the numbers in _your_ file), runs empirical seeking tests, and reencodes video directly in the browser, while always producing a copy-paste `ffmpeg` command for local/headless/batch use.

Companion to [Video Info Tool](https://vibes.tlab.sh/video-info-tool/) and [Frame-Accurate Video Player](https://vibes.tlab.sh/video-player/).

## Features

- **Three tabs** - **Inspect** (what the file is: metadata, the atom map, GOP/keyframe structure and the seeking test), **Reencode with FFmpeg** (build a command, try it on sampled seconds, run it over the whole file) and **Compare Quality** (sweep settings as a grid)
- **Inspect** - rich metadata plus a visual MP4 **atom map** (`ftyp`/`moov`/`mdat`/`moof`, byte offsets & sizes, moov-before-mdat "faststart" detection) and per-frame GOP/I-frame/B-frame structure
- **Atom Map** - a section of Inspect: the box tree on its side, left to right across the file, one lane per nesting level, so it stays the same height whether the video runs ten seconds or ten hours. Siblings split their parent's width by how many boxes each subtree holds, so every box is drawn and labelled at once; click any box to zoom into it, and on a file with more boxes than fit, neighbours merge into counted blocks rather than being dropped. Hover or tab to a box for its offset and byte count
- **Bitrate over time** - the video track's rate plotted one window of playback at a time, straight from the sample table (no decoding), against the track average, so you can see where the bits actually went instead of only what they averaged to. Skipped for a file the container declares constant-bitrate and whose frame sizes bear that out, since the plot would be a flat line
- **Identify the codec** - infers the codec family from the container (H.264/AVC, H.265/HEVC, VP8/VP9, AV1, AAC, Opus, FLAC, MP3, AC-3/E-AC-3, PCM) and decodes its embedded profile/level/tier straight out of the RFC 6381 codec string, with a short explainer on what that codec actually is and why you'd (not) choose it
- **Teach** - interactive explanations tied to the loaded file: CRF vs. bitrate, x264 presets, GOP/keyframe interval, I/P/B frames, `yuv420p` chroma subsampling, even-dimension requirements, and the moov-atom/faststart tradeoff
- **Measure** - empirical seeking tests (nearest-keyframe distance per timestamp, decode wall-clock, keyframe-interval histogram) with a scatter plot of distance vs. decode time, plus before/after compression stats
- **Try a setting on a sample (A/B)** - under **Reencode with FFmpeg**, beside the command it builds: encodes one three-second stretch of the video at the settings the command has, picked on a track across the whole recording (modelled on [clip-extractor](https://github.com/brain-bbqs/clip-extractor)'s trim timeline, with the frame under the band decoded above it and the run starting at the keyframe at or before it), then decodes the original and the result side-by-side with synchronized pixel-level zoom & pan, one-click **Fit**/**Actual Size (100%)** buttons, a pixel grid that appears once zoomed in far enough to make individual pixels visible, and a scrub slider, so you can judge a quality setting before committing to a full reencode. It also estimates the data savings: the encoded snippet against what the same seconds cost in the source, that ratio projected onto the whole file, with a range on it.
- **Compare Quality (matrix)** - asks for a stretch length and a **Segments** count, spreads that many stretches across the file (so a projection is not only as representative as wherever a single snippet landed), and encodes them once per combination of quality, preset, resolution and scaler, and lays the results out as a grid of projected size, whole-file projection and encode time, marking the largest reduction ★. Click any square to put it in the A/B window, and read the `ffmpeg` command that reproduces it at the bottom of the page
- **Measured once, kept** - a square's size is a function of the video, the settings and the seconds measured, so a combination this file has already been swept at is read back rather than encoded again, including after a reload: the measurements live in the browser against a checksum of the file (its size and a megabyte from its beginning, middle and end, so a multi-gigabyte recording is identified without being read). Widening a sweep therefore encodes only the squares that are new, and a re-run keeps the stretches the first run sampled, since two squares measured over different seconds are not comparable. Only the numbers are kept, never the video, and **Reuse earlier measurements** in the sweep settings turns it off for a run that should measure everything again
- **Encode the whole file here** - the last section of **Reencode with FFmpeg**: runs the command built above it over the whole video with ffmpeg.wasm and saves the result back to disk via the File System Access API. One engine, so what the browser writes is byte-for-byte what the command writes; it is lazy-loaded (~30 MB), GPL, and single-threaded
- **Downscale the output** - a **Resolution** dropdown (100/75/50/25%, labelled with the size each comes out at) in the command builder, with a **Scaler** beside it (`lanczos` sharper, `bicubic` softer) that appears once something is being resampled. Scaling uses `-2` for the height, so the output keeps its aspect ratio and stays even-dimensioned. Resolution is the largest lever on file size and the one CRF cannot pull, so a downscaled encode is drawn in the A/B window at the source's geometry, switchable between **Blocks** (nearest, exactly the pixels that survived) and **Smooth** (what a player would show). Both are matrix axes too: ticking a second resolution groups the results grid into a block of rows per resolution, ticked to one value each by default so a sweep costs what it always did
- **Always emits a CLI command** - a live, editable `ffmpeg` command mirroring [sleap-io](https://github.com/talmolab/sleap-io)'s `reencode`, for anyone who wants to run it locally, headless, or in batch
- **Full Analysis** - one button beside the tabs bundles everything the tabs worked out into a single document: container and track metadata with the explainer that goes with each number, the bitrate plot, the atom map, GOP/keyframe structure with its histogram, the seeking test with its scatter plot, the A/B comparison, the matrix sweep and in-browser reencode results (once run), and the CLI command. Read it in the page, save it as a self-contained `.html` file (no external assets, so it opens anywhere), print it to PDF, or copy it as Markdown
- **Demo files** - **Browse Demo Files** opens a page of its own (`?demos`) in place of the file picker, listing a couple of dozen short videos that each vary exactly one thing: where the moov atom sits, the container, the codec and profile, the keyframe interval, the B-frame run length, the bitrate ceiling, rotation and frame-rate regularity, the metadata tags. They are grouped by what they vary, filterable, and each one folds open to its description, its technical figures and the `ffmpeg` command that made it, with a button that opens it in the app. The set lives on [EMBER dandiset 000527](https://dandi.emberarchive.org/dandiset/000527/draft) rather than in this repository (a committed video blob would sit in the git history forever); `scripts/generate-demos.sh` builds it and `scripts/upload-demos.sh` publishes it
- **Shareable links** - the active tab lives in the URL (`?tab=encode`), and a link naming one of the tabs that has since become a section opens where that content went, while a video loaded from a remote URL is recorded alongside it (`?src=…`) and re-opened automatically, so a link points a colleague at the same file on the same tab; `?demos` opens the demo-file page directly
- **Light/dark theme** with an OS-preference default and a header toggle, styled after [clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)

## Usage

1. Load a video via drag-and-drop, the file picker, a remote URL, or **Browse Demo Files** (see below)
2. Explore the **Inspect** tab for metadata, the codec explainer, the atom map, and GOP/frame structure
3. Run the **Seeking Test**, at the bottom of that same tab, to measure nearest-keyframe distance and decode latency across the timeline (and see it plotted)
4. Tune CRF, preset, output resolution, keyframe interval, B-frames, faststart, and audio handling in the **Reencode with FFmpeg** tab
5. Run those settings on three seconds from the same tab — slide the track to the stretch worth looking at — and compare the result against the original side-by-side before committing to a full encode
6. Sweep several settings at once in the **Compare Quality** tab, then click the square you want and copy the `ffmpeg` command for it from the bottom of that page
7. Copy the generated `ffmpeg` command to run it natively, or click **Encode and Save** at the bottom of the same tab to transcode the whole video in the page
8. Click **Full Analysis** (to the right of the tabs) for the whole thing as one document: save it as HTML, print it to PDF, or copy it as Markdown

## Dependencies

A TypeScript + [Vite](https://vite.dev) app; the video-handling libraries are ordinary npm dependencies rather than CDN `<script>` tags:

- [mediabunny](https://github.com/Vanilagy/mediabunny) - metadata, packet/GOP analysis, frame seeking, and the decoding behind the A/B window (lazy-loaded via a dynamic `import()` the first time a file is loaded, and bundled into its own chunk)
- [mp4box.js](https://github.com/gpac/mp4box.js) - MP4 atom map and sample table (keyframes/GOP/B-frames); ships no TypeScript types, so a small local `.d.ts` (`src/lib/mp4box.d.ts`) declares the slice this app actually uses
- [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) + [@ffmpeg/util](https://github.com/ffmpegwasm/ffmpeg.wasm) - exact in-browser reencode. As a proper ESM package, Vite bundles and loads its worker itself; the `ffmpeg-core.js`/`.wasm` binaries (~30 MB) are still fetched from the jsdelivr CDN at runtime via `@ffmpeg/util`'s `toBlobURL()`, the officially documented pattern, and only once an "exact" encode actually runs

## Notes

- GitHub Pages serves no custom headers, so only the **single-thread** ffmpeg.wasm core is used (no COOP/COEP, no `coi-serviceworker`) - this keeps the tool a single self-contained page at the cost of some encode speed
- Every encode the app runs goes through ffmpeg, in the browser as on the command line, so what you judge in the page is what the command produces: there is no WebCodecs path to approximate a CRF the browser's encoder cannot be told about
- ffmpeg.wasm is GPL-licensed and lazy-loaded on demand; credited in the dependency list above and at the point of use, where it names the engine

## Development

```sh
npm install                # install dependencies
npm run dev                # start the Vite dev server
npm run build               # typecheck + production build to dist/
npm test                    # run the unit test suite (vitest)
npm run lint                 # eslint (type-aware, strict)
npm run test:integration      # Playwright integration tests (tests/integration/)
npm run storybook             # component sandbox at http://localhost:6006 (stories/)
```

Source lives under `src/`: `src/lib/` holds pure logic (formatting, the MP4/codec parsers, the CLI-command builder, the ffmpeg.wasm engine), `src/ui/` holds the renderer modules the three tabs are built from, and `src/main.ts` wires it all up to the static skeleton markup in `index.html`. Unit tests for the pure `lib/` modules live under `tests/unit/`; Playwright integration tests live under `tests/integration/`. Component snapshots are driven by [Storybook](stories/) and [Chromatic](https://www.chromatic.com/) (both a Storybook build and a dedicated Playwright suite under `tests/chromatic/`), which visually regression-test the UI on every push.

## Initial prompt

> New vibe: encoding-helper — didactic in-browser video encoding lab (inspect, teach, seek-test, reencode). See [GitHub issue #66](https://github.com/talmolab/vibes/issues/66) for the full spec, motivated by the BBQS Day 3 working session on video → behavioral annotation pipelines (Acquisition and QC tracks), with sleap-io's `reencode` as the shared transcoding baseline this tool makes legible.
