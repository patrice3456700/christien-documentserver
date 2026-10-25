// csp4 hardening, sdkjs: no WebAssembly, so no 'wasm-unsafe-eval' either. sdkjs already ships asm.js twins of
// its wasm engines (fonts_ie.js for libfont, drawingfile_ie.js for the PDF viewer, spell_ie.js, engine_ie.js for
// hashes), loaded when the browser has no
// usable WebAssembly; the feature test is made to fail, so the twins load. Works on sources and on closure output:
//   source:  var webAsmObj = window["WebAssembly"]; if (typeof webAsmObj === "object") { ...useWasm = true... }
//   minified: u=r.WebAssembly,"object"!==typeof u||"function"!==typeof u.Memory||...||(z=!0)
// Usage: node sdkjs.js <sdkjs dir>  -> JSON summary line (every file and count; at least one per engine expected)
'use strict';
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const RULES = [
  { re: /"object"!==typeof (\w+)\|\|"function"!==typeof \1\.Memory/g, to: '!0||"function"!==typeof $1.Memory' },
  { re: /if \(typeof webAsmObj === "object"\)/g, to: 'if (false && typeof webAsmObj === "object")' },
  { re: /"object"==typeof (\w+)&&"function"==typeof \1\.Memory/g, to: '!1&&"function"==typeof $1.Memory' },   // after terser
];
const out = { summary: true, files: {} };
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.js') || /\/engine\//.test(p)) continue;        // the engines themselves stay as shipped
    let s = fs.readFileSync(p, 'utf8'), n = 0;
    if (!s.includes('WebAssembly')) continue;
    for (const r of RULES) s = s.replace(r.re, (...m) => { n++; return r.to.replace('$1', m[1]); });
    if (n) { fs.writeFileSync(p, s); out.files[path.relative(root, p)] = n; }
  }
})(root);
console.log(JSON.stringify(out));
