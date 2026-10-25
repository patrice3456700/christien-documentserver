#!/bin/sh
# List every git repository (work trees and submodule gitdirs) under /ws, except v8 internals (frozen as a tree).
# Output TSV: path  origin  HEAD  shallow(0/1)
git config --global --add safe.directory '*'
find /ws -path /ws/core/Common/3dParty/v8_89 -prune -o \( -name .git -o -path '*/.git/modules/*' -name HEAD \) -print 2>/dev/null |
while read p; do
  case "$p" in
    */.git) gd=$(git -C "$(dirname "$p")" rev-parse --absolute-git-dir 2>/dev/null) ;;
    *) gd=$(dirname "$p"); [ -f "$gd/config" ] || continue ;;
  esac
  [ -n "$gd" ] || continue
  url=$(git --git-dir="$gd" config --get remote.origin.url)
  head=$(git --git-dir="$gd" rev-parse HEAD 2>/dev/null)
  sh=0; [ -f "$gd/shallow" ] && sh=1
  printf '%s\t%s\t%s\t%s\n' "$gd" "$url" "$head" "$sh"
done | sort -u
