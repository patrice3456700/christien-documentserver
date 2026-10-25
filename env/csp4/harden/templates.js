// csp4 hardening, part 1: underscore templates without `new Function` (so the editors run without 'unsafe-eval').
//
// _.template(text) compiles text into a function with `new Function` (underscore.js, `template`). The text is
// split by three regexes (<%- %>, <%= %>, <% %>) into literal segments and code fragments; the compiled function
// only depends on the code fragments (and on settings.variable): the literals, which carry the translated
// strings and vary with the language, can be passed as data. So every "skeleton" (the ordered code fragments)
// is compiled here, at build time, into a real function in a static script, and the patched _.template looks
// the skeleton up and passes the literals. A skeleton missing from the table is an error, never an eval:
// the template fails closed and the console names it (TEMPLATE_MISS), so the table can be completed.
//
// Skeletons come from (1) every *.template / *.html file of web-apps/apps (text! templates, verbatim), (2) every
// string expression of every web-apps JS file whose value contains "<%", evaluated partially (literals,
// concatenation, template literals, [..].join(sep), both branches of ?:), unknown parts in literal position
// only, (3) env/csp4/harden/templates-recorded.json, skeletons seen at runtime (TEMPLATE_MISS) and kept.
//
// Usage: node templates.js <web-apps dir> [recorded.json]   (NODE_PATH must reach acorn)
// Prepends the table (window.__cspTemplates) to <web-apps>/vendor/underscore/underscore.js and patches its
// template(); prints a JSON summary line.
'use strict';
const fs = require('fs'), path = require('path'), acorn = require('acorn');

function visit(node, fn, scopes) {                      // every AST node, with its chain of binding maps
  scopes = scopes || [];                                 // (acorn-walk is not in web-apps' lockfile)
  if (node.type === 'Program' || FN.has(node.type)) scopes = scopes.concat([declsOf(node)]);
  fn(node, scopes);
  for (const k in node) {
    const v = node[k];
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, fn, scopes); }
      else if (typeof v.type === 'string') visit(v, fn, scopes);
    }
  }
}

const root = process.argv[2], recordedPath = process.argv[3];
const U = '';                                     // stands for any runtime value in a literal position
// underscore 1.13 defaults (web-apps never changes _.templateSettings, checked by grep)
const MATCHER = /<%-([\s\S]+?)%>|<%=([\s\S]+?)%>|<%([\s\S]+?)%>|$/g;

function skeleton(text, variable) {                     // same split as the runtime patch below
  const parts = [];
  text.replace(MATCHER, (m, esc, interp, evaluate) => {
    if (esc) parts.push('e', esc); else if (interp) parts.push('i', interp); else if (evaluate) parts.push('v', evaluate);
    return m;
  });
  return { key: (variable || '') + '\u0001' + parts.join('\u0001'), parts, variable: variable || '' };
}

// the body underscore would generate, with literal i read from __L[i] instead of being inlined
function body(sk) {
  let src = "__p+=__L[0];\n", n = 1;
  for (let i = 0; i < sk.parts.length; i += 2) {
    const kind = sk.parts[i], code = sk.parts[i + 1];
    if (kind === 'e') src += "__p+=\n((__t=(" + code + "))==null?'':_.escape(__t))+\n'';\n";
    else if (kind === 'i') src += "__p+=\n((__t=(" + code + "))==null?'':__t)+\n'';\n";
    else src += code + "\n";
    src += "__p+=__L[" + (n++) + "];\n";
  }
  const arg = sk.variable || 'obj';
  if (!sk.variable) src = 'with(obj||{}){\n' + src + '}\n';
  return 'function(' + arg + ',_,__L){\nvar __t,__p=\'\',__j=Array.prototype.join,' +
    'print=function(){__p+=__j.call(arguments,\'\');};\n' + src + 'return __p;\n}';
}

// partial evaluation of a string expression: list of possible values (U for unknown parts), or null
const CAP = 32, DEPTH = 6;
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// string-valued bindings of one function (or the program): var/let/const initializers and plain assignments,
// nested functions excluded -- enough for templates assembled from local pieces (Button.js: '...' + t + '...')
function declsOf(fn) {
  const m = new Map();
  const put = (k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  (function sc(n) {
    for (const k in n) {
      const v = n[k];
      const kids = Array.isArray(v) ? v : (v && typeof v.type === 'string' ? [v] : []);
      for (const c of kids) {
        if (!c || typeof c.type !== 'string' || FN.has(c.type)) continue;
        if (c.type === 'VariableDeclarator' && c.id.type === 'Identifier' && c.init) put(c.id.name, c.init);
        if (c.type === 'AssignmentExpression' && c.operator === '=' && c.left.type === 'Identifier') put(c.left.name, c.right);
        sc(c);
      }
    }
  })(fn.type === 'Program' ? fn : fn.body);
  return m;
}
function strs(node, scopes, depth) {
  if (!node) return null;
  scopes = scopes || []; depth = depth || 0;
  switch (node.type) {
    case 'Identifier': {
      if (depth >= DEPTH) return null;
      for (let i = scopes.length - 1; i >= 0; i--) {
        const inits = scopes[i].get(node.name);
        if (!inits) continue;
        let out = [];
        for (const init of inits) {
          const v = strs(init, scopes.slice(0, i + 1), depth + 1);
          out = out.concat(v || [U]);
        }
        return out.slice(0, CAP);
      }
      return null;
    }
    case 'Literal': return typeof node.value === 'string' ? [node.value] : null;
    case 'TemplateLiteral': {
      let out = [''];
      node.quasis.forEach((q, i) => {
        out = out.map(s => s + q.value.cooked);
        if (i < node.expressions.length) out = out.map(s => s + U);
      });
      return out;
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return null;
      const l = strs(node.left, scopes, depth), r = strs(node.right, scopes, depth);
      if (!l && !r) return null;
      return cross(l || [U], r || [U]);
    }
    case 'ConditionalExpression': {
      const a = strs(node.consequent, scopes, depth), b = strs(node.alternate, scopes, depth);
      if (!a && !b) return null;
      return (a || [U]).concat(b || [U]).slice(0, CAP);
    }
    case 'CallExpression': {
      const c = node.callee;
      if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'join') {
        const av = arrs(c.object, scopes, depth);
        if (!av) return null;
        const sepv = node.arguments.length ? strs(node.arguments[0], scopes, depth) : [','];
        const sep = sepv && sepv.length === 1 ? sepv[0] : U;
        let res = [];
        for (const arr of av) {
          let out = [''];
          arr.forEach((el, i) => { if (i) out = out.map(x => x + sep); out = cross(out, el); });
          res = res.concat(out);
          if (res.length >= CAP) break;
        }
        return res.slice(0, CAP);
      }
      return null;
    }
    default: return null;
  }
}
// arrays of text pieces: literal arrays, .concat(...) chains, bindings. A value is a list of possible arrays,
// each array a list of elements, each element a list of possible strings.
function arrs(node, scopes, depth) {
  if (!node || depth >= DEPTH) return null;
  switch (node.type) {
    case 'ArrayExpression':
      return [node.elements.map(el => (el && el.type !== 'SpreadElement' && strs(el, scopes, depth)) || [U])];
    case 'Identifier': {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const inits = scopes[i].get(node.name);
        if (!inits) continue;
        let out = [];
        for (const init of inits) { const v = arrs(init, scopes.slice(0, i + 1), depth + 1); if (v) out = out.concat(v); }
        return out.length ? out.slice(0, CAP) : null;
      }
      return null;
    }
    case 'CallExpression': {
      const c = node.callee;
      if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'concat') {
        let base = arrs(c.object, scopes, depth);
        if (!base) return null;
        for (const arg of node.arguments) {
          const av = arrs(arg, scopes, depth);
          const next = [];
          for (const b of base) {
            if (av) for (const a of av) next.push(b.concat(a));
            else next.push(b.concat([strs(arg, scopes, depth) || [U]]));
            if (next.length >= CAP) break;
          }
          base = next;
        }
        return base;
      }
      return null;
    }
    default: return null;
  }
}
function cross(a, b) {
  const out = [];
  for (const x of a) for (const y of b) { out.push(x + y); if (out.length >= CAP) return out; }
  return out;
}

function* files(dir, test) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p, test); else if (test(p)) yield p;
  }
}

const table = new Map(), stats = { files_js: 0, parse_fail: 0, from_text: 0, from_js: 0, from_recorded: 0,
                                    dynamic_code: 0, dynamic_bool: 0, invalid: 0 };
const dynamicSamples = [];
function add(text, origin, variable) {
  const sk = skeleton(text, variable);
  if (sk.parts.length === 0) return;                    // no code: nothing to compile, still needs an entry
  if (sk.parts.some((p, i) => i % 2 && p.includes(U))) {  // a runtime value inside a code fragment
    // booleans spliced into code ('<% if (' + this.showShortcutKey + ') { %>'): compile both values
    const holes = (text.match(new RegExp(U, 'g')) || []).length;
    if (holes <= 3 && !variable && !text.includes('\u0001')) {
      // (holes in literal positions get a value too: harmless, literals are data)
      for (let mask = 0; mask < (1 << holes); mask++) {
        let k = 0;
        add(text.replace(new RegExp(U, 'g'), () => (mask >> (k++)) & 1 ? 'true' : 'false'), origin + ' (bool)', variable);
      }
      stats.dynamic_bool++;
      return;
    }
    stats.dynamic_code++; if (dynamicSamples.length < 20) dynamicSamples.push(origin + ': ' + text.slice(0, 120));
    return;
  }
  if (table.has(sk.key)) return;
  const src = body(sk);
  try { new Function('return ' + src); } catch (e) { stats.invalid++; return; }   // fragments of a larger template
  table.set(sk.key, src); stats[origin.split(':')[0]]++;
}

const apps = path.join(root, 'apps');
for (const f of files(apps, p => /\.(template|html)$/.test(p) && !/\/resources\/help\//.test(p))) {
  const t = fs.readFileSync(f, 'utf8');
  if (t.includes('<%')) add(t, 'from_text:' + path.relative(root, f));
}
for (const f of files(apps, p => p.endsWith('.js') && !/\/mobile\/|\/resources\/help\//.test(p))) {
  const code = fs.readFileSync(f, 'utf8');
  if (!code.includes('<%')) continue;
  stats.files_js++;
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); }
  catch (e) {
    try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }); }
    catch (e2) { stats.parse_fail++; console.error('PARSE_FAIL ' + f + ' ' + e2.message); continue; }
  }
  visit(ast, (node, scopes) => {
    if (node.type === 'Identifier') return;              // only expressions that build text
    const v = strs(node, scopes);
    if (v) for (const s of v) if (s.includes('<%')) add(s, 'from_js:' + path.relative(root, f));
  });
}
if (recordedPath && fs.existsSync(recordedPath))
  for (const r of JSON.parse(fs.readFileSync(recordedPath, 'utf8')))
    add(r.text, 'from_recorded:' + (r.where || ''), r.variable);

// the table: a plain script, one property per skeleton (keys as JSON strings)
let out = '/* Precompiled underscore templates (Christien, csp4 hardening: no new Function, no unsafe-eval). */\n' +
          'window.__cspTemplates={\n';
for (const [k, src] of table) out += JSON.stringify(k) + ':' + src + ',\n';
out += '};\n';

// the runtime side: underscore's template() keeps its split, drops new Function
const uPath = path.join(root, 'vendor/underscore/underscore.js');
let u = fs.readFileSync(uPath, 'utf8');
const A = "      render = new Function(argument, '_', source);";
if (!u.includes(A)) throw new Error('underscore.js: new Function line not found (version changed?)');
const B = "      render = __cspRender(text, settings, matcher);";
u = u.replace(A, B);
const HOOK = "  function template(text, settings, oldSettings) {";
if (!u.includes(HOOK)) throw new Error('underscore.js: template() not found');
u = u.replace(HOOK, `  // Christien csp4: compiled templates come from window.__cspTemplates (top of this file),
  // built from every template of web-apps; the literal segments are passed as data. No new Function.
  function __cspRender(text, settings, matcher) {
    var parts = [], lits = [], index = 0;
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      lits.push(text.slice(index, offset));
      index = offset + match.length;
      if (escape) parts.push('e', escape); else if (interpolate) parts.push('i', interpolate);
      else if (evaluate) parts.push('v', evaluate);
      return match;
    });
    if (!parts.length) return function() { return lits.join(''); };
    var key = (settings.variable || '') + '\\u0001' + parts.join('\\u0001');
    var fn = window.__cspTemplates && window.__cspTemplates[key];
    if (!fn) {
      if (window.console) console.error('TEMPLATE_MISS ' + JSON.stringify({variable: settings.variable || '', text: text}));
      throw new Error('template not precompiled');
    }
    return function(data, __) { return fn.call(this, data, __, lits); };
  }

` + HOOK);
fs.writeFileSync(uPath, out + u);              // the table travels with underscore: no page change
console.log(JSON.stringify({ summary: true, skeletons: table.size, ...stats, bytes: Buffer.byteLength(out),
                             dynamic_samples: dynamicSamples }));
