#!/usr/bin/env python3
"""CSP hashes of the inline <script> and <style> blocks of the editor pages, as a browser computes them.

A CSP hash covers the element's text content after HTML input preprocessing: CRLF and lone CR become LF
before tokenizing, so hashing the raw bytes of a CRLF page gives wrong values. Also lists inline event
handler attributes (on*=), which no CSP hash can allow without 'unsafe-hashes'.
Usage: csp_hashes.py <docroot> [page ...]   (pages relative to web-apps/apps)
"""
import base64, hashlib, json, os, sys
from html.parser import HTMLParser

PAGES = ["documenteditor/main/index.html", "spreadsheeteditor/main/index.html", "presentationeditor/main/index.html"]


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.blocks, self.handlers, self.cur = [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k, v in attrs:
            if k.startswith("on"):
                self.handlers.append({"tag": tag, "attr": k, "value": v, "line": self.getpos()[0],
                                      "sha256": "sha256-" + base64.b64encode(hashlib.sha256((v or "").encode()).digest()).decode()})
        if tag in ("script", "style") and "src" not in a:
            self.cur = {"tag": tag, "line": self.getpos()[0], "text": []}

    def handle_data(self, d):
        if self.cur is not None:
            self.cur["text"].append(d)

    def handle_endtag(self, tag):
        if self.cur is not None and tag == self.cur["tag"]:
            t = "".join(self.cur["text"]).encode()
            self.blocks.append({"tag": tag, "line": self.cur["line"], "bytes": len(t),
                                "sha256": "sha256-" + base64.b64encode(hashlib.sha256(t).digest()).decode()})
            self.cur = None


root = sys.argv[1]
out = {}
for page in sys.argv[2:] or PAGES:
    raw = open(os.path.join(root, "web-apps/apps", page), "rb").read().decode("utf-8")
    text = raw.replace("\r\n", "\n").replace("\r", "\n")  # HTML input stream preprocessing
    p = P(); p.feed(text); p.close()
    out[page] = {"crlf": "\r\n" in raw, "blocks": p.blocks, "handlers": p.handlers}
json.dump(out, sys.stdout, indent=1)
