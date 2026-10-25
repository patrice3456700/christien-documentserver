#!/usr/bin/env python3
"""Write manifest-<version>-<variant>.json: what "corresponding source" means for christien/documentserver.

Run after the offline build (env/csp4/csp4-offline.sh), with the same R, D, V, N, LT. The inputs listed are the ones
that build actually consumed: git commits from its workspace inventory (logs/<N>9-<LT>-git-inventory.tsv, written by
env/phase2/git-inventory.sh), HTTP files from its mirror access logs, plus the apt snapshot of the image, the frozen
trees and caches, our patches and build scripts. Hashes every file.
"""
import hashlib
import json
import os
import subprocess
import time

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # this repository
D = os.environ.get("D", R)                                                           # working root
M = os.path.join(D, "mirror")
L = os.environ.get("L", os.path.join(D, "logs"))
TAG, PV, BN = "v10.0.0.176", "10.0.0", "176"
SNAP = "20261024T000000Z"
V = os.environ.get("V", "csp5"); N = os.environ.get("N", "B"); LT = os.environ.get("LT", V)
WSH = os.environ.get("WSH", os.path.join(D, "ws-%s-home" % V))


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout.strip()


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def du(path):
    return int(sh("du", "-sb", path).split()[0])


def tree_digest(path):
    """sha256 over the sorted "<sha256>  <relative path>" lines of every file: one digest for a cache tree."""
    lines = []
    for dirpath, _, filenames in os.walk(path):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            if os.path.isfile(p) and not os.path.islink(p):
                lines.append(sha256(p) + "  " + os.path.relpath(p, path))
    lines.sort(key=lambda l: l[66:])
    return hashlib.sha256("\n".join(lines).encode()).hexdigest(), len(lines)


def git(repo, *args):
    return sh("git", "-c", "safe.directory=*", "-C", repo, *args)


def image(ref):
    return sh("docker", "image", "inspect", ref, "--format", "{{.Id}}") or None


def entry(root, rel, url=None):
    p = os.path.join(root, rel)
    e = {"path": os.path.relpath(p, R if root == R else D), "sha256": sha256(p), "bytes": os.path.getsize(p)}
    if url:
        e["url"] = url
    return e


# Git: commits checked out by the build.
consumed = {}
with open(os.path.join(L, "%s9-%s-git-inventory.tsv" % (N, LT))) as f:
    for line in f:
        gd, url, head, shallow = line.rstrip("\n").split("\t")
        if not url:
            continue
        rel = url.split("://", 1)[1]
        rel = rel[:-4] if rel.endswith(".git") else rel
        consumed.setdefault(rel + ".git", set()).add(head)
repos = []
for rel, heads in sorted(consumed.items()):
    p = os.path.join(M, "git", rel)
    tag = git(p, "rev-parse", "-q", "--verify", "refs/tags/%s^{commit}" % TAG) if os.path.isdir(p) else ""
    repos.append({"url": "https://" + rel, "mirror_path": "mirror/git/" + rel, "present": os.path.isdir(p),
                  "consumed_commits": sorted(heads), "tag_" + TAG: tag or None,
                  # also used as submodules pinned elsewhere (document-formats, document-templates): tag among the commits
                  "tag_consumed": (tag in heads) if tag else None})


# HTTP: files served (200) by the offline mirrors during the build, mapped back to their mirror path.
def served(log, root):
    out = {}
    for line in open(os.path.join(L, log)):
        parts = line.split()
        if len(parts) > 4 and parts[1] == "FILE" and parts[2] == "200":
            url = parts[4]
            rel = url.split("://", 1)[1].split("?")[0]
            if os.path.isfile(os.path.join(root, rel)):
                out[url] = rel
    return out


build_http = served("%s4-%s-mirror-access.log" % (N, LT), os.path.join(M, "http"))
files = [entry(os.path.join(M, "http"), rel, url) for url, rel in sorted(build_http.items())]
# image stage: apt from the snapshot recording, corefonts from the main mirror
apt_root = os.path.join(M, "apt", SNAP, "http")
apt_served = served("%s4-%s-mirror-apt-access.log" % (N, LT), apt_root)
fonts_served = {u: r for u, r in served("%s4-%s-mirror-apt-access.log" % (N, LT), os.path.join(M, "http")).items()
                if r.startswith("downloads.sourceforge.net/")}
apt_files = [entry(apt_root, rel, url) for url, rel in sorted(apt_served.items()) if not rel.startswith("christien-packages/")]
font_files = [entry(os.path.join(M, "http"), rel, url) for url, rel in sorted(fonts_served.items())]
# tool inputs fetched outside the build containers (toolchain images, pkg-fetch bases)
extra = [entry(D, r) for r in (
    "mirror/http/nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz",
    "mirror/http/nodejs.org/dist/v22.23.4/SHASUMS256.txt",
    "mirror/http/nodejs.org/dist/v22.23.4/SHASUMS256.txt.sig",
    "mirror/http/github.com/yao-pkg/pkg-fetch/releases/download/v3.6/node-v22.23.4-linux-x64",
    "mirror/http/github.com/yao-pkg/pkg-fetch/releases/download/v3.6/node-v22.23.4-linuxstatic-x64",
) if os.path.isfile(os.path.join(D, r))]
deb = os.path.join(WSH, "pkgs", V, "christien-documentserver_%s-%s_amd64.deb" % (PV, BN))
package = {"file": os.path.basename(deb), "sha256": sha256(deb), "bytes": os.path.getsize(deb)} if os.path.isfile(deb) else None

trees = [entry(D, "mirror/trees/v8_89-synced.tar.zst")]
caches = []
for c in sorted(os.listdir(os.path.join(M, "caches", "csp4"))):
    p = os.path.join(M, "caches", "csp4", c)
    dg, n = tree_digest(p)
    caches.append({"path": "mirror/caches/csp4/" + c, "mounted_as": "/root/.%s" % c, "tree_sha256": dg, "files": n, "bytes": du(p)})


# Our modifications: the mirror stays the unmodified upstream source; the build is the mirror plus these files.
def listing(d, exts):
    return [entry(R, os.path.join(d, fn)) for fn in sorted(os.listdir(os.path.join(R, d))) if fn.endswith(exts)]


patches = []
for d in ("env/csp/patches", "env/csp4/patches", "env/christien/patches", "env/csp4/patches-image"):
    for e in listing(d, (".patch",)):
        repo = os.path.basename(e["path"]).split("-0")[0]
        e["repository"] = "https://github.com/ONLYOFFICE/%s.git" % repo
        e["base_commit"] = next((h for r, hs in consumed.items() if r == "github.com/ONLYOFFICE/%s.git" % repo for h in hs), None)
        patches.append(e)
scripts = listing("env/csp4", (".sh", ".py")) + listing("env/csp4/harden", (".js", ".sh", ".json")) \
    + [entry(R, r) for r in ("env/csp4/toolchain/Dockerfile", "env/minify/minify.js", "env/christien/prune.txt",
                             "env/make-cap.sh", "env/phase2/mirror_server.py", "env/phase2/mirror-hosts.txt",
                             "env/phase2/offline-seed-v8.sh", "env/phase2/git-inventory.sh")]

IMG = "christien/documentserver:%s-%s-%s" % (PV, BN, V)
manifest = {
    "product": "christien-documentserver",
    "version": "%s-%s" % (PV, BN),
    "variant": V,
    "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "upstream_tag": TAG,
    "build_vars": {
        "build_tools": {"branch": "tags/" + TAG, "module": "server", "PRODUCT_VERSION": PV, "BUILD_NUMBER": BN,
                        "branding": "--branding-name=christien", "COMPANY_NAME": "Christien EI"},
        "package": {"COMPANY_NAME": "Christien", "PRODUCT_NAME": "DocumentServer", "PRODUCT_VERSION": PV, "BUILD_NUMBER": BN,
                    "BRANDING": "christien", "PKG_TARGET": "node22-linuxstatic-x64"},
        "image": {"COMPANY_NAME": "christien", "PRODUCT_NAME": "documentserver", "PACKAGE_VERSION": "%s-%s" % (PV, BN),
                  "PACKAGE_BASEURL": "http://christien-packages/" + V, "TARGETARCH": "amd64",
                  "builder": "classic (DOCKER_BUILDKIT=0)", "BASE_IMAGE": "ubuntu:24.04"},
        "pkg_target": "node22 (Node 22.23.4, pkg 6.24.0, pkg-fetch 3.6.7)",
        "parallelism": {"MAKE_MAX_JOBS": 6, "cpus": 6, "memory": "12g"},
    },
    "images": {
        "ubuntu:24.04": image("ubuntu:24.04"),
        "builder_deps": {"ref": "christien-builder-deps:9.4.0.129-node22", "id": image("christien-builder-deps:9.4.0.129-node22"),
                         "dockerfile": "env/csp4/toolchain/Dockerfile"},
        "builder_pinned": {"ref": "christien-builder:9.4.0.129-pinned-node22", "id": image("christien-builder:9.4.0.129-pinned-node22"),
                           "dockerfile": "env/csp4/toolchain/Dockerfile"},
        "mirror_server": {"ref": "christien-builder-deps:9.4.0.129", "id": image("christien-builder-deps:9.4.0.129")},
        "result": {"ref": IMG, "id": image(IMG)},
    },
    "build": {"script": "env/csp4/csp4-offline.sh", "network": "internal Docker network, the mirror as only peer",
              "logs": "logs/%s*-%s-*" % (N, LT), "package": package},
    "apt_snapshot_for_image": {"snapshot": "https://snapshot.ubuntu.com/ubuntu/%s/" % SNAP, "mirror_path": "mirror/apt/" + SNAP,
                               "files": len(apt_files), "bytes": sum(f["bytes"] for f in apt_files)},
    "repositories": repos,
    "files": files,
    "image_fonts": font_files,
    "tool_inputs": extra,
    "apt_files": apt_files,
    "trees": trees,
    "caches": caches,
    "patches": patches,
    "build_scripts": scripts,
}
out = os.environ.get("OUT", os.path.join(M, "manifest-%s-%s-%s.json" % (PV, BN, V)))
json.dump(manifest, open(out, "w"), indent=1)
print(out, len(repos), "repos", sum(1 for r in repos if r["present"]), "present", len(files), "files", len(font_files), "fonts",
      len(apt_files), "apt files", len(patches), "patches", len(scripts), "scripts")
