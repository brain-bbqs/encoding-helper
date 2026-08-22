#!/usr/bin/env bash
#
# Upload a directory of Inspect-tab demo files (see generate-inspect-demos.sh)
# to a dandiset on an EMBER/DANDI archive, using the dandi CLI.
#
# The dandi CLI wants files laid out inside a local dandiset directory (the
# dandiset.yaml next to them names the target), so this script downloads the
# dandiset's metadata record, copies the demo files under the given asset-path
# prefix, and uploads from there. Validation is skipped: these are plain
# videos, not NWB/BIDS.
#
# Usage: scripts/upload-inspect-demos.sh [options]
#   -o DIR       directory holding the demo files (default: demo-out)
#   -d ID        dandiset ID (default: 000527)
#   -i INSTANCE  DANDI instance, as a name the CLI knows or a URL
#                (default: ember-dandi, the EMBER archive)
#   -p PREFIX    asset path prefix inside the dandiset (default: inspect-demos)
#   -n           dry run: lay everything out and stop before uploading
#
# Requires the dandi CLI (pip install dandi) and DANDI_API_KEY in the
# environment, holding an API key for the target instance.

set -euo pipefail

DEMODIR="demo-out"
DANDISET="000527"
INSTANCE="ember-dandi"
PREFIX="inspect-demos"
DRY_RUN=0

while getopts "o:d:i:p:nh" opt; do
  case $opt in
    o) DEMODIR=$OPTARG ;;
    d) DANDISET=$OPTARG ;;
    i) INSTANCE=$OPTARG ;;
    p) PREFIX=$OPTARG ;;
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
[ -d "$DEMODIR" ] || {
  echo "error: demo directory not found: $DEMODIR (run generate-inspect-demos.sh first)" >&2
  exit 1
}
if [ "$DRY_RUN" = 0 ] && [ -z "${DANDI_API_KEY:-}" ]; then
  echo "error: DANDI_API_KEY is not set" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The instance may be a name or a URL; dandi download only takes URLs, so build
# one for the dandiset landing page when a URL was given, and fall back to the
# dandi:// form for a named instance.
case $INSTANCE in
  http*) DANDISET_URL="${INSTANCE%/}/dandiset/$DANDISET/draft" ;;
  *) DANDISET_URL="dandi://$INSTANCE/$DANDISET/draft" ;;
esac

echo "==> Fetching dandiset record: $DANDISET_URL"
dandi download --output-dir "$WORK" --download dandiset.yaml "$DANDISET_URL"

DEST="$WORK/$DANDISET/$PREFIX"
mkdir -p "$DEST"
cp -v "$DEMODIR"/* "$DEST/"

echo
echo "==> Layout to upload:"
find "$WORK/$DANDISET" -type f | sort

if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "Dry run: stopping before upload."
  exit 0
fi

echo
echo "==> Uploading to $INSTANCE, dandiset $DANDISET, under $PREFIX/"
cd "$WORK/$DANDISET"
dandi upload --dandi-instance "$INSTANCE" --validation skip --existing overwrite
echo "Done."
