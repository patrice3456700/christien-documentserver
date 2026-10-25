#!/bin/sh
# Hardening of the editor JS (no 'unsafe-eval', no 'unsafe-inline' for styles, no wasm, plugins cut), placed
# where it belongs in deploy_server.py: on the JS builder trees, before they are copied to the package tree, then
# the deploy steps that follow that copy are replayed (maps deleted, api.js embed + formats, x2t JS snapshots,
# which must be made from the hardened sdk-all files), then minify and prune.
# Starts from out/js/<company>/builder (left pristine by the build): can be rerun.
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}
D=${D:-$R}
WS=${WS:-$D/ws}
L=${L:-$D/logs}; LT=${LT:-csp5}; N=${N:-B}
IMG_DEPS=${IMG_DEPS:-christien-builder-deps:9.4.0.129-node22}
step() { echo "$(date -Is) $*" >> $L/${N}0-$LT-steps.log; }
set -u
step "harden start"
docker run --rm --network none --memory=12g -e NODE_PATH=/nm -e NODE_OPTIONS=--max-old-space-size=10000 \
  -v $WS:/ws -v $WS/web-apps/build/node_modules:/nm:ro -v $R/env/csp4/harden:/h:ro \
  -v $R/env/minify/minify.js:/minify.js:ro -v $R/env/christien/prune.txt:/prune.txt:ro -v $L:/logs -e MLOG=/logs/${N}7-$LT-harden-minify.jsonl -w / $IMG_DEPS sh -c '
set -e
B=/ws/build_tools/out/js/christien/builder
O=/ws/build_tools/out/linux_64/christien/documentserver
rm -rf $O/web-apps $O/sdkjs
cp -a $B/web-apps $O/web-apps && cp -a $B/sdkjs $O/sdkjs
# 1. hardening (needs the readable sources: before minify, on the copy)
sh /h/harden.sh $O /ws/web-apps/vendor/underscore/underscore.js
# 2. the deploy steps of deploy_server.py that follow the copy
rm -f $O/web-apps/apps/*/*/*.js.map $O/web-apps/apps/*/mobile/dist/js/*.js.map
(cd /ws/sdkjs/common/embed && /ws/build_tools/tools/linux/python3/bin/python3 make.py $O/web-apps/apps/api/documents/api.js)
(cd /ws/web-apps/build/embed && /ws/build_tools/tools/linux/python3/bin/python3 make.py $O/web-apps/apps/api/documents/api.js)
echo DEPLOY_REPLAY_OK
# 3. minify (terser of web-apps lockfile) and prune
node /minify.js $O/web-apps $O/sdkjs > $MLOG; tail -1 $MLOG; grep "\"error\"" $MLOG && exit 1 || true
cd $O && grep -v "^\s*\(#\|$\)" /prune.txt | while read -r p; do
  if [ -e "$p" ]; then echo "PRUNE $(du -sb "$p" | cut -f1) $p"; rm -rf "$p"; else echo "ALREADY $p"; fi
done
# 4. x2t JS snapshots last: they are V8 code caches of the sdk-all files as served, so after minify
#    (made before minify, they are stale and x2t falls back to a full compile)
(cd $O/server/FileConverter/bin && ./x2t -create-js-snapshots) && ls -la $O/sdkjs/*/sdk-all.bin
echo HARDEN_DEPLOY_OK' > $L/${N}7-$LT-harden.log 2>&1 || { step "FAIL harden (logs/${N}7-$LT-harden.log)"; exit 1; }
step "harden ok: $(grep -E '^templates' $L/${N}7-$LT-harden.log | cut -c1-160)"
step "harden minify: $(grep '"summary":true,"files"' $L/${N}7-$LT-harden.log | tail -1)"
