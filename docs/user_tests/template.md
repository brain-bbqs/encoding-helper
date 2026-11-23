# User Test Checklist

|            |         |
| ---------- | ------- |
| **Tester** | <enter> |
| **Date**   | <enter> |

A basic manual pass through the app before a release or after a significant change.

## Loading a file

- [ ] Choose File opens the file picker and loads the chosen video
- [ ] Dropping a video file on the drop zone loads it
- [ ] Load from URL loads a video from a pasted link
- [ ] The Educational switch is visible and switching it on/off changes what's shown

## Inspect tab

- [ ] The overview, Video Track and (for a file with sound) Audio Track cards show the codec, chroma format and container details correctly
- [ ] The atom map renders for a loaded MP4; hovering a block shows its details, and clicking one zooms into it
- [ ] The "On this page" contents list links to each section of the tab
- [ ] The bitrate chart renders and reflects the loaded file
- [ ] Running the seeking test in the GOP / Keyframe Structure card produces a scatter plot and a results table
- [ ] Educational explainers appear when the Educational switch is on

## Reencode with FFmpeg tab

- [ ] The FFmpeg Command Builder's command matches the selected settings, and its copy button copies it
- [ ] Run Comparison under Try It on a Sample runs to completion
  - [ ] the progress indicator updates throughout
  - [ ] the A/B window then shows the encode against the same seconds of the original, with zoom and pan
- [ ] Reencode and Save (Transcode and Save for a non-MP4 file) encodes the whole file and saves the output

## Compare Quality tab

- [ ] Run Matrix fills the grid for the ticked settings
  - [ ] the progress indicator updates throughout
- [ ] Clicking a square shows that encode against the original in the A/B window
- [ ] The A/B window's savings figures show a sensible size comparison

## Full Analysis

- [ ] The Full Analysis button shows one document gathering what the tabs found
- [ ] The bitrate chart and the codec and container details in the document match the Inspect tab
- [ ] Save as PDF, Download HTML, Download Markdown and Copy Markdown each work

## Demos page

- [ ] Browse Demo Files opens the demos page, and pressing a tile opens that demo's card
- [ ] Open in the app loads the demo into the app
- [ ] Download saves the demo file

## Cross-cutting

- [ ] The app remains usable after loading several files in a row (no memory leak or crash)
- [ ] The app is usable in both light and dark OS/browser theme
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no errors in the browser console
- [ ] Can navigate to all hyperlinks in the bottom-left

## Extra notes
