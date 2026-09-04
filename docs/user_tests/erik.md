# User Test Checklist

|            |              |
| ---------- | ------------ |
| **Tester** | Erik Johnson |
| **Date**   | 9/4/26       |

A basic manual pass through the app before a release or after a significant change.

## Loading a file

- [x] Loading a sample video from the sample picker works
- [x] Loading a local video file via the file picker / drag-and-drop works
- [x] The educational toggle is visible and switching it on/off changes what's shown

## Inspect tab

- [x] The atom/box tree renders for a loaded MP4
- [x] Selecting an atom shows its details and jumps to the right spot in the tree
- [x] Table of contents navigation matches the atom tree
- [x] Educational explainers appear when the educational toggle is on

## Analysis tab

- [x] The bitrate chart renders and reflects the loaded file
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

- [x] The app remains usable after loading several files in a row (no memory leak or crash)
- [x] The app is usable in both light and dark OS/browser theme
- [x] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [x] Loading the page shows no errors in the browser console
- [x] Can navigate to all hyperlinks in the bottom-left

## Extra notes

Scrolling into the playback window for reencoding page caused video zoom havoc; perhaps make it zoom through scroll only when enabled? [on hover delay (3s) or on click to activate]

Dev console errors:

```
index-JK8hMqWJ.js:298 [encoding-helper] showSaveFilePicker failed, falling back to download: SecurityError: Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.
    at gr (index-JK8hMqWJ.js:298:5443)
    at oc (index-JK8hMqWJ.js:300:35195)
```

```
gr @ index-JK8hMqWJ.js:298
/?edu=0&tab=analysis:1 Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received
```
