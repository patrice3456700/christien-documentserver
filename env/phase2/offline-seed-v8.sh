#!/bin/sh
# Unpack the frozen v8 8.9 tree (gclient-synced sources + toolchain, no build output) into the fresh workspace (no network).
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}
D=${D:-$R}
exec docker run --rm --network none -v ${WS:-$D/ws}:/ws -v $D/mirror/trees:/trees:ro ${IMG_UNPACK:-christien-unpack:1} \
  sh -c 'tar -I zstd -xf /trees/v8_89-synced.tar.zst -C /ws/core/Common/3dParty && echo SEED_OK'
