#!/usr/bin/env bash
#
# Purge the retired sample video, mice.mp4, from this repository's git history.
#
# The app used to ship a 2.1 MB sample file and load it from the "Load Sample" button. It has been
# replaced by the demo set on the EMBER archive (scripts/generate-demos.sh, src/lib/demoArchive.ts),
# and the file itself is deleted from the working tree by the same change. Deleting it does not
# remove it from history: the blob stays reachable from every commit since it was added, so every
# clone keeps paying for it forever. That is the whole reason the demo set is published to an
# archive rather than committed, and it is only worth saying if the original goes too.
#
# THIS REWRITES EVERY COMMIT FROM THE ONE THAT ADDED THE FILE ONWARDS. New commit hashes mean every
# existing clone, every unmerged branch and every open pull request is invalidated. So it is
# deliberately not something a pull request can do — someone with force-push rights on the default
# branch has to run it once, with the rest of the work merged or parked first, and everyone else
# re-clones afterwards.
#
# Usage: scripts/purge-sample-blob.sh [-r remote] [-w workdir] [-f]
#   -r  repository to rewrite (default: this checkout's `origin` URL)
#   -w  directory to make the mirror clone in (default: a fresh temporary one)
#   -f  actually force-push the rewritten history; without it the script stops just before,
#       leaving the rewritten mirror in place to inspect
#
# Requires git-filter-repo (https://github.com/newren/git-filter-repo, `pip install git-filter-repo`
# or `brew install git-filter-repo`), which is the tool git itself points at for this.
#
# Afterwards:
#   * every collaborator re-clones (a pull onto the old history will resurrect it);
#   * open pull requests are reopened against the rewritten branch;
#   * the blob stays reachable on GitHub through cached views and pull-request refs until GitHub's
#     own garbage collection runs, which GitHub Support can be asked to do.

set -euo pipefail

# The same blob has lived at two paths: mice.mp4 in the original static-HTML page, then
# public/mice.mp4 from the Vite refactor onwards. Purging only the later one leaves it reachable
# from the early commits, so both go.
TARGET_PATHS=(mice.mp4 public/mice.mp4)
TARGET_NAME="mice.mp4"
REMOTE=""
WORKDIR=""
DO_PUSH=0

while getopts "r:w:fh" opt; do
  case $opt in
    r) REMOTE=$OPTARG ;;
    w) WORKDIR=$OPTARG ;;
    f) DO_PUSH=1 ;;
    h)
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) exit 2 ;;
  esac
done

command -v git-filter-repo >/dev/null 2>&1 || git filter-repo --help >/dev/null 2>&1 || {
  echo "error: git-filter-repo is required (pip install git-filter-repo)" >&2
  exit 1
}

if [ -z "$REMOTE" ]; then
  REMOTE=$(git remote get-url origin) || {
    echo "error: no -r given and this checkout has no origin remote" >&2
    exit 1
  }
fi

if [ -z "$WORKDIR" ]; then
  WORKDIR=$(mktemp -d)
  echo "==> Working in $WORKDIR"
fi
MIRROR="$WORKDIR/encoding-helper.git"

echo "==> Mirror-cloning $REMOTE"
rm -rf "$MIRROR"
git clone --mirror "$REMOTE" "$MIRROR"

# Mirroring an ordinary working clone rather than the canonical repository brings its
# refs/remotes/* along, and those keep pointing at the pre-rewrite commits — which would leave the
# blob reachable after the filter and push stale branches back. A mirror of the real remote has
# none of them, so dropping them costs nothing and makes both cases behave the same.
git -C "$MIRROR" for-each-ref --format='%(refname)' refs/remotes |
  while read -r ref; do git -C "$MIRROR" update-ref -d "$ref"; done

before=$(git -C "$MIRROR" count-objects -vH | sed -n 's/^size-pack: //p')

echo "==> Rewriting history without ${TARGET_PATHS[*]}"
# --invert-paths keeps everything except the named paths. filter-repo drops the remote it cloned
# from as a safety measure, which is why the push below names the URL again.
path_args=()
for path in "${TARGET_PATHS[@]}"; do path_args+=(--path "$path"); done
git -C "$MIRROR" filter-repo --force --invert-paths "${path_args[@]}"

# Every object reachable from every ref, listed with a path it is known by. Matched on the file
# name rather than either full path, so a copy at a third path this script does not know about is
# caught rather than quietly left behind.
if git -C "$MIRROR" rev-list --all --objects | grep -qF "$TARGET_NAME"; then
  echo "error: $TARGET_NAME is still reachable in the rewritten history; not pushing" >&2
  git -C "$MIRROR" rev-list --all --objects | grep -F "$TARGET_NAME" >&2
  exit 1
fi

git -C "$MIRROR" reflog expire --expire=now --all
git -C "$MIRROR" gc --prune=now --aggressive
after=$(git -C "$MIRROR" count-objects -vH | sed -n 's/^size-pack: //p')

echo
echo "==> $TARGET_NAME is gone from every commit."
echo "    Packed size before: $before"
echo "    Packed size after:  $after"

if [ "$DO_PUSH" = 0 ]; then
  echo
  echo "Stopping before the push (no -f given). The rewritten mirror is at:"
  echo "  $MIRROR"
  echo "Inspect it, then re-run with -f -w $WORKDIR to push it."
  exit 0
fi

echo
echo "==> Force-pushing every ref back to $REMOTE"
git -C "$MIRROR" push --force --mirror "$REMOTE"
echo "Done. Everyone re-clones from here."
