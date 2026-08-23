#!/usr/bin/env bash
#
# Upload the generated demo set (see generate-demos.sh) to EMBER dandiset
# 000527, using the dandi CLI. The target dandiset and instance are fixed;
# the demo directory already holds the BEP047-style sub-01/ tree, which is
# copied into the dandiset as-is.
#
# The dandi CLI wants files laid out inside a local dandiset directory (the
# dandiset.yaml next to them names the target), so this script downloads the
# dandiset's metadata record, copies the demo tree beside it, and uploads from
# there. Validation is skipped: these are plain videos, not NWB/BIDS.
#
# Usage: scripts/upload-demos.sh [-o demo-dir] [-n]
#   -o DIR  directory holding the generated demo tree (default: demo-out)
#   -n      dry run: lay everything out and stop before uploading
#
# Requires the dandi CLI (pip install dandi) and DANDI_API_KEY in the
# environment, holding an API key for the EMBER archive.

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
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) exit 2 ;;
  esac
done

command -v dandi >/dev/null 2>&1 || {
  echo "error: the dandi CLI is required (pip install dandi)" >&2
  exit 1
}
[ -d "$DEMODIR/sub-01" ] || {
  echo "error: no sub-01/ tree under $DEMODIR (run generate-demos.sh first)" >&2
  exit 1
}
if [ "$DRY_RUN" = 0 ] && [ -z "${DANDI_API_KEY:-}" ]; then
  echo "error: DANDI_API_KEY is not set" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "==> Fetching dandiset record: dandi://$INSTANCE/$DANDISET/draft"
dandi download --output-dir "$WORK" --download dandiset.yaml "dandi://$INSTANCE/$DANDISET/draft"

cp -R "$DEMODIR/sub-01" "$WORK/$DANDISET/"

echo
echo "==> Layout to upload:"
find "$WORK/$DANDISET" -type f | sort

if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "Dry run: stopping before upload."
  exit 0
fi

echo
echo "==> Uploading to $INSTANCE, dandiset $DANDISET"
cd "$WORK/$DANDISET"
dandi upload --dandi-instance "$INSTANCE" --validation skip --existing overwrite
echo "Done."
