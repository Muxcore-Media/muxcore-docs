#!/usr/bin/env bash
# Sync muxcore-docs/wiki (working copy) into a core.wiki checkout.
# Usage: scripts/sync-core-wiki.sh [--check] <core.wiki path>
#   (default)  make <core.wiki path> match wiki/ (copies, deletes pages not in wiki/; .git untouched)
#   --check    exit 1 if the trees differ; changes nothing
set -euo pipefail

check=0
if [[ "${1:-}" == "--check" ]]; then check=1; shift; fi
if [[ $# -ne 1 ]]; then
  echo "usage: $0 [--check] <core.wiki path>" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/wiki"
dest="$1"

[[ -f "$src/Home.md" ]] || { echo "missing $src/Home.md" >&2; exit 2; }
[[ -d "$dest" ]] || { echo "missing destination: $dest" >&2; exit 2; }

if (( check )); then
  if diff -r --exclude=.git "$dest" "$src"; then
    echo "core.wiki is in sync with muxcore-docs/wiki"
  else
    echo "DRIFT: run scripts/sync-core-wiki.sh $dest" >&2
    exit 1
  fi
else
  rsync -a --delete --exclude=.git "$src/" "$dest/"
  echo "synced $src -> $dest (review with: git -C $dest status)"
fi
