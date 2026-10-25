# syntax=docker/dockerfile:1.7
# Build environment (build_tools dependencies) for ONLYOFFICE Document Server, first made for 9.4.0-129.
# Replaces the phase-1 `docker commit` (christien-builder-deps:9.4.0.129): same base layer, same
# packages at the same versions (packages.pinned, taken from that image), apt from a dated Ubuntu
# snapshot so the versions stay installable, npm globals from our frozen npm cache.
# Build (online, once):  docker build --build-context mirror=../../../mirror -t christien-builder:9.4.0.129-pinned .
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

ENV TZ=Etc/UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Ubuntu archive as of the phase-1 deps install (2026-10-19 ~10:45 UTC).
ARG UBUNTU_SNAPSHOT=20261019T100000Z
# Bootstrap: the base image has no TLS roots and snapshot.ubuntu.com is https-only, so ca-certificates
# (exact version of the phase-1 image) comes from the live archive; everything else from the snapshot.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates=20260601~24.04.1 \
 && sed -i "s#http://archive.ubuntu.com/ubuntu/#https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}/#; s#http://security.ubuntu.com/ubuntu/#https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}/#" /etc/apt/sources.list.d/ubuntu.sources \
 && rm -rf /var/lib/apt/lists/*

COPY packages.pinned packages.pinned.extra /tmp/
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive xargs -a /tmp/packages.pinned apt-get install -y --no-install-recommends --allow-downgrades \
 && DEBIAN_FRONTEND=noninteractive xargs -a /tmp/packages.pinned.extra apt-get install -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# CMake 3.30.0, as tools/linux/cmake.sh installs it, from the mirror (sha256 in mirror/manifest.json).
RUN --mount=type=bind,from=mirror,source=http/github.com/Kitware/CMake/releases/download/v3.30.0,target=/m \
    echo "09846a3858583f38189b59177586adf125a08c15f3cddcaf7d7d7081ac86969f  /m/cmake-3.30.0-linux-x86_64.tar.gz" | sha256sum -c - \
 && tar -xzf /m/cmake-3.30.0-linux-x86_64.tar.gz -C /opt \
 && ln -s /opt/cmake-3.30.0-linux-x86_64/bin/cmake /usr/local/bin/cmake \
 && ln -s /opt/cmake-3.30.0-linux-x86_64/bin/ctest /usr/local/bin/ctest

# npm globals installed by tools/linux/deps.py, from the frozen cache only.
RUN --mount=type=bind,from=mirror,source=caches/deps-root.npm,target=/npm-ro \
    cp -a /npm-ro /tmp/npm-cache \
 && npm install -g --offline --cache /tmp/npm-cache grunt-cli@1.5.0 @yao-pkg/pkg@6.11.0 \
 && rm -rf /tmp/npm-cache

# make -jN cap used in phase 1 (build environment only).
COPY make-cap-image.sh /usr/local/bin/make
ENV MAKE_MAX_JOBS=4
WORKDIR /ws/build_tools/tools/linux
CMD ["/bin/bash"]
