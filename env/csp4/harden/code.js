// csp4 hardening, parts 1 and 3 (code): the string evaluations left in web-apps once templates are precompiled,
// and the plugin system cut at build time (the integration already sets plugins: false; this makes it unconditional).
// Exact edits on the build output, each expected a known number of times: a miss stops the build (upstream moved).
// Usage: node code.js <web-apps dir>  -> JSON summary line
'use strict';
const fs = require('fs'), path = require('path');
const root = process.argv[2];

const EDITS = [
  // locale.js: a class looked up by its dotted name
  { file: 'apps/common/locale.js', n: 1,
    find: "eval(scope.name).prototype[prop]",
    repl: "scope.name.split('.').reduce(function(o, k) { return o && o[k]; }, window).prototype[prop]" },
  // Main.js (document editor): booleans kept as "true"/"false" in localStorage
  { file: 'apps/documenteditor/main/app/controller/Main.js', n: 2, find: "eval(value)", repl: "JSON.parse(value)" },
  // plugins: never loaded, from the editor config or from the server's plugins.json
  { file: 'apps/common/main/lib/controller/Plugins.js', n: 1,
    find: "        loadPlugins: function() {\n",
    repl: "        loadPlugins: function() {\n" +
          "            // Christien csp4: plugins are cut at build time (no plugin code, no eval)\n" +
          "            this.configPlugins.config = this.serverPlugins.config = undefined;\n" +
          "            this.configPlugins.plugins = this.serverPlugins.plugins = false;\n" +
          "            this.mergePlugins();\n" +
          "            return;\n" },
  { file: 'apps/common/main/lib/controller/Plugins.js', n: 1,
    find: "if ( c.code ) eval(c.code);", repl: "/* Christien csp4: no plugin code */" },
  { file: 'apps/common/main/lib/util/utils.js', n: 1,
    find: "    Common.Utils.applyCustomizationPlugins = function (plugins) {\n",
    repl: "    Common.Utils.applyCustomizationPlugins = function (plugins) {\n" +
          "        return; // Christien csp4: customization plugins are cut at build time (they were run by eval)\n" },
  { file: 'apps/common/main/lib/util/utils.js', n: 1,
    find: "eval(xhrObj.responseText);", repl: "void 0; /* Christien csp4: no plugin code */" },
  { file: 'apps/documenteditor/forms/app/controller/Plugins.js', n: 1, optional: true,
    find: "        loadPlugins: function() {\n",
    repl: "        loadPlugins: function() {\n" +
          "            // Christien csp4: plugins are cut at build time\n" +
          "            return;\n" },
];

const bundles = [];
(function find(d) {
  for (const x of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, x.name);
    if (x.isDirectory()) find(p); else if (x.name === 'code.js') bundles.push(p);
  }
})(path.join(root, 'apps'));
const out = { summary: true, edits: [] };
for (const e of EDITS) {
  const f = path.join(root, e.file);
  if (!fs.existsSync(f)) { if (e.optional) { out.edits.push(e.file + ': absent'); continue; } throw new Error('missing ' + f); }
  let s = fs.readFileSync(f, 'utf8');
  const count = s.split(e.find).length - 1;
  if (count !== e.n) throw new Error(e.file + ': expected ' + e.n + ' x ' + JSON.stringify(e.find.slice(0, 60)) + ', found ' + count);
  s = s.split(e.find).join(e.repl);
  try { new Function(s); } catch (err) { throw new Error(e.file + ': syntax broken by the edit: ' + err.message); }
  fs.writeFileSync(f, s);
  out.edits.push(e.file + ': ' + count);
  // the same module may also be concatenated into an editor's code.js bundle (lazily loaded dialogs)
  for (const b of bundles) {
    let t = fs.readFileSync(b, 'utf8');
    const c = t.split(e.find).length - 1;
    if (c) { fs.writeFileSync(b, t.split(e.find).join(e.repl)); out.edits.push(path.relative(root, b) + ': ' + c + ' (' + e.file + ')'); }
  }
}
console.log(JSON.stringify(out));
