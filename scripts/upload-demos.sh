#!/usr/bin/env bash
#
# Upload the generated demo set (see generate-demos.sh) to EMBER dandiset
# 000527, using the dandi CLI. The target dandiset and instance are fixed;
# the demo directory already holds the BEP047 dataset (the sub-01/ session
# tree, the source recording among it as ses-original, and
# dataset_description.json), which is copied into the dandiset as-is.
#
# The dandi CLI wants files laid out inside a local dandiset directory, with a
# dandiset.yaml next to them naming the target. Only its identifier is read
# and the file itself is never uploaded, so this script writes that one line
# rather than fetching the full record, copies the demo tree beside it, and
# uploads from there. Validation is skipped: these are plain videos, not
# NWB/BIDS.
#
# Usage: scripts/upload-demos.sh [-o demo-dir] [-n]
#   -o DIR  directory holding the generated demo tree (default: demo-out)
#   -n      dry run: lay everything out and stop before uploading
#
# Requires the dandi CLI (pip install dandi) and EMBER_DANDI_API_KEY in the
# environment, holding an API key for the EMBER archive: the dandi CLI reads
# the key for a given instance from {INSTANCE_NAME}_API_KEY.

set -euo pipefail

DANDISET="000527"
INSTANCE="ember-dandi" # the EMBER archive, as the dandi CLI knows it
DEMODIR="demo-out"
DRY_RUN=0

while getopts "o:nh" opt; do
  case $opt in
    o) DEMODIR=$OPTARG ;;
    n) DRY_RUN=1 ;;
    h)
      sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) exit 2 ;;
  esac
done

command -v dandi >/dev/null 2>&1 || {
  echo "error: the dandi CLI is required (pip install dandi)" >&2
  exit 1
}
if [ ! -d "$DEMODIR/sub-01" ] || [ ! -f "$DEMODIR/dataset_description.json" ]; then
  echo "error: $DEMODIR does not hold a generated dataset (run generate-demos.sh first)" >&2
  exit 1
fi
if [ "$DRY_RUN" = 0 ] && [ -z "${EMBER_DANDI_API_KEY:-}" ]; then
  echo "error: EMBER_DANDI_API_KEY is not set" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

DEST="$WORK/$DANDISET"
mkdir -p "$DEST"
printf "identifier: '%s'\n" "$DANDISET" >"$DEST/dandiset.yaml"
cp "$DEMODIR/dataset_description.json" "$DEST/"
# ses-original among them is the source recording, so the archived copy stays
# the one the generator reads when no local one exists.
cp -R "$DEMODIR/sub-01" "$DEST/"

echo
echo "==> Layout to upload:"
find "$DEST" -type f | sort

if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "Dry run: stopping before upload."
  exit 0
fi

echo
echo "==> Uploading to $INSTANCE, dandiset $DANDISET"
cd "$DEST"
# --allow-any-path: dandi only considers extensions it recognizes as assets,
# which excludes the .webm demos and manifest.json. The flag is gated behind
# DANDI_DEVEL.
DANDI_DEVEL=1 dandi upload --dandi-instance "$INSTANCE" --validation skip \
  --existing overwrite --allow-any-path
echo "Done."
