#!/usr/bin/env node
// Minify, in place, every .js file under the given directories with terser (the copy pinned by web-apps' own
// lockfile), because the 9.4 builds ship sdkjs and web-apps as plain concatenated or copied sources.
// HTML is never touched, so the inline blocks pinned by the CSP keep their hashes.
// Licence notices are kept: the leading "Copyright" comment of each file becomes the preamble, and
// /*! … */, @license and @preserve comments (third-party libraries) survive.
// Usage: node minify.js <dir>... -> one JSON line per file, then a summary line. Exit 1 if any file failed.
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ALREADY_MIN_MEAN_LINE = 300;   // a file whose non-empty lines average more than this is left alone
// type declarations the macro editor (monaco) reads as text for autocompletion: not JavaScript, never executed
const EXCLUDE = /\/vendor\/monaco\/libs\//;

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.isFile() && p.endsWith('.js') && !EXCLUDE.test(p)) out.push(p);
    }
    return out;
}

function leadingLicence(code) {
    const m = code.match(/^\s*(\/\*[\s\S]*?\*\/)/);
    return m && /copyright|licen[cs]e/i.test(m[1]) ? m[1] : null;
}

async function one(file) {
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split('\n').filter(l => l.trim()).length || 1;
    if (code.length / lines > ALREADY_MIN_MEAN_LINE) return { file, skipped: 'already-minified', bytes: code.length };
    const preamble = leadingLicence(code);
    const res = await minify(code, {
        ecma: 2020, module: false, toplevel: false,
        compress: { passes: 1 },
        mangle: true,
        keep_classnames: true, keep_fnames: true,     // code may still read constructor or function names
        format: { comments: 'some', preamble: preamble || undefined },
    });
    fs.writeFileSync(file, res.code + '\n');
    return { file, before: Buffer.byteLength(code), after: Buffer.byteLength(res.code) + 1 };
}

(async () => {
    const files = process.argv.slice(2).flatMap(d => walk(d, []));
    let before = 0, after = 0, failed = 0, skipped = 0;
    for (const f of files) {
        try {
            const r = await one(f);
            if (r.skipped) { skipped++; before += r.bytes; after += r.bytes; }
            else { before += r.before; after += r.after; }
            console.log(JSON.stringify(r));
        } catch (e) {
            failed++;
            console.log(JSON.stringify({ file: f, error: String(e.message || e).slice(0, 300) }));
        }
    }
    console.log(JSON.stringify({ summary: true, files: files.length, skipped, failed, before, after }));
    process.exit(failed ? 1 : 0);
})();
