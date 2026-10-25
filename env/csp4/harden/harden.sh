#!/bin/sh
# csp4 hardening of a build output (web-apps + sdkjs), before minify. Runs in the node22 builder image:
#   docker run --rm --network none -e NODE_PATH=/nm -v <out>:/o -v <web-apps>/build/node_modules:/nm:ro \
#     -v env/csp4/harden:/h:ro <img> sh /h/harden.sh /o <underscore source>
# 1. templates.js  underscore templates precompiled, no new Function        -> no 'unsafe-eval'
# 2. pages.js      csp-shim.js first in every editor page, static style= renamed -> no 'unsafe-inline' (styles)
# 3. code.js       remaining eval() of web-apps replaced, plugins cut at build time
# 4. sdkjs.js      asm.js engines instead of wasm                             -> no 'wasm-unsafe-eval'
# SKIP_CODE=1 skips 3 (prototype on an already minified output, where its exact edits cannot match).
set -e
O=$1; USRC=$2
cp "$USRC" $O/web-apps/vendor/underscore/underscore.js
echo "templates $(node /h/templates.js $O/web-apps /h/templates-recorded.json)"
echo "pages $(node /h/pages.js $O/web-apps /h/csp-shim.js)"
[ "${SKIP_CODE:-}" = 1 ] || echo "code $(node /h/code.js $O/web-apps)"
echo "sdkjs $(node /h/sdkjs.js $O/sdkjs)"
echo HARDEN_OK
