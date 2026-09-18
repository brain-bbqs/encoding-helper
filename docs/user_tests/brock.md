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

consider interactions with EMBER

attempt to create a pre-flight check for laod from URL (attempting to load 1 GB files stalled out but that was because it was an AVI from Mang's)
