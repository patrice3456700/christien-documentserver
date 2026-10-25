# Node 22 toolchain overlay for the csp4 build (ONLYOFFICE v10.0.0.176, Node2Shell / CVE-2026-111497).
# Applied on top of both builder images (BASE = christien-builder-deps:9.4.0.129 or
# christien-builder:9.4.0.129-pinned). v10 build_tools requires Node >= 20 to build, and pkg >= 6.16
# requires Node >= 22 to run; pkg 6.24.0 brings pkg-fetch 3.6.7, the first that knows 22.23.4.
# Node: official tarball, sha256 from SHASUMS256.txt (GPG-checked against nodejs/release-keys).
# npm globals: offline, from mirror/caches/toolchain-node22.npm (frozen 2026-10-24).
# Build: docker build --build-arg BASE=<img> --build-context npmcache=../../../mirror/caches/toolchain-node22.npm -t <img>-node22 .
ARG BASE
FROM ${BASE}
COPY node-v22.23.4-linux-x64.tar.xz /tmp/
RUN echo "1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce  /tmp/node-v22.23.4-linux-x64.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/node-v22.23.4 && tar -xJf /tmp/node-v22.23.4-linux-x64.tar.xz -C /opt/node-v22.23.4 --strip-components=1 \
 && rm /tmp/node-v22.23.4-linux-x64.tar.xz \
 && for b in node npm npx corepack; do ln -sf /opt/node-v22.23.4/bin/$b /usr/local/bin/$b; done
RUN --mount=type=bind,from=npmcache,target=/npm-ro \
    cp -a /npm-ro /tmp/npm-cache \
 && rm -rf /usr/local/lib/node_modules/@yao-pkg /usr/local/bin/pkg \
 && /usr/local/bin/npm install -g --prefix /usr/local --offline --cache /tmp/npm-cache @yao-pkg/pkg@6.24.0 grunt-cli@1.5.0 \
 && rm -rf /tmp/npm-cache \
 && node -v && pkg --version
