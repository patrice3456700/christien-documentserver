#!/bin/sh
# Build bare mirrors under /mirror/git/<host>/<path>.git from the git dirs consumed in phase 1 (inventory TSV on stdin).
# Branches of origin -> refs/heads, tags -> refs/tags, the consumed HEAD -> refs/pin/<sha>.
set -u
git config --global --add safe.directory '*'
while IFS="$(printf '\t')" read gd url head shallow; do
  [ -n "$url" ] || { echo "SKIP no-origin $gd"; continue; }
  rel=$(echo "$url" | sed -E 's#^https?://##; s#\.git$##').git
  dst=/mirror/git/$rel
  if [ ! -d "$dst" ]; then
    git init -q --bare "$dst"
    git -C "$dst" config uploadpack.allowAnySHA1InWant true
    git -C "$dst" config http.uploadpack true
  fi
  git -C "$dst" fetch -q --no-write-fetch-head "$gd" \
      '+refs/remotes/origin/*:refs/heads/*' '+refs/tags/*:refs/tags/*' 2>/dev/null
  git -C "$dst" fetch -q --no-write-fetch-head "$gd" "+$head:refs/pin/$head" || echo "FAIL pin $url $head"
  git -C "$dst" symbolic-ref HEAD >/dev/null 2>&1
  git -C "$dst" rev-parse -q --verify refs/heads/master >/dev/null || \
    { git -C "$dst" rev-parse -q --verify refs/heads/main >/dev/null && git -C "$dst" symbolic-ref HEAD refs/heads/main; } || \
    git -C "$dst" update-ref refs/heads/master "$head"
  echo "OK $rel $head shallow=$shallow"
done
for r in $(find /mirror/git -name '*.git' -type d -prune); do git -C "$r" update-server-info; done
