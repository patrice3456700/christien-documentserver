#!/bin/sh
# Cap make parallelism: build_tools hardcodes -j$(cpu_count) (8 on this host).
# Real binary: $MAKE_REAL (default /usr/bin/make). Rewrites any -jN / -j N / --jobs=N to MAKE_MAX_JOBS (default 4). Build env only, no source change.
MAX="${MAKE_MAX_JOBS:-4}"
out=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; case "$a" in [0-9]*) continue;; esac; fi
  case "$a" in
    -j) a="-j$MAX"; skip=1 ;;
    -j[0-9]*|--jobs=*) a="-j$MAX" ;;
  esac
  out="$out '$(printf %s "$a" | sed "s/'/'\\\\''/g")'"
done
eval exec "${MAKE_REAL:-/usr/bin/make}" $out
