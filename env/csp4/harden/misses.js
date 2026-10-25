// TEMPLATE_MISS lines of recette logs -> still missing from the table? With --record <json>, add the missing ones to
// the recorded list read by templates.js (deduplicated by skeleton).
// Usage: node misses.js <underscore.js with table> <log.jsonl>... [--record recorded.json]
'use strict';
const fs = require('fs'), vm = require('vm');
const args = process.argv.slice(2);
const ri = args.indexOf('--record'), rec = ri >= 0 ? args.splice(ri, 2)[1] : null;
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(args[0], 'utf8').split('(function (global, factory)')[0], ctx);
const table = ctx.window.__cspTemplates;
const MATCHER = /<%-([\s\S]+?)%>|<%=([\s\S]+?)%>|<%([\s\S]+?)%>|$/g;
const key = (t, v) => { const p = []; t.replace(MATCHER, (m, e, i, ev) => { if (e) p.push('e', e); else if (i) p.push('i', i); else if (ev) p.push('v', ev); return m; }); return (v || '') + '\u0001' + p.join('\u0001'); };
const seen = new Map();
for (const f of args.slice(1)) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let d; try { d = JSON.parse(line); } catch (e) { continue; }
  if (d.summary) continue;
  for (const x of (d.errors || []).concat(d.csp || [])) {
    const i = x.indexOf('TEMPLATE_MISS ');
    if (i < 0) continue;
    let m; try { m = JSON.parse(x.slice(i + 14)); } catch (e) { continue; }   // truncated by the probe: skip
    const k = key(m.text, m.variable);
    if (!seen.has(k)) seen.set(k, { text: m.text, variable: m.variable, where: f, present: k in table });
  }
}
const missing = [...seen.values()].filter(x => !x.present);
console.log(JSON.stringify({ misses: seen.size, still_missing: missing.length, samples: missing.slice(0, 5).map(x => x.text.slice(0, 100)) }));
if (rec) {
  const old = fs.existsSync(rec) ? JSON.parse(fs.readFileSync(rec, 'utf8')) : [];
  const ks = new Set(old.map(x => key(x.text, x.variable)));
  for (const x of missing) if (!ks.has(key(x.text, x.variable))) { old.push({ text: x.text, variable: x.variable, where: x.where }); ks.add(key(x.text, x.variable)); }
  fs.writeFileSync(rec, JSON.stringify(old, null, 1));
}
