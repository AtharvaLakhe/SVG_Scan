/*!
 * SVG Scan code generators
 * https://github.com/AtharvaLakhe/SVG_Scan
 *
 * Cleans an SVG (editor cruft, rounding, compact path data) and prints it as
 * optimized SVG, React, React Native, Vue, CSS, a data URI or an Android
 * VectorDrawable. Browser only: parsing uses DOMParser.
 * MIT License
 */
(function (root) {
  'use strict';

  var EDITOR_ATTR = /^(?:xmlns:)?(?:inkscape|sodipodi|sketch|serif|figma|bx|dc|cc|rdf)(?::|$)/i;
  var DROP_TAG = /^(?:metadata|sodipodi:.*|inkscape:.*|rdf:.*)$/i;
  var DROP_ROOT_ATTR = { version: 1, 'xml:space': 1, 'enable-background': 1, 'xmlns:xlink': 1 };
  var NUMERIC = { x: 1, y: 1, width: 1, height: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, x1: 1, y1: 1, x2: 1, y2: 1, fx: 1, fy: 1,
    'stroke-width': 1, 'font-size': 1, 'stroke-miterlimit': 1, 'stroke-dashoffset': 1 };
  var FRACTION = { opacity: 1, 'fill-opacity': 1, 'stroke-opacity': 1, 'stop-opacity': 1, offset: 1 };
  var LISTS = { viewBox: 1, points: 1, transform: 1, 'stroke-dasharray': 1, gradientTransform: 1, patternTransform: 1 };

  /* ---------- parse ---------- */

  function parse(text) {
    var doc = new DOMParser().parseFromString(String(text).trim(), 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error("That markup didn't parse as SVG. Look for an unclosed tag or a stray character.");
    }
    var el = doc.documentElement;
    if (!el || el.localName !== 'svg') throw new Error('Start your markup with an <svg> tag.');
    return build(el, true);
  }

  function build(el, isRoot) {
    var node = { name: el.nodeName, attrs: [], children: [] };
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (EDITOR_ATTR.test(a.name)) continue;
      if (isRoot && (DROP_ROOT_ATTR[a.name] || ((a.name === 'x' || a.name === 'y') && parseFloat(a.value) === 0))) continue;
      node.attrs.push([a.name, a.value]);
    }
    for (i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 1) {
        if (!DROP_TAG.test(c.nodeName)) node.children.push(build(c, false));
      } else if ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.trim()) {
        node.children.push({ text: c.nodeValue.trim().replace(/\s+/g, ' ') });
      }
    }
    return node;
  }

  function get(node, k) { for (var i = 0; i < node.attrs.length; i++) if (node.attrs[i][0] === k) return node.attrs[i][1]; return null; }
  function set(node, k, v) {
    for (var i = 0; i < node.attrs.length; i++) if (node.attrs[i][0] === k) { node.attrs[i][1] = v; return; }
    node.attrs.push([k, v]);
  }

  /* ---------- optimize ---------- */

  function dims(tree) {
    var vb = (get(tree, 'viewBox') || '').split(/[\s,]+/).map(parseFloat);
    var w = parseFloat(get(tree, 'width')), h = parseFloat(get(tree, 'height'));
    if (/%/.test(get(tree, 'width') || '')) w = NaN;
    if (/%/.test(get(tree, 'height') || '')) h = NaN;
    if (vb.length !== 4 || vb.some(isNaN)) vb = [0, 0, w || 24, h || 24];
    return { vb: vb, w: w || vb[2], h: h || vb[3] };
  }

  function autoPrecision(tree) {
    var d = dims(tree), size = Math.max(d.vb[2], d.vb[3]);
    return size >= 500 ? 1 : size >= 50 ? 2 : 3;
  }

  function optimize(tree, prec, currentColor) {
    var d = dims(tree);
    if (!get(tree, 'viewBox')) set(tree, 'viewBox', d.vb.join(' '));
    if (!get(tree, 'xmlns')) tree.attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
    var usesXlink = false;
    walk(tree, function (n) {
      n.attrs = n.attrs.map(function (a) {
        var k = a[0], v = a[1];
        if (k.indexOf('xlink:') === 0) usesXlink = true;
        if (k === 'd') v = optimizePath(v, prec);
        else if (NUMERIC[k]) v = roundAll(v, prec);
        else if (FRACTION[k]) v = roundAll(v, Math.max(prec, 2));
        else if (LISTS[k]) v = roundAll(v, k.indexOf('ransform') > 0 ? Math.max(prec, 3) : prec).replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
        else if (k === 'style') v = stringifyStyle(parseStyle(v));
        return [k, v];
      }).filter(function (a) { return a[1] !== '' || a[0] === 'd'; });
      if (currentColor) recolor(n);
      n.children = unwrap(n.children);
    });
    // Editor-generated ids (defs2, path817...) nothing points at are dead weight.
    var refs = {};
    walk(tree, function (n) {
      n.attrs.forEach(function (a) {
        var re = /(?:url\(\s*['"]?#|^#)([^'")\s]+)/g, m;
        while ((m = re.exec(a[1]))) refs[m[1]] = 1;
      });
      n.children.forEach(function (c) {
        if (c.text != null && n.name === 'style') (c.text.match(/#[\w-]+/g) || []).forEach(function (r) { refs[r.slice(1)] = 1; });
      });
    });
    walk(tree, function (n) {
      if (n !== tree) n.attrs = n.attrs.filter(function (a) { return a[0] !== 'id' || refs[a[1]]; });
    });
    if (usesXlink) set(tree, 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (currentColor && !get(tree, 'fill')) set(tree, 'fill', 'currentColor');
    return tree;
  }

  function walk(n, fn) { if (n.text != null) return; fn(n); n.children.forEach(function (c) { walk(c, fn); }); }

  // Attribute-less groups are noise; empty groups and defs are dead weight.
  function unwrap(children) {
    var out = [];
    children.forEach(function (c) {
      if (c.text == null && (c.name === 'g' || c.name === 'defs') && !c.children.length) return;
      if (c.text == null && c.name === 'g' && !c.attrs.length) out.push.apply(out, unwrap(c.children));
      else out.push(c);
    });
    return out;
  }

  function isPaint(v) { return v && !/^(none|transparent|currentColor|inherit)$/i.test(v.trim()) && !/^url\(/i.test(v.trim()); }
  function recolor(n) {
    n.attrs.forEach(function (a) {
      if ((a[0] === 'fill' || a[0] === 'stroke') && isPaint(a[1])) a[1] = 'currentColor';
      if (a[0] === 'style') {
        a[1] = stringifyStyle(parseStyle(a[1]).map(function (p) {
          return (p[0] === 'fill' || p[0] === 'stroke') && isPaint(p[1]) ? [p[0], 'currentColor'] : p;
        }));
      }
    });
  }

  function roundNum(v, prec) { var k = Math.pow(10, prec); return Math.round(v * k) / k; }
  function fmt(v) {
    if (v === 0) return '0';
    var s = String(v);
    if (s.indexOf('e') >= 0) s = v.toFixed(6).replace(/\.?0+$/, '');
    if (s.slice(0, 2) === '0.') return s.slice(1);
    if (s.slice(0, 3) === '-0.') return '-' + s.slice(2);
    return s;
  }
  function roundAll(s, prec) {
    return String(s).replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, function (m) { return fmt(roundNum(parseFloat(m), prec)); });
  }

  function parseStyle(s) {
    return String(s).split(';').map(function (d) {
      var i = d.indexOf(':');
      return i < 0 ? null : [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }).filter(function (p) { return p && p[0] && p[1] && !/^-inkscape-/.test(p[0]); });
  }
  function stringifyStyle(list) { return list.map(function (p) { return p[0] + ':' + p[1]; }).join(';'); }

  /* ---------- path data ---------- */

  var PARAMS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  var NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

  function parsePath(d) {
    var out = [], i = 0, n = d.length, cmd = null;
    function skip() { while (i < n && /[\s,]/.test(d[i])) i++; }
    for (;;) {
      skip();
      if (i >= n) break;
      var ch = d[i];
      if (/[A-Za-z]/.test(ch)) {
        if (!(ch.toLowerCase() in PARAMS)) throw new Error('Unknown path command "' + ch + '".');
        cmd = ch; i++;
        if (ch === 'z' || ch === 'Z') { out.push([ch]); continue; }
      } else if (!cmd || cmd === 'z' || cmd === 'Z') {
        throw new Error('Path data has a number where a command should be.');
      }
      var lc = cmd.toLowerCase(), seg = [cmd];
      for (var j = 0; j < PARAMS[lc]; j++) {
        skip();
        if (lc === 'a' && (j === 3 || j === 4)) { seg.push(d[i] === '1' ? 1 : 0); i++; continue; }
        NUM_RE.lastIndex = i;
        var m = NUM_RE.exec(d);
        if (!m) throw new Error('Path data ends in the middle of a command.');
        seg.push(parseFloat(m[0])); i = NUM_RE.lastIndex;
      }
      out.push(seg);
      if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    }
    return out;
  }

  function optimizePath(d, prec) {
    var segs;
    try { segs = parsePath(d); } catch (e) { return String(d).trim(); }
    var s = '', implicit = '', prev = '';
    segs.forEach(function (seg) {
      var c = seg[0];
      if (c !== implicit || c === 'z' || c === 'Z') { s += c; prev = ''; }
      for (var k = 1; k < seg.length; k++) {
        var t = fmt(roundNum(seg[k], prec));
        if (prev && t[0] !== '-' && !(t[0] === '.' && prev.indexOf('.') >= 0)) s += ' ';
        s += t; prev = t;
      }
      implicit = c === 'M' ? 'L' : c === 'm' ? 'l' : c;
    });
    return s;
  }

  /* ---------- printers ---------- */

  function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escText(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function minify(n) {
    if (n.text != null) return escText(n.text);
    var a = n.attrs.map(function (p) { return ' ' + p[0] + '="' + escAttr(p[1]) + '"'; }).join('');
    if (!n.children.length) return '<' + n.name + a + '/>';
    return '<' + n.name + a + '>' + n.children.map(minify).join('') + '</' + n.name + '>';
  }

  // o: { tag(name), attr(k, v) -> string|null, text(t, parent), close: '/>' | ' />', extra: root-only attribute }
  function pretty(n, o, depth, base) {
    var pad = base + '  '.repeat(depth);
    if (n.text != null) return pad + o.text(n.text);
    var name = o.tag(n.name);
    if (!name) return null;
    var attrs = n.attrs.map(function (p) { return o.attr(p[0], p[1], n); }).filter(Boolean);
    if (depth === 0 && o.extra) attrs.push(o.extra);
    var line = pad + '<' + name + (attrs.length ? ' ' + attrs.join(' ') : '');
    var multi = attrs.length > 1 && line.length > 96;
    var open = multi ? pad + '<' + name + '\n' + attrs.map(function (a) { return pad + '  ' + a; }).join('\n') + '\n' + pad : line;
    var kids = n.children.map(function (c) { return pretty(c, o, depth + 1, base); }).filter(function (c) { return c != null; });
    if (!kids.length) return open + (multi ? o.close.trim() : o.close);
    if (n.children.length === 1 && n.children[0].text != null && kids[0].trim().length < 60 && !multi) {
      return open + '>' + kids[0].trim() + '</' + name + '>';
    }
    return open + '>\n' + kids.join('\n') + '\n' + pad + '</' + name + '>';
  }

  var xmlOpts = {
    tag: function (t) { return t; },
    attr: function (k, v) { return k + '="' + escAttr(v) + '"'; },
    text: escText,
    close: '/>'
  };

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }
  function jsxName(k) {
    if (k === 'class') return 'className';
    if (k === 'for') return 'htmlFor';
    if (/^(data|aria)-/.test(k)) return k;
    var i = k.indexOf(':');
    if (i > 0) return k.slice(0, i) + k[i + 1].toUpperCase() + k.slice(i + 2);
    return camel(k);
  }
  function styleObject(v) {
    return '{{ ' + parseStyle(v).map(function (p) {
      var val = p[1], key = p[0].indexOf('--') === 0 ? JSON.stringify(p[0]) : camel(p[0]);
      return key + ': ' + (/^-?\d*\.?\d+$/.test(val) ? val : JSON.stringify(val));
    }).join(', ') + ' }}';
  }
  function jsxText(t) { return /[{}<>]/.test(t) ? '{' + JSON.stringify(t) + '}' : t; }

  function jsxOpts(extra) {
    return {
      tag: function (t) { return t; },
      attr: function (k, v) {
        if (k === 'style') return 'style=' + styleObject(v);
        return jsxName(k) + '="' + escAttr(v) + '"';
      },
      text: jsxText,
      close: ' />',
      extra: extra
    };
  }

  var RN_TAGS = { svg: 'Svg', path: 'Path', g: 'G', circle: 'Circle', ellipse: 'Ellipse', rect: 'Rect', line: 'Line',
    polyline: 'Polyline', polygon: 'Polygon', text: 'Text', tspan: 'TSpan', defs: 'Defs', linearGradient: 'LinearGradient',
    radialGradient: 'RadialGradient', stop: 'Stop', clipPath: 'ClipPath', mask: 'Mask', use: 'Use', symbol: 'Symbol',
    pattern: 'Pattern', image: 'Image', marker: 'Marker', textPath: 'TextPath', foreignObject: 'ForeignObject' };

  // react-native-svg ignores CSS style strings, so inline declarations become props.
  function inlineStyles(n) {
    if (n.text != null) return n;
    var attrs = [];
    n.attrs.forEach(function (a) {
      if (a[0] === 'style') parseStyle(a[1]).forEach(function (p) { attrs.push(p); });
      else if (a[0] !== 'class' && a[0].indexOf('xmlns') !== 0) attrs.push(a);
    });
    return { name: n.name, attrs: attrs, children: n.children.map(inlineStyles) };
  }

  /* ---------- formats ---------- */

  function pascal(s) {
    var p = String(s || '').replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
      .map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : ''; }).join('');
    if (!p) return 'Icon';
    return /^\d/.test(p) ? 'Svg' + p : p;
  }
  function kebab(s) { return pascal(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }

  function base64(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function urlEncode(svg) {
    return svg.replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')
      .replace(/\{/g, '%7B').replace(/\}/g, '%7D').replace(/\s+/g, ' ');
  }

  var FORMATS = {
    svg: function (tree) {
      return { code: pretty(tree, xmlOpts, 0, '') + '\n', lang: 'xml', ext: 'svg' };
    },
    react: function (tree, o) {
      var body = pretty(tree, jsxOpts('{...props}'), 0, '    ');
      var code = o.ts
        ? 'import type { SVGProps } from "react";\n\nexport default function ' + o.name + '(props: SVGProps<SVGSVGElement>) {\n'
        : 'export default function ' + o.name + '(props) {\n';
      code += '  return (\n' + body + '\n  );\n}\n';
      return { code: code, lang: 'jsx', ext: o.ts ? 'tsx' : 'jsx' };
    },
    native: function (tree, o) {
      var used = {}, opts = jsxOpts('{...props}');
      opts.tag = function (t) {
        if (t === 'title' || t === 'desc' || t === 'style') return null;
        var c = RN_TAGS[t] || null;
        if (c) used[c] = 1;
        return c;
      };
      var body = pretty(inlineStyles(tree), opts, 0, '    ');
      var named = Object.keys(used).filter(function (k) { return k !== 'Svg'; }).sort();
      var code = 'import Svg' + (named.length ? ', { ' + named.join(', ') + ' }' : '') + ' from "react-native-svg";\n';
      if (o.ts) code += 'import type { SvgProps } from "react-native-svg";\n';
      code += '\nexport default function ' + o.name + '(props' + (o.ts ? ': SvgProps' : '') + ') {\n  return (\n' + body + '\n  );\n}\n';
      return { code: code, lang: 'jsx', ext: o.ts ? 'tsx' : 'jsx' };
    },
    vue: function (tree) {
      return { code: '<template>\n' + pretty(tree, xmlOpts, 0, '  ') + '\n</template>\n', lang: 'xml', ext: 'vue' };
    },
    css: function (tree, o) {
      var d = dims(tree), uri = 'url("data:image/svg+xml,' + urlEncode(minify(tree)) + '")', cls = kebab(o.name);
      var code = '.' + cls + ' {\n  display: inline-block;\n  width: ' + fmt(roundNum(d.w, 2)) + 'px;\n  aspect-ratio: ' +
        fmt(roundNum(d.vb[2], 3)) + ' / ' + fmt(roundNum(d.vb[3], 3)) + ';\n';
      code += o.currentColor
        ? '  background-color: currentColor;\n  -webkit-mask: ' + uri + ' center / contain no-repeat;\n  mask: ' + uri + ' center / contain no-repeat;\n}\n'
        : '  background: ' + uri + ' center / contain no-repeat;\n}\n';
      return { code: code, lang: 'css', ext: 'css' };
    },
    uri: function (tree) {
      var d = dims(tree);
      var code = '<img\n  src="data:image/svg+xml;base64,' + base64(minify(tree)) + '"\n  width="' + fmt(roundNum(d.w, 2)) +
        '"\n  height="' + fmt(roundNum(d.h, 2)) + '"\n  alt=""\n/>\n';
      return { code: code, lang: 'xml', ext: 'html' };
    },
    android: function (tree, o) { return { code: toAndroid(tree, o.precision), lang: 'xml', ext: 'xml' }; }
  };

  /* ---------- Android VectorDrawable ---------- */

  var ANDROID_SKIP = { defs: 1, linearGradient: 1, radialGradient: 1, clipPath: 1, mask: 1, title: 1, desc: 1, style: 1,
    filter: 1, pattern: 1, symbol: 1, marker: 1, metadata: 1 };
  var ctx2d = null;

  function toAndroid(tree, prec) {
    var d = dims(tree), vb = d.vb, grads = {}, lines = [];
    walk(tree, function (n) {
      if (/Gradient$/.test(n.name) && get(n, 'id')) grads[get(n, 'id')] = n;
    });
    function stopColor(id, guard) {
      var g = grads[id];
      if (!g || guard > 4) return null;
      var stop = g.children.filter(function (c) { return c.name === 'stop'; })[0];
      if (stop) {
        var st = parseStyle(get(stop, 'style') || '').filter(function (p) { return p[0] === 'stop-color'; })[0];
        return st ? st[1] : get(stop, 'stop-color') || '#000';
      }
      var href = get(g, 'href') || get(g, 'xlink:href');
      return href ? stopColor(href.slice(1), (guard || 0) + 1) : null;
    }
    function color(v, alpha) {
      if (!v) return null;
      v = v.trim();
      if (/^(none|transparent)$/i.test(v)) return null;
      var m = /^url\(\s*['"]?#([^'")]+)/.exec(v);
      if (m) v = stopColor(m[1], 0) || '#000';
      if (/^currentColor$/i.test(v)) v = '#000';
      ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
      ctx2d.fillStyle = '#000'; ctx2d.fillStyle = v;
      var s = ctx2d.fillStyle, rgb, a = 1;
      if (s[0] === '#') rgb = [s.slice(1, 3), s.slice(3, 5), s.slice(5, 7)];
      else {
        var parts = s.replace(/[^\d.,]/g, '').split(',').map(Number);
        rgb = parts.slice(0, 3).map(function (x) { return (x | 0).toString(16).padStart(2, '0'); });
        a = parts.length > 3 ? parts[3] : 1;
      }
      a *= alpha;
      var hexs = rgb.join('').toUpperCase();
      return a >= 0.999 ? '#' + hexs : '#' + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() + hexs;
    }
    function ind(n) { return '    '.repeat(n); }

    lines.push('<vector xmlns:android="http://schemas.android.com/apk/res/android"');
    lines.push('    android:width="' + fmt(roundNum(d.w, 2)) + 'dp"');
    lines.push('    android:height="' + fmt(roundNum(d.h, 2)) + 'dp"');
    lines.push('    android:viewportWidth="' + fmt(roundNum(vb[2], 3)) + '"');
    lines.push('    android:viewportHeight="' + fmt(roundNum(vb[3], 3)) + '">');
    var depth = 1;
    var shift = vb[0] || vb[1];
    if (shift) { lines.push(ind(1) + '<group android:translateX="' + fmt(-vb[0]) + '" android:translateY="' + fmt(-vb[1]) + '">'); depth = 2; }

    var rootStyle = styleOf(tree, { fill: '#000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1',
      opacity: 1, 'fill-rule': 'nonzero', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter' });
    visit(tree.children, rootStyle, depth);

    if (shift) lines.push(ind(1) + '</group>');
    lines.push('</vector>');
    return lines.join('\n') + '\n';

    function visit(children, inh, depth) {
      children.forEach(function (n) {
        if (n.text != null || ANDROID_SKIP[n.name]) return;
        var st = styleOf(n, inh), groups = transformGroups(get(n, 'transform')), dd = depth;
        if (!groups) { lines.push(ind(depth) + '<!-- matrix() and skew() transforms have no VectorDrawable equivalent; skipped -->'); groups = []; }
        groups.forEach(function (g) { lines.push(ind(dd) + '<group ' + g + '>'); dd++; });
        if (n.name === 'g' || n.name === 'a' || n.name === 'svg') visit(n.children, st, dd);
        else {
          var path = shapeToPath(n);
          if (path) emit(path, st, dd);
          else if (n.name === 'text' || n.name === 'image' || n.name === 'use') lines.push(ind(dd) + '<!-- <' + n.name + '> is not supported by VectorDrawable; convert it to a path first -->');
        }
        for (var i = groups.length - 1; i >= 0; i--) lines.push(ind(depth + i) + '</group>');
      });
    }

    function emit(path, st, depth) {
      var fill = color(st.fill, +st['fill-opacity'] * st.opacity);
      var stroke = color(st.stroke, +st['stroke-opacity'] * st.opacity);
      if (!fill && !stroke) return;
      var a = [];
      if (fill) a.push('android:fillColor="' + fill + '"');
      if (fill && st['fill-rule'] === 'evenodd') a.push('android:fillType="evenOdd"');
      if (stroke) {
        a.push('android:strokeColor="' + stroke + '"', 'android:strokeWidth="' + fmt(roundNum(parseFloat(st['stroke-width']) || 1, 3)) + '"');
        if (st['stroke-linecap'] !== 'butt') a.push('android:strokeLineCap="' + st['stroke-linecap'] + '"');
        if (st['stroke-linejoin'] !== 'miter') a.push('android:strokeLineJoin="' + st['stroke-linejoin'] + '"');
      }
      a.push('android:pathData="' + optimizePath(path, prec) + '"');
      lines.push(ind(depth) + '<path');
      a.forEach(function (x, i) { lines.push(ind(depth + 1) + x + (i === a.length - 1 ? ' />' : '')); });
    }
  }

  function styleOf(n, inh) {
    var st = Object.assign({}, inh), props = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule',
      'stroke-linecap', 'stroke-linejoin'];
    var own = {};
    n.attrs.forEach(function (a) { own[a[0]] = a[1]; });
    parseStyle(own.style || '').forEach(function (p) { own[p[0]] = p[1]; });
    props.forEach(function (p) { if (own[p] != null && own[p] !== 'inherit') st[p] = own[p]; });
    if (own.opacity != null) st.opacity = inh.opacity * parseFloat(own.opacity);
    return st;
  }

  function transformGroups(t) {
    if (!t) return [];
    var out = [], re = /(\w+)\s*\(([^)]*)\)/g, m;
    while ((m = re.exec(t))) {
      var f = m[1], a = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (f === 'translate') out.push('android:translateX="' + fmt(a[0] || 0) + '" android:translateY="' + fmt(a[1] || 0) + '"');
      else if (f === 'scale') out.push('android:scaleX="' + fmt(a[0]) + '" android:scaleY="' + fmt(a[1] != null ? a[1] : a[0]) + '"');
      else if (f === 'rotate') out.push('android:rotation="' + fmt(a[0]) + '"' + (a.length > 2 ? ' android:pivotX="' + fmt(a[1]) + '" android:pivotY="' + fmt(a[2]) + '"' : ''));
      else return null;
    }
    return out;
  }

  function shapeToPath(n) {
    function A(k) { return parseFloat(get(n, k)) || 0; }
    switch (n.name) {
      case 'path': return get(n, 'd');
      case 'rect': {
        var x = A('x'), y = A('y'), w = A('width'), h = A('height');
        if (!w || !h) return null;
        var rx = get(n, 'rx') != null ? A('rx') : A('ry'), ry = get(n, 'ry') != null ? A('ry') : rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (!rx || !ry) return 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h) + 'H' + x + 'Z';
        var arc = 'A' + rx + ' ' + ry + ' 0 0 1 ';
        return 'M' + (x + rx) + ' ' + y + 'H' + (x + w - rx) + arc + (x + w) + ' ' + (y + ry) + 'V' + (y + h - ry) + arc + (x + w - rx) + ' ' + (y + h) +
          'H' + (x + rx) + arc + x + ' ' + (y + h - ry) + 'V' + (y + ry) + arc + (x + rx) + ' ' + y + 'Z';
      }
      case 'circle':
      case 'ellipse': {
        var cx = A('cx'), cy = A('cy'), erx = n.name === 'circle' ? A('r') : A('rx'), ery = n.name === 'circle' ? A('r') : A('ry');
        if (!erx || !ery) return null;
        var e = 'A' + erx + ' ' + ery + ' 0 1 0 ';
        return 'M' + (cx - erx) + ' ' + cy + e + (cx + erx) + ' ' + cy + e + (cx - erx) + ' ' + cy + 'Z';
      }
      case 'line': return 'M' + A('x1') + ' ' + A('y1') + 'L' + A('x2') + ' ' + A('y2');
      case 'polyline':
      case 'polygon': {
        var p = (get(n, 'points') || '').trim().split(/[\s,]+/).filter(Boolean);
        if (p.length < 4) return null;
        return 'M' + p[0] + ' ' + p[1] + 'L' + p.slice(2).join(' ') + (n.name === 'polygon' ? 'Z' : '');
      }
    }
    return null;
  }

  /* ---------- entry ---------- */

  function bytes(s) { return new TextEncoder().encode(s).length; }

  function convert(text, format, opts) {
    var o = Object.assign({ name: 'Icon', ts: true, currentColor: false, precision: 'auto' }, opts);
    o.name = pascal(o.name);
    var tree = parse(text);
    o.precision = o.precision === 'auto' ? autoPrecision(tree) : +o.precision;
    optimize(tree, o.precision, o.currentColor);
    var res = (FORMATS[format] || FORMATS.svg)(tree, o);
    var d = dims(tree);
    res.svg = minify(tree);
    res.inBytes = bytes(text);
    res.outBytes = bytes(res.code);
    res.svgBytes = bytes(res.svg);
    res.width = d.w; res.height = d.h;
    res.filename = (format === 'css' ? kebab(o.name) : format === 'svg' || format === 'uri' ? kebab(o.name) : o.name) + '.' + res.ext;
    return res;
  }

  root.SVG2Code = { convert: convert, optimizePath: optimizePath, pascal: pascal, formats: Object.keys(FORMATS) };
})(typeof self !== 'undefined' ? self : globalThis);
