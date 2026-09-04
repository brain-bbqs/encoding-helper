# User Test Checklist

|            |              |
| ---------- | ------------ |
| **Tester** | Erik Johnson |
| **Date**   | 9/4/26       |

A basic manual pass through the app before a release or after a significant change.

## Loading a file

- [ ] Loading a sample video from the sample picker works
- [ ] Loading a local video file via the file picker / drag-and-drop works
- [ ] The educational toggle is visible and switching it on/off changes what's shown

## Inspect tab

- [ ] The atom/box tree renders for a loaded MP4
- [ ] Selecting an atom shows its details and jumps to the right spot in the tree
- [ ] Table of contents navigation matches the atom tree
- [ ] Educational explainers appear when the educational toggle is on

## Analysis tab

- [ ] The bitrate chart renders and reflects the loaded file
- [ ] Zoom/pan on the chart works smoothly
- [ ] Chroma format, codec, and container details are shown correctly

## Compare tab

- [ ] Two files can be loaded side-by-side (A/B panel)
- [ ] The quality/size matrix populates correctly
- [ ] The savings panel shows a sensible size/quality comparison

## Seek tab

- [ ] Running a seek test against a loaded file produces a report
- [ ] The segment run / timeline reflects the seek results accurately

## Encode tab

- [ ] An in-browser encode (ffmpeg) runs to completion on a sample file
  - [ ] the progress indicator updates throughout
- [ ] The CLI command preview matches the selected encode settings
- [ ] The encoded output can be downloaded/saved

## Demos page

- [ ] Demo videos load and play
- [ ] The demo archive download works

## Cross-cutting

- [ ] The app remains usable after loading several files in a row (no memory leak or crash)
- [ ] The app is usable in both light and dark OS/browser theme
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no errors in the browser console
- [ ] Can navigate to all hyperlinks in the bottom-left

# Extra notes

Scrolling into the playback window for reencoding page caused video zoom havoc; perhaps make it zoom through scroll only when enabled?
