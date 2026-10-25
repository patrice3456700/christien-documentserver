#!/bin/sh
# csp4, second half: make deb (Christien identity, npm/json packed for node22) and the image.
# The image is built with the classic builder on the internal christien-record-net: its only peer is a mirror
# in record mode serving Ubuntu from a dated snapshot (SNAP) and keeping every file under mirror/apt/$SNAP,
# so the apt part can be replayed offline later. Base: ubuntu:24.04 as pulled tonight + full-upgrade.
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}   # this repository (env/)
D=${D:-$R}   # working root: mirror/, logs/, the workspaces
TAG=${TAG:-v10.0.0.176}; PV=${PV:-10.0.0}; BN=${BN:-176}; V=csp4
SNAP=${SNAP:-20261024T000000Z}
export WS=${WS:-$D/ws6} WSH=${WSH:-$D/ws6-home}
L=$D/logs; LT=csp4; N=9
IMG=christien/documentserver:$PV-$BN-$V
step() { echo "$(date -Is) $*" >> $L/${N}0-$LT-steps.log; }
set -u
step "package start"
cp $R/env/christien/patches/*.patch $R/env/csp4/patches-image/*.patch $WSH/patches/
docker run --rm --name christien-build-csp4-package --cpuset-cpus=0-5 --memory=12g \
 -e CN=Christien -e PN=DocumentServer -e PV=$PV -e BN=$BN -e TAG=$TAG \
 -v $WS:/ws -v $WSH/.npm:/root/.npm -v $WSH/.pkg-cache:/root/.pkg-cache -v $WSH/patches:/patches:ro \
 -w /ws christien-builder:9.4.0.129-pinned-node22 sh -c '
set -ex
git config --global --add safe.directory "*"
for r in document-server-package Docker-DocumentServer; do
  [ -d $r ] || git clone --depth 1 --branch $TAG https://github.com/ONLYOFFICE/$r.git
  git -C $r log -1 --format="BASE $r %H"
  git -C $r checkout -q -- . && git -C $r clean -fdxq     # rerunnable: patches on the tag, no stale make stamps (ignored files too)
  for p in /patches/$r-*.patch; do [ -e "$p" ] || continue; git -C $r apply --verbose "$p"; done
  git -C $r status --short
done
cd document-server-package
MK="COMPANY_NAME=$CN PRODUCT_NAME=$PN PRODUCT_VERSION=$PV BUILD_NUMBER=$BN BRANDING=christien PKG_TARGET=node22-linuxstatic-x64"
# the main package tree first, without server/welcome (pruned since csp3)
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
mkdir -p $D/mirror/http/christien-packages/$V
docker run --rm -v $WS:/ws:ro -v $D/mirror/http/christien-packages/$V:/o alpine:latest sh -c \
  'cp /ws/document-server-package/deb/christien-documentserver_'$PV-$BN'_amd64.deb /o/ && chown 1000:1000 /o/*.deb'
# record-mode mirror: own root for this snapshot (a fresh InRelease, not the 2026-10-19 one), the package and
# the corefonts from the existing mirror, read-only
AR=$D/mirror/apt/$SNAP; mkdir -p $AR/http/archive.ubuntu.com $AR/http/security.ubuntu.com
docker rm -f christien-mirror-record >/dev/null 2>&1
docker run -d --name christien-mirror-record --network christien-record-net \
  --network-alias archive.ubuntu.com --network-alias security.ubuntu.com \
  --network-alias downloads.sourceforge.net --network-alias christien-packages \
  --user 1000:1000 -e HOME=/tmp -e MIRROR_LOG=/logs/${N}4-$LT-mirror-record.log \
  -e MIRROR_RECORD=archive.ubuntu.com/ubuntu/=https://snapshot.ubuntu.com/ubuntu/$SNAP/,security.ubuntu.com/ubuntu/=https://snapshot.ubuntu.com/ubuntu/$SNAP/ \
  -v $AR:/mirror -v $D/mirror/http/christien-packages:/mirror/http/christien-packages:ro \
  -v $D/mirror/http/downloads.sourceforge.net:/mirror/http/downloads.sourceforge.net:ro \
  -v ${PKI_DIR:-$D/pki}:/pki:ro -v $R/env/phase2/mirror_server.py:/srv/mirror_server.py:ro -v $L:/logs \
  christien-builder-deps:9.4.0.129 python3 -u /srv/mirror_server.py >/dev/null
docker network connect bridge christien-mirror-record   # egress for the recording only
sleep 3
DOCKER_BUILDKIT=0 docker build --no-cache --network christien-record-net \
  --build-arg COMPANY_NAME=christien --build-arg PRODUCT_NAME=documentserver --build-arg PACKAGE_VERSION=$PV-$BN \
  --build-arg PACKAGE_BASEURL=http://christien-packages/$V --build-arg TARGETARCH=amd64 \
  -t $IMG $WS/Docker-DocumentServer > $L/${N}4-$LT-image.log 2>&1 || { step "FAIL image"; docker stop christien-mirror-record >/dev/null; exit 1; }
docker stop christien-mirror-record >/dev/null
step "image ok $(docker image inspect $IMG --format '{{.Id}}')"
step "package DONE"
