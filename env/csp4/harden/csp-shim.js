/* Christien csp4 hardening, part 2: the editors without 'unsafe-inline' in style-src.
 *
 * A Content-Security-Policy without 'unsafe-inline' for styles blocks three things the editors rely on:
 * style="..." attributes reaching the HTML parser (innerHTML, insertAdjacentHTML, the page itself), the
 * attribute set by setAttribute('style', ...), and <style> elements created by script. It does not block the
 * CSSOM (element.style, CSSStyleSheet). This script, loaded first in <head> of every editor page, routes the
 * three onto the CSSOM, with the same cascade:
 *  - HTML strings: style= is renamed data-csp-style= before parsing, then applied as element.style.cssText
 *    right after, synchronously (callers often measure the new nodes at once); a MutationObserver applies
 *    the static attributes of the page (renamed at build time) and anything inserted another way;
 *  - setAttribute('style', v) becomes element.style.cssText = v;
 *  - a <style> element keeps its place in <head> (ids are looked up) but its text goes to a constructed
 *    stylesheet in document.adoptedStyleSheets, kept in sync with later writes and dropped on removal.
 * Nothing here evaluates code. Logos and attributions are untouched; this only changes how styles are applied.
 */
(function () {
  'use strict';
  var A = 'data-csp-style';
  var D = document;

  // --- HTML strings ---------------------------------------------------------------------------------------
  // a tag: name, then anything up to the closing >; as in the HTML parser, a quote delimits a value only after =
  // (a stray quote, as in upstream's `style="flex-grow:1;" "`, is part of an attribute name)
  var TAG = /<([a-zA-Z][\w:-]*)((?:[^>"'=]|=\s*"[^"]*"|=\s*'[^']*'|=|["'])*)>/g;
  // outside values, an attribute named style (after whitespace, a slash, or right after a value or stray quote)
  function renameStyle(attrs) {
    var out = '', i = 0, n = attrs.length, prev = ' ', last = ' ';
    while (i < n) {
      var c = attrs.charAt(i);
      if ((c === '"' || c === "'") && last === '=') {
        var j = attrs.indexOf(c, i + 1); if (j < 0) j = n - 1;
        out += attrs.slice(i, j + 1); i = j + 1; prev = c; last = c; continue;
      }
      if ((c === 's' || c === 'S') && /[\s\/"']/.test(prev) && /^style\s*=/i.test(attrs.slice(i, i + 12))) {
        out += A; i += 5; prev = 'e'; last = 'e'; continue;
      }
      out += c; prev = c; if (!/\s/.test(c)) last = c; i++;
    }
    return out;
  }
  function rewrite(html) {
    if (typeof html !== 'string' || !/style\s*=/i.test(html)) return html;
    return html.replace(TAG, function (m, name, attrs) {
      return /style\s*=/i.test(attrs) ? '<' + name + renameStyle(attrs) + '>' : m;
    });
  }
  function fix(el) {
    var v = el.getAttribute(A);
    el.removeAttribute(A);
    if (v) el.style.cssText = v;
  }
  function apply(root) {
    if (!root) return;
    if (root.nodeType === 11 || root.nodeType === 1 || root.nodeType === 9) {
      if (root.nodeType === 1 && root.hasAttribute(A)) fix(root);
      if (root.content && root.content.nodeType === 11) apply(root.content);       // <template>
      var l = root.querySelectorAll ? root.querySelectorAll('[' + A + ']') : [];
      for (var i = 0; i < l.length; i++) fix(l[i]);
    }
  }

  function wrapSetter(proto, prop, after) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { after(this, d, v); }
    });
  }
  wrapSetter(Element.prototype, 'innerHTML', function (el, d, v) {
    if (el instanceof HTMLStyleElement) return styleText(el, v, function () { d.set.call(el, v); });
    if (el instanceof HTMLScriptElement) return d.set.call(el, v);
    d.set.call(el, rewrite(v)); apply(el);
  });
  wrapSetter(Element.prototype, 'outerHTML', function (el, d, v) {
    var p = el.parentNode, next = el.nextSibling, prev = el.previousSibling;
    d.set.call(el, rewrite(v));
    if (p) for (var n = prev ? prev.nextSibling : p.firstChild; n && n !== next; n = n.nextSibling) apply(n);
  });
  if (window.ShadowRoot) wrapSetter(ShadowRoot.prototype, 'innerHTML', function (sr, d, v) { d.set.call(sr, rewrite(v)); apply(sr); });

  var iah = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) {
    var p = this.parentNode;
    iah.call(this, pos, rewrite(html));
    apply(/^(beforebegin|afterend)$/i.test(pos) && p ? p : this);
  };
  var ccf = Range.prototype.createContextualFragment;
  Range.prototype.createContextualFragment = function (html) {
    var f = ccf.call(this, rewrite(html)); apply(f); return f;
  };
  // markup parsed elsewhere then imported (svg sprites: DOMParser + document.importNode)
  var pfs = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function (s, type) { return pfs.call(this, rewrite(s), type); };
  var imp = Document.prototype.importNode;
  Document.prototype.importNode = function (n, deep) { var r = imp.call(this, n, deep); apply(r); return r; };

  // --- setAttribute('style', ...) ---------------------------------------------------------------------------
  var sa = Element.prototype.setAttribute, sans = Element.prototype.setAttributeNS;
  Element.prototype.setAttribute = function (n, v) {
    if (typeof n === 'string' && n.toLowerCase() === 'style') { this.style.cssText = String(v); return; }
    return sa.call(this, n, v);
  };
  Element.prototype.setAttributeNS = function (ns, n, v) {
    if (!ns && typeof n === 'string' && n.toLowerCase() === 'style') { this.style.cssText = String(v); return; }
    return sans.call(this, ns, n, v);
  };

  // --- <style> elements created by script --------------------------------------------------------------------
  var canAdopt = 'adoptedStyleSheets' in D && typeof CSSStyleSheet === 'function';
  var sheets = new WeakMap();
  function attach(el, css) {
    var s = sheets.get(el);
    if (!s) { s = new CSSStyleSheet(); sheets.set(el, s); }
    s.replaceSync(css);
    if (D.adoptedStyleSheets.indexOf(s) < 0) D.adoptedStyleSheets = D.adoptedStyleSheets.concat([s]);
  }
  function detach(el) {
    var s = sheets.get(el);
    if (s) D.adoptedStyleSheets = D.adoptedStyleSheets.filter(function (x) { return x !== s; });
  }
  // the element keeps no text, so the browser has no inline style to refuse; its css lives in the sheet
  function styleText(el, css, setNative) {
    if (!canAdopt) return setNative();
    el.__cspCss = String(css == null ? '' : css);
    if (el.isConnected) attach(el, el.__cspCss);
  }
  if (canAdopt) {
    wrapSetter(HTMLStyleElement.prototype, 'textContent', function (el, d, v) { styleText(el, v, function () { d.set.call(el, v); }); });
    wrapSetter(Node.prototype, 'textContent', function (n, d, v) {
      if (n instanceof HTMLStyleElement) return styleText(n, v, function () { d.set.call(n, v); });
      d.set.call(n, v);
    });
    wrapSetter(HTMLElement.prototype, 'innerText', function (el, d, v) {
      if (el instanceof HTMLStyleElement) return styleText(el, v, function () { d.set.call(el, v); });
      d.set.call(el, v);
    });
    // text appended as child nodes (style.appendChild(document.createTextNode(css)))
    var ac = Node.prototype.appendChild;
    Node.prototype.appendChild = function (c) {
      if (this instanceof HTMLStyleElement && c && c.nodeType === 3) {
        styleText(this, (this.__cspCss || '') + c.data); return c;
      }
      var r = ac.call(this, c);
      connected(c);
      return r;
    };
    var ib = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (c, ref) { var r = ib.call(this, c, ref); connected(c); return r; };
    ['append', 'prepend', 'before', 'after', 'replaceWith'].forEach(function (m) {
      var f = Element.prototype[m];
      if (f) Element.prototype[m] = function () {
        var r = f.apply(this, arguments);
        for (var i = 0; i < arguments.length; i++) if (arguments[i] && arguments[i].nodeType) connected(arguments[i]);
        return r;
      };
    });
  }
  function connected(n) {
    if (!n || n.nodeType !== 1) return;
    if (n instanceof HTMLStyleElement) { if (n.__cspCss != null && n.isConnected) attach(n, n.__cspCss); return; }
    if (n.getElementsByTagName) {
      var l = n.getElementsByTagName('style');
      for (var i = 0; i < l.length; i++) if (l[i].__cspCss != null && l[i].isConnected) attach(l[i], l[i].__cspCss);
    }
    apply(n);
  }

  // --- the page itself, and whatever arrives another way ------------------------------------------------------
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      for (var j = 0; j < r.addedNodes.length; j++) { var n = r.addedNodes[j]; if (n.nodeType === 1) connected(n); }
      for (var k = 0; k < r.removedNodes.length; k++) {
        var m = r.removedNodes[k];
        if (m instanceof HTMLStyleElement && !m.isConnected) detach(m);
        else if (m.getElementsByTagName) { var s = m.getElementsByTagName('style'); for (var q = 0; q < s.length; q++) if (!s[q].isConnected) detach(s[q]); }
      }
    }
  }).observe(D.documentElement, { childList: true, subtree: true });
  apply(D);
})();
