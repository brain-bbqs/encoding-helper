# User Test Checklist

|            |        |
| ---------- | ------ |
| **Tester** | Rahul  |
| **Date**   | 9/3/26 |

A basic manual pass through the app before a release or after a significant change.

## Loading a file

- [x] Loading a sample video from the sample picker works
- [ ] Loading a local video file via the file picker / drag-and-drop works
  - NOTE: didn't have time to check
- [x] The educational toggle is visible and switching it on/off changes what's shown

## Inspect tab

- [x] The atom/box tree renders for a loaded MP4
- [x] Selecting an atom shows its details and jumps to the right spot in the tree
- [x] Table of contents navigation matches the atom tree
  - NOTE: probably no way to fix since window can't push down, but caused some confusion when could not navigate to 'Audio' section when partially in view at bottom
- [x] Educational explainers appear when the educational toggle is on

## Analysis tab

- [x] The bitrate chart renders and reflects the loaded file
- [x] Zoom/pan on the chart works smoothly
- [x] Chroma format, codec, and container details are shown correctly

## Compare tab

- [x] Two files can be loaded side-by-side (A/B panel)
- [x] The quality/size matrix populates correctly
- [x] The savings panel shows a sensible size/quality comparison

## Seek tab

- [x] Running a seek test against a loaded file produces a report
- [x] The segment run / timeline reflects the seek results accurately

## Encode tab

- [x] An in-browser encode (ffmpeg) runs to completion on a sample file
  - [x] the progress indicator updates throughout
- [x] The CLI command preview matches the selected encode settings
- [x] The encoded output can be downloaded/saved

## Demos page

- [x] Demo videos load and play
- [x] The demo archive download works

## Cross-cutting

- [ ] The app remains usable after loading several files in a row (no memory leak or crash)
- [ ] The app is usable in both light and dark OS/browser theme
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no errors in the browser console
- [ ] Can navigate to all hyperlinks in the bottom-left

NOTE: did not have time to test these
