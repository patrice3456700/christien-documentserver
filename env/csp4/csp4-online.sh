#!/bin/sh
# csp4: online build of ONLYOFFICE v10.0.0.176 (Christien identity, CSP patches, pkg target node22) in a fresh
# workspace, with the Node 22 toolchain images (env/csp4/toolchain). Logs: logs/9x-csp4-*.
# Then minify + prune as for csp3. Packaging and image: csp4-package.sh.
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}   # this repository (env/)
D=${D:-$R}   # working root: mirror/, logs/, the workspaces
TAG=${TAG:-v10.0.0.176}; PV=${PV:-10.0.0}; BN=${BN:-176}
export WS=${WS:-$D/ws6} WSH=${WSH:-$D/ws6-home}
L=$D/logs; LT=csp4; N=9
IMG_DEPS=christien-builder-deps:9.4.0.129-node22
COMPANY_LOW=christien
step() { echo "$(date -Is) $*" >> $L/${N}0-$LT-steps.log; }
free_ok() { [ $(df --output=avail -BG $D | tail -1 | tr -dc 0-9) -ge ${FREE_MIN:-40} ] || { step "STOP free space"; exit 2; }; }
set -u
# patches: CSP (web-apps, same as csp1-3) + pkg target (build_tools)
mkdir -p $WS $WSH $WSH/patches
cp $R/env/csp/patches/*.patch $R/env/csp4/patches/*.patch $WSH/patches/
printf 'COMPANY_NAME=%s\n' "Christien EI" > $WSH/build.env
run() { # run <step> <log>
  docker rm -f christien-build-csp4-$1 >/dev/null 2>&1
  docker run --name christien-build-csp4-$1 --cpuset-cpus=0-5 --memory=12g --memory-swap=14g \
    -e PRODUCT_VERSION=$PV -e BUILD_NUMBER=$BN -e MAKE_MAX_JOBS=6 -e DEPOT_TOOLS_UPDATE=0 -e TAG=$TAG \
    -e BRANDING="--branding-name=$COMPANY_LOW" --env-file $WSH/build.env \
    -v $WS:/ws -v $WSH/.npm:/root/.npm -v $WSH/.pkg-cache:/root/.pkg-cache -v $WSH/.cache:/root/.cache \
    -v $WSH/patches:/patches:ro -v $R/env/csp4/online-steps.sh:/steps.sh:ro ${EXTRA:-} \
    -w / $IMG_DEPS sh /steps.sh $1 > $L/$2.log 2>&1
  RC=$?; docker rm christien-build-csp4-$1 >/dev/null; [ $RC = 0 ] || { step "FAIL $1 rc=$RC"; exit 1; }
}
step START; free_ok
if [ ! -d $WSH/.npm ]; then
  # same caches as csp1-3 (fewer downloads), plus the node22 bases of pkg-fetch 3.6
  cp -a $D/mirror/caches/build-root.npm $WSH/.npm && cp -a --update=none $D/mirror/caches/deps-root.npm/. $WSH/.npm/ \
  && cp -a $D/mirror/caches/build-root.pkg-cache $WSH/.pkg-cache && cp -a $D/mirror/caches/build-root.cache $WSH/.cache \
  && cp -a --update=none $D/mirror/caches/final/npm/. $WSH/.npm/ && mkdir -p $WSH/.pkg-cache/v3.6 \
  && for b in linux-x64 linuxstatic-x64; do cp $D/mirror/http/github.com/yao-pkg/pkg-fetch/releases/download/v3.6/node-v22.23.4-$b $WSH/.pkg-cache/v3.6/fetched-v22.23.4-$b; done \
  || { step "FAIL home"; exit 1; }
fi
step "home seeded"
[ -d $WS/build_tools ] || run clone ${N}1-$LT-clone; step "clone ok"
run prelude ${N}1-$LT-prelude; step "prelude ok"
run fetch ${N}1-$LT-fetch-patch; step "fetch+patch ok"; free_ok
# v8 8.9 is unchanged in v10 (v8_89.py): same frozen tree as csp1-3, v8_89.py skips fetch/sync when v8/ exists
if [ ! -d $WS/core/Common/3dParty/v8_89/v8 ]; then
  $R/env/phase2/offline-seed-v8.sh > $L/${N}1-$LT-seed-v8.log 2>&1 || { step "FAIL seed"; exit 1; }
fi
step "v8 seeded"
SR=/ws/build_tools/tools/linux/sysroot/ubuntu16-amd64-sysroot/usr/bin/make
EXTRA="-e MAKE_REAL=/opt/make-sysroot -v $WS${SR#/ws}:/opt/make-sysroot:ro -v $R/env/make-cap.sh:$SR:ro" \
  run build ${N}2-$LT-build; step "build ok"; free_ok
OUT=/ws/build_tools/out/linux_64/$COMPANY_LOW/documentserver
docker run --rm --network none --memory=12g -e NODE_PATH=/nm -e NODE_OPTIONS=--max-old-space-size=10000 \
  -v $WS:/ws -v $WS/web-apps/build/node_modules:/nm:ro -v $R/env/minify/minify.js:/minify.js:ro \
  $IMG_DEPS node /minify.js $OUT/web-apps $OUT/sdkjs > $L/${N}5-$LT-minify.jsonl 2>&1 \
  || { step "FAIL minify"; exit 1; }
step "minify ok: $(tail -1 $L/${N}5-$LT-minify.jsonl)"
grep -v '^\s*\(#\|$\)' $R/env/christien/prune.txt > $L/${N}6-$LT-prune.list
docker run --rm --network none -v $WS:/ws -v $L/${N}6-$LT-prune.list:/prune.list:ro alpine:latest sh -c \
  'cd '$OUT' && while read -r p; do [ -e "$p" ] || { echo "MISSING $p"; exit 1; }; echo "$(du -sb "$p" | cut -f1) $p"; rm -rf "$p"; done < /prune.list' \
  > $L/${N}6-$LT-prune.log 2>&1 || { step "FAIL prune"; exit 1; }
step "prune ok: $(awk '{s+=$1} END {print s}' $L/${N}6-$LT-prune.log) bytes"
step DONE
