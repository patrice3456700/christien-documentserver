// csp4 hardening, part 2 (pages): load csp-shim.js first in <head> of every editor page, and rename the static
// style="..." attributes of the markup to data-csp-style= (the shim applies them through the CSSOM).
// Inline <script>/<style> blocks are left byte for byte: their CSP hashes do not move (checked here).
// Usage: node pages.js <web-apps dir> <csp-shim.js>  -> JSON summary line
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = process.argv[2], shimSrc = process.argv[3];
const shimRel = 'vendor/csp/csp-shim.js';
fs.mkdirSync(path.join(root, 'vendor/csp'), { recursive: true });
fs.copyFileSync(shimSrc, path.join(root, shimRel));

// the same rewrite as the shim applies at runtime (one implementation: taken from csp-shim.js itself)
const shim = fs.readFileSync(shimSrc, 'utf8');
const rewrite = new Function(shim.slice(shim.indexOf('  var A ='), shim.indexOf('  function fix(el)'))
  .replace('var D = document;', '') + '; return rewrite;')();
const BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

function blocks(html) {                                  // what the CSP hashes cover, as a browser sees it
  return (html.replace(/\r\n?/g, '\n').match(BLOCK) || []).filter(b => !/^<script\b[^>]*\ssrc\s*=/i.test(b))
    .map(b => crypto.createHash('sha256').update(b).digest('base64'));
}
function* pages(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(help|node_modules)$/.test(e.name)) yield* pages(p); }
    else if (/^index[\w-]*\.html$/.test(e.name)) yield p;
  }
}
const out = { summary: true, pages: 0, style_attrs: 0, blocks_unchanged: true, list: [] };
for (const f of pages(path.join(root, 'apps'))) {
  const html = fs.readFileSync(f, 'utf8');
  if (!/<head[\s>]/i.test(html)) continue;
  const before = blocks(html);
  // split around inline blocks: only the markup between them is touched
  let n = 0, res = '', last = 0;
  html.replace(BLOCK, (m, t, off) => { res += markup(html.slice(last, off)); res += m; last = off + m.length; return m; });
  res += markup(html.slice(last));
  function markup(s) {
    const r = rewrite(s);
    n += (r.match(/data-csp-style\s*=/g) || []).length - (s.match(/data-csp-style\s*=/g) || []).length;
    return r;
  }
  const rel = path.relative(path.dirname(f), path.join(root, shimRel)).split(path.sep).join('/');
  res = res.replace(/<head([^>]*)>/i, (m) => m + '\n    <script src="' + rel + '"></script>');
  if (JSON.stringify(blocks(res)) !== JSON.stringify(before)) { out.blocks_unchanged = false; throw new Error('inline block changed: ' + f); }
  fs.writeFileSync(f, res);
  out.pages++; out.style_attrs += n; out.list.push(path.relative(root, f) + ':' + n);
}
console.log(JSON.stringify(out));
