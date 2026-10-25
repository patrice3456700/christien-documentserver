#!/bin/sh
# Offline build of christien/documentserver (ONLYOFFICE v10.0.0.176, Christien identity, CSP hardening, Node 22):
# clone, prelude, fetch+patches, build, minify, prune, harden, make deb, image, in a fresh workspace, with no egress.
# Build containers sit on an internal Docker network (christien-offline-net, internal: true); their only peer is the
# mirror server, serving mirror/ read-only (every miss logged as MISS). The image stage uses a second read-only mirror
# rooted at mirror/apt/$SNAP (the dated Ubuntu snapshot recorded for this release) that also serves the .deb just built.
#   R  this repository (env/)                    D  working root: mirror/, logs/, the workspaces
#   PKI_DIR  local CA of the mirror: ca.crt, ca-bundle.crt (system bundle + ca.crt), mirror.crt, mirror.key
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}
D=${D:-$R}
TAG=${TAG:-v10.0.0.176}; PV=${PV:-10.0.0}; BN=${BN:-176}; V=${V:-csp5}
SNAP=${SNAP:-20261024T000000Z}
export R D WS=${WS:-$D/ws-$V} WSH=${WSH:-$D/ws-$V-home}
export L=${L:-$D/logs} LT=${LT:-$V} N=${N:-B}
PKI_DIR=${PKI_DIR:-$D/pki}
export IMG_DEPS=${IMG_DEPS:-christien-builder-deps:9.4.0.129-node22}
IMG_PKG=${IMG_PKG:-christien-builder:9.4.0.129-pinned-node22}
IMG_MIRROR=${IMG_MIRROR:-christien-builder-deps:9.4.0.129}
IMG=christien/documentserver:$PV-$BN-$V
COMPANY_LOW=christien
NET=${NET:-christien-offline-net}
PKI="-v $PKI_DIR/ca-bundle.crt:/etc/ssl/certs/ca-certificates.crt:ro -v $PKI_DIR/ca.crt:/pki/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/pki/ca.crt"
step() { echo "$(date -Is) $*" >> $L/${N}0-$LT-steps.log; }
free_ok() { [ $(df --output=avail -BG $D | tail -1 | tr -dc 0-9) -ge ${FREE_MIN:-40} ] || { step "STOP free space"; exit 2; }; }
mirror() { # mirror <name> <root> <log> [extra docker args]: read-only mirror on the internal network, no egress
  docker rm -f $1 >/dev/null 2>&1
  aliases=$(sed 's/^/--network-alias /' $R/env/phase2/mirror-hosts.txt | tr '\n' ' ')
  docker run -d --name $1 --network $NET $aliases --user $(id -u):$(id -g) -e HOME=/tmp -e MIRROR_LOG=/logs/$3 \
    -v $2:/mirror:ro ${4:-} -v $PKI_DIR:/pki:ro -v $R/env/phase2/mirror_server.py:/srv/mirror_server.py:ro \
    -v $L:/logs $IMG_MIRROR python3 -u /srv/mirror_server.py >/dev/null || { step "FAIL mirror $1"; exit 1; }
  sleep 3
}
set -u
mkdir -p $L
step START; free_ok
[ -e $WS ] && { step "STOP $WS exists"; exit 2; }
docker network inspect $NET >/dev/null 2>&1 || docker network create --internal $NET >/dev/null
[ "$(docker network inspect $NET --format '{{.Internal}}')" = true ] || { step "STOP $NET is not internal"; exit 2; }
mkdir -p $WS $WSH/patches
cp $R/env/csp/patches/*.patch $R/env/csp4/patches/*.patch $WSH/patches/
printf 'COMPANY_NAME=%s\n' "Christien EI" > $WSH/build.env
printf 'offline=true\n' > $WSH/.npmrc     # sudo (deps.py) drops npm_config_offline: .npmrc carries it
cp -a $D/mirror/caches/csp4/npm $WSH/.npm && cp -a $D/mirror/caches/csp4/pkg-cache $WSH/.pkg-cache \
  && cp -a $D/mirror/caches/csp4/cache $WSH/.cache || { step "FAIL home"; exit 1; }
step "home seeded from mirror/caches/csp4"
mirror christien-mirror-$V $D/mirror ${N}4-$LT-mirror-access.log
# proof of no egress, from a build container (its request to github.com/ is the one expected MISS)
docker run --rm --network $NET $PKI $IMG_DEPS sh -c \
  'getent hosts example.org && exit 1; curl -sS -m 10 -o /dev/null https://1.1.1.1 && exit 1; curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://github.com/ ; echo NO_EGRESS_OK' \
  > $L/${N}1-$LT-netcheck.log 2>&1 || { step "FAIL netcheck"; exit 1; }
step "netcheck: $(tail -1 $L/${N}1-$LT-netcheck.log)"
run() { # run <step> <log>: one step of online-steps.sh, offline
  docker rm -f christien-build-$V-$1 >/dev/null 2>&1
  docker run --name christien-build-$V-$1 --network $NET --cpuset-cpus=0-5 --memory=12g --memory-swap=14g $PKI \
    -e PRODUCT_VERSION=$PV -e BUILD_NUMBER=$BN -e MAKE_MAX_JOBS=6 -e DEPOT_TOOLS_UPDATE=0 -e TAG=$TAG \
    -e npm_config_offline=true -e BRANDING="--branding-name=$COMPANY_LOW" --env-file $WSH/build.env \
    -v $WS:/ws -v $WSH/.npm:/root/.npm -v $WSH/.pkg-cache:/root/.pkg-cache -v $WSH/.cache:/root/.cache -v $WSH/.npmrc:/root/.npmrc:ro \
    -v $WSH/patches:/patches:ro -v $R/env/csp4/online-steps.sh:/steps.sh:ro ${EXTRA:-} \
    -w / $IMG_DEPS sh /steps.sh $1 > $L/$2.log 2>&1
  RC=$?; docker rm christien-build-$V-$1 >/dev/null; [ $RC = 0 ] || { step "FAIL $1 rc=$RC"; exit 1; }
}
run clone ${N}1-$LT-clone; step "clone ok"
run prelude ${N}1-$LT-prelude; step "prelude ok"
run fetch ${N}1-$LT-fetch-patch; step "fetch+patch ok"; free_ok
$R/env/phase2/offline-seed-v8.sh > $L/${N}1-$LT-seed-v8.log 2>&1 || { step "FAIL seed"; exit 1; }
step "v8 seeded"
SR=/ws/build_tools/tools/linux/sysroot/ubuntu16-amd64-sysroot/usr/bin/make
EXTRA="-e MAKE_REAL=/opt/make-sysroot -v $WS${SR#/ws}:/opt/make-sysroot:ro -v $R/env/make-cap.sh:$SR:ro" \
  run build ${N}2-$LT-build; step "build ok"; free_ok
OUT=/ws/build_tools/out/linux_64/$COMPANY_LOW/documentserver
docker run --rm --network none --memory=12g -e NODE_PATH=/nm -e NODE_OPTIONS=--max-old-space-size=10000 \
  -v $WS:/ws -v $WS/web-apps/build/node_modules:/nm:ro -v $R/env/minify/minify.js:/minify.js:ro \
  $IMG_DEPS node /minify.js $OUT/web-apps $OUT/sdkjs > $L/${N}5-$LT-minify.jsonl 2>&1 || { step "FAIL minify"; exit 1; }
grep -v '^\s*\(#\|$\)' $R/env/christien/prune.txt > $L/${N}6-$LT-prune.list
docker run --rm --network none -v $WS:/ws -v $L/${N}6-$LT-prune.list:/prune.list:ro alpine:latest sh -c \
  'cd '$OUT' && while read -r p; do [ -e "$p" ] || { echo "MISSING $p"; exit 1; }; echo "$(du -sb "$p" | cut -f1) $p"; rm -rf "$p"; done < /prune.list' \
  > $L/${N}6-$LT-prune.log 2>&1 || { step "FAIL prune"; exit 1; }
step "minify+prune ok"
$R/env/csp4/csp4-harden.sh || { step "FAIL harden"; exit 1; }
# make deb (Christien identity, npm/json packed for node22)
cp $R/env/christien/patches/*.patch $R/env/csp4/patches-image/*.patch $WSH/patches/
docker run --rm --name christien-build-$V-package --network $NET --cpuset-cpus=0-5 --memory=12g $PKI \
 -e npm_config_offline=true -e CN=Christien -e PN=DocumentServer -e PV=$PV -e BN=$BN -e TAG=$TAG \
 -v $WS:/ws -v $WSH/.npm:/root/.npm -v $WSH/.pkg-cache:/root/.pkg-cache -v $WSH/.npmrc:/root/.npmrc:ro -v $WSH/patches:/patches:ro \
 -w /ws $IMG_PKG sh -c '
set -ex
git config --global --add safe.directory "*"
for r in document-server-package Docker-DocumentServer; do
  [ -d $r ] || git clone --depth 1 --branch $TAG https://github.com/ONLYOFFICE/$r.git
  git -C $r log -1 --format="BASE $r %H"
  git -C $r checkout -q -- . && git -C $r clean -fdxq     # rerunnable: patches on the tag, no stale make stamps
  for p in /patches/$r-*.patch; do [ -e "$p" ] || continue; git -C $r apply --verbose "$p"; done
  git -C $r status --short
done
cd document-server-package
MK="COMPANY_NAME=$CN PRODUCT_NAME=$PN PRODUCT_VERSION=$PV BUILD_NUMBER=$BN BRANDING=christien PKG_TARGET=node22-linuxstatic-x64"
# the main package tree first, without server/welcome (pruned)
make documentserver $MK
# the example package (built by the same dpkg-buildpackage, not installed in the image) still reads
# server/welcome/example: recreated as deploy_server.py does, for that package only, then removed again
O=/ws/build_tools/out/linux_64/christien/documentserver
mkdir -p $O/server/welcome && cp -a /ws/server/branding/welcome/example $O/server/welcome/
cp /ws/core-fonts/opensans/* $O/server/welcome/example/css/
make deb $MK
rm -rf $O/server/welcome
ls -la deb/*.deb' > $L/${N}3-$LT-package.log 2>&1 || { step "FAIL package"; exit 1; }
step "package ok"
mkdir -p $WSH/pkgs/$V
docker run --rm -v $WS:/ws:ro -v $WSH/pkgs/$V:/o alpine:latest sh -c \
  'cp /ws/document-server-package/deb/christien-documentserver_'$PV-$BN'_amd64.deb /o/ && chown '$(id -u):$(id -g)' /o/*.deb'
# image: apt from the dated snapshot recording only (read-only), corefonts from the mirror, the .deb of this build
docker stop christien-mirror-$V >/dev/null
for d in christien-packages downloads.sourceforge.net; do mkdir -p $D/mirror/apt/$SNAP/http/$d; done   # mount points
mirror christien-mirror-$V-apt $D/mirror/apt/$SNAP ${N}4-$LT-mirror-apt-access.log \
  "-v $WSH/pkgs:/mirror/http/christien-packages:ro -v $D/mirror/http/downloads.sourceforge.net:/mirror/http/downloads.sourceforge.net:ro"
DOCKER_BUILDKIT=0 docker build --no-cache --network $NET \
  --build-arg COMPANY_NAME=christien --build-arg PRODUCT_NAME=documentserver --build-arg PACKAGE_VERSION=$PV-$BN \
  --build-arg PACKAGE_BASEURL=http://christien-packages/$V --build-arg TARGETARCH=amd64 \
  -t $IMG $WS/Docker-DocumentServer > $L/${N}4-$LT-image.log 2>&1 || { step "FAIL image"; docker stop christien-mirror-$V-apt >/dev/null; exit 1; }
docker stop christien-mirror-$V-apt >/dev/null
step "image ok $(docker image inspect $IMG --format '{{.Id}}')"
step "MISS total (1 expected, the netcheck): $(cat $L/${N}4-$LT-mirror-access.log $L/${N}4-$LT-mirror-apt-access.log | grep -c MISS)"
step DONE
