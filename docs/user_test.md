# User Test Checklist

A basic manual checklist for exercising Encoding Helper end-to-end before a release. Run through this in a real browser (not just automated tests) against `npm run dev` or a deployed build.

## Setup

- [ ] App loads with no console errors
- [ ] Educational toggle is visible and can be switched on/off

## File Loading

- [ ] Load a sample video from the sample picker
- [ ] Load a local video file via file picker / drag-and-drop
- [ ] Load a video via URL (if supported)
- [ ] Loading an unsupported or corrupt file shows a clear error instead of a silent failure

## Inspect Tab

- [ ] Atom/box tree renders for a loaded MP4
- [ ] Selecting an atom shows its details and jumps to the right spot in the tree
- [ ] Table of contents navigation matches the atom tree
- [ ] Educational explainers appear when the educational toggle is on

## Analysis Tab

- [ ] Bitrate chart renders and reflects the loaded file
- [ ] Zoom/pan on the chart works smoothly
- [ ] Chroma format, codec, and container details are shown correctly

## Compare Tab

- [ ] Two files can be loaded side-by-side (A/B panel)
- [ ] Quality/size matrix populates correctly
- [ ] Savings panel shows a sensible size/quality comparison

## Seek Tab

- [ ] Seek test runs against a loaded file and produces a report
- [ ] Segment run / timeline reflects seek results accurately

## Encode Tab

- [ ] In-browser encode (ffmpeg) runs to completion on a sample file
- [ ] CLI command preview matches the selected encode settings
- [ ] Encoded output can be downloaded/saved
- [ ] Progress indicator updates during a long-running encode

## Demos Page

- [ ] Demo videos load and play
- [ ] Demo archive download works

## Cross-cutting

- [ ] App remains usable after loading several files in a row (no memory leak / crash)
- [ ] Works in at least two browsers (e.g. Chrome and Firefox)
- [ ] Responsive layout holds up at a narrower window width
