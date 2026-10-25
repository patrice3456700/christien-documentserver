#!/usr/bin/env python3
"""Offline mirror for the christien/documentserver build.

Answers for every upstream host the build contacts (DNS aliases on the internal Docker network),
over HTTPS (certificate signed by our local CA) and plain HTTP:
  - git smart-HTTP via git-http-backend, from /mirror/git/<host>/<path>.git
  - static files from /mirror/http/<host>/<path>
Every request is logged; a miss is a 404 and is logged as MISS, so any unmirrored input shows up.
"""
import os
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("MIRROR_ROOT", "/mirror")
LOG = os.environ.get("MIRROR_LOG", "/logs/14-mirror-access.log")
CERT = os.environ.get("MIRROR_CERT", "/pki/mirror.crt")
KEY = os.environ.get("MIRROR_KEY", "/pki/mirror.key")
log_lock = threading.Lock()
# Record mode (never used for the offline proof): "host/prefix=upstream_base,..." -- a miss under a listed
# prefix is fetched once from upstream, stored under /mirror/http, then served like any mirrored file.
RECORD = [kv.split("=", 1) for kv in os.environ.get("MIRROR_RECORD", "").split(",") if "=" in kv]


def log(line):
    with log_lock:
        with open(LOG, "a") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + line + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def host(self):
        return (self.headers.get("Host") or "").split(":")[0].lower()

    def git_repo(self, host, path):
        """Return (project_root, path_info) when the request targets a mirrored git repository."""
        base = os.path.join(ROOT, "git", host)
        parts = path.split("?")[0].strip("/").split("/")
        for i in range(len(parts), 0, -1):
            repo = "/".join(parts[:i])
            rest = "/".join(parts[i:])
            for cand in (repo, repo + ".git"):
                if cand.endswith(".git") and os.path.isdir(os.path.join(base, cand)):
                    if rest in ("info/refs", "git-upload-pack", "HEAD") or rest.startswith("objects/") or rest.startswith("info/"):
                        return base, "/" + cand + "/" + rest
        return None

    def run_git(self, base, path_info, body):
        env = {
            "PATH": os.environ["PATH"],
            "GIT_PROJECT_ROOT": base,
            "GIT_HTTP_EXPORT_ALL": "1",
            "PATH_INFO": path_info,
            "REQUEST_METHOD": self.command,
            "QUERY_STRING": self.path.split("?", 1)[1] if "?" in self.path else "",
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(len(body)),
            "REMOTE_ADDR": self.client_address[0],
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "safe.directory",
            "GIT_CONFIG_VALUE_0": "*",
        }
        if self.headers.get("Content-Encoding"):
            env["HTTP_CONTENT_ENCODING"] = self.headers["Content-Encoding"]
        if self.headers.get("Git-Protocol"):
            env["GIT_PROTOCOL"] = self.headers["Git-Protocol"]
        p = subprocess.run(["git", "http-backend"], input=body, env=env, capture_output=True)
        head, _, payload = p.stdout.partition(b"\r\n\r\n")
        if not _:
            head, _, payload = p.stdout.partition(b"\n\n")
        status = 200
        headers = []
        for line in head.decode("latin-1").splitlines():
            k, _, v = line.partition(":")
            if k.lower() == "status":
                status = int(v.strip().split()[0])
            elif k:
                headers.append((k, v.strip()))
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        return status, len(payload)

    def record(self, host, rel, f):
        key = host + "/" + rel
        for prefix, upstream in RECORD:
            if key.startswith(prefix):
                url = upstream + key[len(prefix):]
                try:
                    with urllib.request.urlopen(url, timeout=120) as r:
                        data = r.read()
                except Exception as e:
                    log(f"RECORD-FAIL {url} {e}")
                    return False
                os.makedirs(os.path.dirname(f), exist_ok=True)
                with open(f + ".part", "wb") as out:
                    out.write(data)
                os.replace(f + ".part", f)
                log(f"RECORD {url} {len(data)}")
                return True
        return False

    def serve_file(self, host, path):
        rel = path.split("?")[0].split("#")[0].lstrip("/")
        f = os.path.normpath(os.path.join(ROOT, "http", host, rel))
        if RECORD and f.startswith(os.path.join(ROOT, "http")) and not os.path.isfile(f):
            self.record(host, rel, f)
        if not f.startswith(os.path.join(ROOT, "http")) or not os.path.isfile(f):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return 404, 0
        size = os.path.getsize(f)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        if self.command != "HEAD":
            with open(f, "rb") as fh:
                while True:
                    chunk = fh.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        return 200, size

    def handle_any(self):
        host = self.host()
        body = b""
        if self.headers.get("Content-Length"):
            body = self.rfile.read(int(self.headers["Content-Length"]))
        scheme = "https" if isinstance(self.connection, ssl.SSLSocket) else "http"
        try:
            g = self.git_repo(host, self.path)
            if g:
                status, size = self.run_git(g[0], g[1], body)
                kind = "GIT"
            else:
                status, size = self.serve_file(host, self.path)
                kind = "FILE"
        except (BrokenPipeError, ConnectionResetError):
            status, size, kind = 499, 0, "ABORT"
        tag = "MISS" if status == 404 else kind
        log(f"{tag} {status} {self.command} {scheme}://{host}{self.path} {size} {self.client_address[0]}")

    do_GET = do_POST = do_HEAD = handle_any


def serve(port, tls):
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    srv.serve_forever()


if __name__ == "__main__":
    log("START mirror server")
    threading.Thread(target=serve, args=(80, False), daemon=True).start()
    serve(443, True)
