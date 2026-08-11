<p align="center">
  <img src="src/assets/encoding-helper-icon.svg" alt="Encoding Helper logo" width="120" height="120" />
</p>

# Encoding Helper

**Live:** https://encoding-helper.brain-bbqs.org

A didactic, in-browser video **encoding lab**. Load an MP4 and it inspects the container, teaches you how MP4 storage and H.264 encoding actually work (tied to the numbers in _your_ file), runs empirical seeking tests, and reencodes video directly in the browser, while always producing a copy-paste `ffmpeg` command for local/headless/batch use.

Companion to [Video Info Tool](https://vibes.tlab.sh/video-info-tool/) and [Frame-Accurate Video Player](https://vibes.tlab.sh/video-player/).

## Features

- **Inspect** - rich metadata plus a visual MP4 **atom map** (`ftyp`/`moov`/`mdat`/`moof`, byte offsets & sizes, moov-before-mdat "faststart" detection) and per-frame GOP/I-frame/B-frame structure
- **Atom Map, three ways** - two horizontal views run left to right with one lane per nesting level, so they stay the same height whether the video runs ten seconds or ten hours: **Structure** gives every box room (siblings split their parent's width by subtree size) so the whole file is on screen at once, and **Bytes** draws each box across the bytes it occupies, which is where a 99%-`mdat` file or a moov-before-mdat faststart layout shows up. Both zoom on click, and boxes too small to draw are merged into counted blocks rather than dropped. **Tree** is the indented list with every offset and size spelled out. The choice is remembered
- **Identify the codec** - infers the codec family from the container (H.264/AVC, H.265/HEVC, VP8/VP9, AV1, AAC, Opus, FLAC, MP3, AC-3/E-AC-3, PCM) and decodes its embedded profile/level/tier straight out of the RFC 6381 codec string, with a short explainer on what that codec actually is and why you'd (not) choose it
- **Teach** - interactive explanations tied to the loaded file: CRF vs. bitrate, x264 presets, GOP/keyframe interval, I/P/B frames, `yuv420p` chroma subsampling, even-dimension requirements, and the moov-atom/faststart tradeoff
- **Measure** - empirical seeking tests (nearest-keyframe distance per timestamp, decode wall-clock, keyframe-interval histogram) with a scatter plot of distance vs. decode time, plus before/after compression stats
- **Reencode In-Browser** - encodes the whole video to H.264/MP4 in its own tab, saved back to disk via the File System Access API, with two engines:
  - **ffmpeg.wasm (exact)** - runs the literal CRF/preset command, byte-for-byte equivalent to the CLI, lazy-loaded (~30 MB), GPL
  - **mediabunny / WebCodecs (fast)** - hardware-accelerated, no CRF (bitrate/quality-preset only), surfaced honestly as an approximation
- **Compare Quality (A/B)** - encodes just a short window (1-10s) of the video at the chosen CRF/preset, then decodes the original and the result side-by-side with synchronized pixel-level zoom & pan, one-click **Fit**/**Actual Size (100%)** buttons, a pixel grid that appears once zoomed in far enough to make individual pixels visible, and a scrub slider, so you can judge a quality setting before committing to a full reencode
- **Always emits a CLI command** - a live, editable `ffmpeg` command mirroring [sleap-io](https://github.com/talmolab/sleap-io)'s `reencode`, for anyone who wants to run it locally, headless, or in batch
- **Report / Export** - compiles metadata, the codec explainer, the atom map, GOP/keyframe stats, the seeking test and Compare Quality results (if run), and the CLI command into one report: copy as Markdown, download a `.md` file, or print to PDF via the browser's native print dialog
- **Shareable links** - the active tab lives in the URL (`?tab=seek`), and a video loaded from a remote URL is recorded alongside it (`?src=…`) and re-opened automatically, so a link points a colleague at the same file on the same tab
- **Light/dark theme** with an OS-preference default and a header toggle, styled after [clip-extractor](https://github.com/brain-bbqs/clip-extractor) and [bbqs-uploader](https://github.com/brain-bbqs/bbqs-uploader)

## Usage

1. Load a video via drag-and-drop, the file picker, or **Load Sample** (bundled `mice.mp4`)
2. Explore the **Inspect** tab for metadata, the codec explainer, the atom map, and GOP/frame structure
3. Run the **Seeking Test** to measure nearest-keyframe distance and decode latency across the timeline (and see it plotted)
4. Tune CRF, preset, keyframe interval, B-frames, faststart, and audio handling in the **Reencode & CLI** tab
5. Copy the generated `ffmpeg` command, or head to the **Reencode In-Browser** tab and click **Encode (exact)** / **Encode (fast)** to transcode the whole video in the page and save the result
6. Try different CRF/preset values on a short clip in the **Compare Quality** tab and compare against the original side-by-side before running the full encode
7. Head to the **Report** tab to copy/download a Markdown summary of everything above, or print it to PDF

## Dependencies

A TypeScript + [Vite](https://vite.dev) app; the video-handling libraries are ordinary npm dependencies rather than CDN `<script>` tags:

- [mediabunny](https://github.com/Vanilagy/mediabunny) - metadata, packet/GOP analysis, frame seeking, WebCodecs-based fast reencode (lazy-loaded via a dynamic `import()` the first time a file is loaded, and bundled into its own chunk)
- [mp4box.js](https://github.com/gpac/mp4box.js) - MP4 atom map and sample table (keyframes/GOP/B-frames); ships no TypeScript types, so a small local `.d.ts` (`src/lib/mp4box.d.ts`) declares the slice this app actually uses
- [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) + [@ffmpeg/util](https://github.com/ffmpegwasm/ffmpeg.wasm) - exact in-browser reencode. As a proper ESM package, Vite bundles and loads its worker itself; the `ffmpeg-core.js`/`.wasm` binaries (~30 MB) are still fetched from the jsdelivr CDN at runtime via `@ffmpeg/util`'s `toBlobURL()`, the officially documented pattern, and only once an "exact" encode actually runs

## Notes

- GitHub Pages serves no custom headers, so only the **single-thread** ffmpeg.wasm core is used (no COOP/COEP, no `coi-serviceworker`) - this keeps the tool a single self-contained page at the cost of some encode speed
- WebCodecs exposes no CRF control, only target bitrate/quality presets - the "fast" engine cannot byte-match the CLI command, and the UI says so
- Firefox's H.264 WebCodecs _encoder_ support is weak; the fast engine feature-detects and falls back to ffmpeg.wasm/CLI-only
- ffmpeg.wasm is GPL-licensed and lazy-loaded on demand; credited in the dependency list above and in the Reencode tab, which names the engine at the point of use

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

Source lives under `src/`: `src/lib/` holds pure logic (formatting, the MP4/codec parsers, the CLI-command builder, the ffmpeg.wasm/mediabunny encode engines), `src/ui/` holds one renderer module per tab, and `src/main.ts` wires it all up to the static skeleton markup in `index.html`. Unit tests for the pure `lib/` modules live under `tests/unit/`; Playwright integration tests live under `tests/integration/`. Component snapshots are driven by [Storybook](stories/) and [Chromatic](https://www.chromatic.com/) (both a Storybook build and a dedicated Playwright suite under `tests/chromatic/`), which visually regression-test the UI on every push.

## Initial prompt

> New vibe: encoding-helper — didactic in-browser video encoding lab (inspect, teach, seek-test, reencode). See [GitHub issue #66](https://github.com/talmolab/vibes/issues/66) for the full spec, motivated by the BBQS Day 3 working session on video → behavioral annotation pipelines (Acquisition and QC tracks), with sleap-io's `reencode` as the shared transcoding baseline this tool makes legible.
