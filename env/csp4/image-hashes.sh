#!/bin/sh
# CSP hashes of every editor page an integrator opens (main + mobile, the five editors), read from the image itself.
# Usage: image-hashes.sh <image> <out.json>
R=${R:-$(cd "$(dirname "$0")/../.." && pwd)}   # this repository (env/)
IMG=$1; O=$2
T=$(mktemp -d)
mkdir -p $T/root
docker run --rm --entrypoint sh $IMG -c 'cd /var/www/$COMPANY_NAME/documentserver && tar -cf - web-apps/apps/*/main/index.html web-apps/apps/*/mobile/index.html 2>/dev/null' | tar -xf - -C $T/root
PAGES=$(cd $T/root/web-apps/apps && ls */main/index.html */mobile/index.html 2>/dev/null)
python3 -I $R/env/csp/csp_hashes.py $T/root $PAGES > $O
rm -rf $T
echo "$(echo $PAGES | wc -w) pages -> $O"
