#!/bin/sh
# csp4, online pass (inside a builder container with egress): ONLYOFFICE $TAG built the way automate.py does,
# split so our patches go in between the fetch and the build. One step per call:
#   clone   build_tools at the tag
#   prelude exact prelude of tools/linux/automate.py (python, deps, cmake, Qt, sysroots)
#   fetch   configure.py + base.update_repositories (every repo at the tag), then our patches
#   build   automate.py server with --update=0, so nothing resets the patches
# What this pass consumes is harvested into mirror/ afterwards, for the offline replay.
set -ex
TAG=${TAG:?}
git config --global --add safe.directory '*'
case "$1" in
clone)
  cd /ws && git clone --depth 1 --branch $TAG https://github.com/ONLYOFFICE/build_tools.git build_tools
  echo CLONE_OK ;;
prelude)
  cd /ws/build_tools/tools/linux
  ./python.sh
  ./python3/bin/python3 ./deps.py
  sudo ./cmake.sh
  ./python3/bin/python3 ./qt_binary_fetch.py all
  cd sysroot && ../python3/bin/python3 ./fetch.py all
  echo PRELUDE_OK ;;
fetch)
  cd /ws/build_tools
  ./tools/linux/python3/bin/python ./configure.py --branch tags/$TAG --module server --sysroot 1 --update 1 \
    --qt-dir /ws/build_tools/tools/linux/qt_build/Qt-5.9.9
  ./tools/linux/python3/bin/python -c '
import sys; sys.path.append("scripts")
import config, base
config.parse(); config.parse_defaults()
base.update_repositories(base.get_repositories())'
  for p in /patches/*.patch; do
    repo=$(basename "$p" | sed 's/-[0-9]\{4\}-.*//')
    git -C /ws/$repo apply --verbose "$p"
    git -C /ws/$repo log -1 --format="BASE $repo %H"
    git -C /ws/$repo diff --stat | tail -1
  done
  echo FETCH_PATCH_OK ;;
build)
  cd /ws/build_tools/tools/linux
  python3 -u ./automate.py server --branch=tags/$TAG --update=0 ${BRANDING:-}
  echo BUILD_OK ;;
esac
