# User Test Checklist

|            |              |
| ---------- | ------------ |
| **Tester** | Brock Wester |
| **Date**   | 9/9/26       |

A basic manual pass through the app before a release or after a significant change.

## Loading a file

- [ ] Loading a sample video from the sample picker works
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
- [ ] Loading the page shows no errors in the browser console
- [x] Can navigate to all hyperlinks in the bottom-left

## Extra notes

consider some kind of byte range portrayal on mp4 box; caused confusion since user thought it was by 'time'

reduce of hover text on bitrate over time; same for seeking test plot

save icon for export table ;

CRF not defined in tooltip

Intro paragraph to enhance or give context to the reencode parameters ; one, two - word impact per param

Extra note on SLEAP tutorial file Inspect page:

```
Note: this file's btrt box gives 651 kbps as both the track's average and its maximum rate, which read literally would mean a constant bitrate. The sample sizes say otherwise: the windows below run from 377 kbps to 1.08 Mbps. Muxers commonly write the computed average into both fields whatever the encoder was doing (ffmpeg does), so that declaration is not evidence of a constant rate on its own, and the sample table is the measurement that settles it.
```

changed parameters on reencode page was not obvious user had to click rerun to regenerate

triple check if tooltips are the same on matrix page as reeoncode page

from reencoding page, selected particular non-default matrix settings such as 25% resolution and slow preset; wanted that to then be selected on the matrix page

standardize play button icon for matrix page; caused confusion

full table of text for seeking values in full analysis pdf

include full grid in 'full analysis'

try to embed interactive svg in pdf

"Start here" rename to "Basic Examples" ; add a description of what the browse demos page to explain the narrative purpose ; description of each theme

Replace video reset icon with 'choose another video'

keep 'open in app' button clamped to be more visually obvious; viewer window is for 'selecting scenario'

dev console:

```
(from Encoding Helper load from URL):
===
Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.
index-B1KALnla.js:298 [encoding-helper] playback stopped: InputDisposedError: Input has been disposed.
    at Object.next (mediabunny-DzughvAZ.js:1:373460)
    at async Qc.getSample (mediabunny-DzughvAZ.js:1:385328)
    at async $c.getCanvas (mediabunny-DzughvAZ.js:1:388427)
    at async Promise.all (index 1)
    at async le (index-B1KALnla.js:298:27111)
    at async he (index-B1KALnla.js:298:27881)
he @ index-B1KALnla.js:298
index-B1KALnla.js:298 [encoding-helper] showSaveFilePicker failed, falling back to download: SecurityError: Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.
    at gr (index-B1KALnla.js:298:5443)
    at oc (index-B1KALnla.js:300:35195)
gr @ index-B1KALnla.js:298
ember-open-data.s3.amazonaws.com/blobs/053/1ff/0531ff75-2f61-4588-91e5-db8b8d231a9b?response-content-disposition=attachment%3B%20filename%3D%22sub-01_ses-h264high444_video.mp4%22&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAXKPUZQVWM2URG4F2%2F20260918%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260918T150805Z&X-Amz-Expires=21600&X-Amz-SignedHeaders=host&X-Amz-Signature=3b9fc3e62f5ca952eb72e169e103ec338c0245c700ed95c856e2e68d4e12d548:1  Failed to load resource: the server responded with a status of 403 (Forbidden)
index-B1KALnla.js:300 [encoding-helper] load failed: Error: mp4box could not parse this file (moov box not found or incomplete)
    at jn (index-B1KALnla.js:298:983)
    at async pl (index-B1KALnla.js:300:56375)
pl @ index-B1KALnla.js:300
```

consider interactions with EMBER

attempt to create a pre-flight check for load from URL (attempting to load 1 GB files stalled out but that was because it was an AVI from Mang's)
