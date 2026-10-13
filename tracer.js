/*!
 * SVG Scan tracing engine
 * https://github.com/AtharvaLakhe/SVG_Scan
 *
 * Raster to vector in four passes:
 *   1. quantize  k-means++ picks a palette, every pixel gets a color label
 *   2. clean     regions smaller than the noise filter merge into a neighbour
 *   3. trace     each color layer is walked along its pixel edges into closed loops
 *   4. fit       loops are simplified (Ramer-Douglas-Peucker) and refit as cubic Béziers
 *
 * Zero dependencies. Runs in a Web Worker, on the main thread, or in Node.
 * MIT License
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    colors: 8,        // palette size
    tolerance: 1,     // how far (px) a simplified edge may stray from the pixels
    smoothness: 1,    // 0 = polygons, 1 = natural curves, >1 = rounder
    corner: 70,       // turns sharper than this many degrees stay corners
    noise: 8,         // regions with fewer pixels than this are absorbed
    majority: 0,      // passes of a 3x3 majority filter; smooths ragged gradient bands
    blur: 0,          // pre-blur radius, helps photos
    precision: 1,     // decimals in path data
    stacked: true     // stack layers so neighbours never leave hairline gaps
  };

  function trace(image, options, onProgress) {
    var o = Object.assign({}, DEFAULTS, options);
    var W = image.width, H = image.height, N = W * H;
    var report = onProgress || function () {};
    var t0 = Date.now();

    var px = image.data;
    if (o.blur > 0) px = boxBlur(px, W, H, Math.round(o.blur));

    report(0.04, 'Reading colors');
    var palette = buildPalette(px, N, clamp(o.colors | 0, 2, 64), mulberry32(7));

    report(0.18, 'Sorting pixels');
    var labels = assignLabels(px, N, palette);

    for (var pass = 0; pass < o.majority; pass++) majority(labels, W, H);

    if (o.noise > 1) {
      report(0.26, 'Removing noise');
      despeckle(labels, W, H, Math.round(o.noise));
    }

    var area = new Float64Array(palette.length);
    for (var i = 0; i < N; i++) if (labels[i] >= 0) area[labels[i]]++;
    var order = [];
    for (i = 0; i < palette.length; i++) if (area[i] > 0) order.push(i);
    order.sort(function (a, b) { return area[b] - area[a]; });
    var rank = new Int16Array(palette.length).fill(-1);
    order.forEach(function (l, r) { rank[l] = r; });

    var mask = new Uint8Array(N);
    var cornerRad = o.corner * Math.PI / 180;
    var layers = [], nodes = 0;

    for (var r = 0; r < order.length; r++) {
      report(0.32 + 0.66 * r / order.length, 'Tracing color ' + (r + 1) + ' of ' + order.length);
      for (i = 0; i < N; i++) {
        var l = labels[i];
        mask[i] = l >= 0 && (o.stacked ? rank[l] >= r : rank[l] === r) ? 1 : 0;
      }
      var loops = traceMask(mask, W, H);
      var d = '', layerNodes = 0;
      for (var k = 0; k < loops.length; k++) {
        var simple = simplifyClosed(loops[k], o.tolerance);
        if (simple.length < 6) continue;
        var fit = fitLoop(simple, o.smoothness, cornerRad, o.precision);
        d += fit.d;
        layerNodes += fit.nodes;
      }
      if (!d) continue;
      layers.push({ color: hex(palette[order[r]]), d: d, coverage: area[order[r]] / N, nodes: layerNodes });
      nodes += layerNodes;
    }

    report(1, 'Done');
    return { width: W, height: H, layers: layers, stats: { colors: layers.length, nodes: nodes, ms: Date.now() - t0 } };
  }

  /* ---------- 1. quantize ---------- */

  function dist(r, g, b, P, k) {
    var dr = r - P[k], dg = g - P[k + 1], db = b - P[k + 2];
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
  }

  function buildPalette(px, N, K, rand) {
    var step = Math.max(1, N / 40000);
    var S = [], uniq = new Map();
    for (var f = 0; f < N; f += step) {
      var j = (f | 0) * 4;
      if (px[j + 3] < 128) continue;
      S.push(px[j], px[j + 1], px[j + 2]);
      if (uniq.size <= K) {
        var key = (px[j] << 16) | (px[j + 1] << 8) | px[j + 2];
        uniq.set(key, (uniq.get(key) || 0) + 1);
      }
    }
    var n = S.length / 3;
    if (!n) return [];
    // Few distinct colors (flat logos, pixel art): use them exactly.
    if (uniq.size <= K) {
      return Array.from(uniq.keys()).map(function (c) { return [c >> 16 & 255, c >> 8 & 255, c & 255]; });
    }

    // k-means++ seeding
    var C = new Float64Array(K * 3), D = new Float64Array(n).fill(Infinity);
    var first = (rand() * n | 0) * 3, k = 1, i;
    C[0] = S[first]; C[1] = S[first + 1]; C[2] = S[first + 2];
    for (; k < K; k++) {
      var sum = 0, prev = (k - 1) * 3;
      for (i = 0; i < n; i++) {
        var dd = dist(S[i * 3], S[i * 3 + 1], S[i * 3 + 2], C, prev);
        if (dd < D[i]) D[i] = dd;
        sum += D[i];
      }
      if (sum === 0) break;
      var target = rand() * sum, pick = n - 1;
      for (i = 0; i < n; i++) { target -= D[i]; if (target <= 0) { pick = i; break; } }
      C[k * 3] = S[pick * 3]; C[k * 3 + 1] = S[pick * 3 + 1]; C[k * 3 + 2] = S[pick * 3 + 2];
    }
    K = k;

    // Lloyd iterations
    var sums = new Float64Array(K * 3), cnt = new Float64Array(K);
    for (var it = 0; it < 18; it++) {
      sums.fill(0); cnt.fill(0);
      for (i = 0; i < n; i++) {
        var r = S[i * 3], g = S[i * 3 + 1], b = S[i * 3 + 2], best = 0, bd = Infinity;
        for (var c = 0; c < K; c++) {
          var e = dist(r, g, b, C, c * 3);
          if (e < bd) { bd = e; best = c; }
        }
        sums[best * 3] += r; sums[best * 3 + 1] += g; sums[best * 3 + 2] += b; cnt[best]++;
      }
      var moved = 0;
      for (c = 0; c < K; c++) {
        if (!cnt[c]) continue;
        for (var ch = 0; ch < 3; ch++) {
          var v = sums[c * 3 + ch] / cnt[c];
          moved = Math.max(moved, Math.abs(v - C[c * 3 + ch]));
          C[c * 3 + ch] = v;
        }
      }
      if (moved < 0.5) break;
    }

    var out = [], seen = new Set();
    for (c = 0; c < K; c++) {
      if (!cnt[c]) continue;
      var col = [Math.round(C[c * 3]), Math.round(C[c * 3 + 1]), Math.round(C[c * 3 + 2])];
      var id = col.join();
      if (!seen.has(id)) { seen.add(id); out.push(col); }
    }
    return out;
  }

  function assignLabels(px, N, pal) {
    var L = new Int16Array(N), K = pal.length, P = new Float64Array(K * 3);
    pal.forEach(function (c, i) { P[i * 3] = c[0]; P[i * 3 + 1] = c[1]; P[i * 3 + 2] = c[2]; });
    var lastKey = -1, last = -1;
    for (var i = 0; i < N; i++) {
      var j = i * 4;
      if (px[j + 3] < 128 || !K) { L[i] = -1; continue; }
      var r = px[j], g = px[j + 1], b = px[j + 2], key = (r << 16) | (g << 8) | b;
      if (key === lastKey) { L[i] = last; continue; }
      var best = 0, bd = Infinity;
      for (var c = 0; c < K; c++) {
        var e = dist(r, g, b, P, c * 3);
        if (e < bd) { bd = e; best = c; }
      }
      L[i] = best; lastKey = key; last = best;
    }
    return L;
  }

  /* ---------- 2. clean ---------- */

  function despeckle(L, W, H, minArea) {
    var N = W * H, seen = new Uint8Array(N), stack = new Int32Array(N), comp = new Int32Array(N);
    for (var s = 0; s < N; s++) {
      if (seen[s]) continue;
      var lab = L[s], sp = 0, n = 0;
      stack[sp++] = s; seen[s] = 1;
      while (sp) {
        var p = stack[--sp], x = p % W;
        comp[n++] = p;
        if (x > 0 && !seen[p - 1] && L[p - 1] === lab) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < W - 1 && !seen[p + 1] && L[p + 1] === lab) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (p >= W && !seen[p - W] && L[p - W] === lab) { seen[p - W] = 1; stack[sp++] = p - W; }
        if (p < N - W && !seen[p + W] && L[p + W] === lab) { seen[p + W] = 1; stack[sp++] = p + W; }
      }
      if (n >= minArea) continue;
      // Merge into whichever neighbour shares the most edge with this speck.
      var votes = new Map(), best = lab, bv = 0;
      for (var k = 0; k < n; k++) {
        p = comp[k]; x = p % W;
        if (x > 0) vote(L[p - 1]);
        if (x < W - 1) vote(L[p + 1]);
        if (p >= W) vote(L[p - W]);
        if (p < N - W) vote(L[p + W]);
      }
      if (best !== lab) for (k = 0; k < n; k++) L[comp[k]] = best;
    }
    function vote(v) {
      if (v === lab) return;
      var c = (votes.get(v) || 0) + 1;
      votes.set(v, c);
      if (c > bv) { bv = c; best = v; }
    }
  }

  // Each boundary pixel takes the label most of its 3x3 neighbourhood agrees on.
  // Smooths the dithered edges between bands of a gradient.
  function majority(L, W, H) {
    var out = new Int16Array(L), v = new Int16Array(9);
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var p = y * W + x, c = L[p];
        if (L[p - 1] === c && L[p + 1] === c && L[p - W] === c && L[p + W] === c) continue;
        var k = 0;
        for (var dy = -W; dy <= W; dy += W) for (var dx = -1; dx <= 1; dx++) v[k++] = L[p + dy + dx];
        for (var i = 0; i < 9; i++) {
          var n = 0;
          for (var j = 0; j < 9; j++) if (v[j] === v[i]) n++;
          if (n >= 5) { out[p] = v[i]; break; }
        }
      }
    }
    L.set(out);
  }

  /* ---------- 3. trace ---------- */

  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  // Walks the boundary between filled and empty pixels. Edges run clockwise
  // around filled regions (holes come out counter-clockwise), so the default
  // nonzero fill rule renders holes correctly. Returns loops of edge midpoints,
  // which turns pixel staircases into clean diagonals for free.
  function traceMask(m, W, H) {
    var VW = W + 1, out = new Uint8Array(VW * (H + 1)), x, y, p = 0;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++, p++) {
        if (!m[p]) continue;
        var v = y * VW + x;
        if (y === 0 || !m[p - W]) out[v] |= 1;                 // top edge, heading right
        if (x === W - 1 || !m[p + 1]) out[v + 1] |= 2;         // right edge, heading down
        if (y === H - 1 || !m[p + W]) out[v + VW + 1] |= 4;    // bottom edge, heading left
        if (x === 0 || !m[p - 1]) out[v + VW] |= 8;            // left edge, heading up
      }
    }
    var loops = [];
    for (var v0 = 0; v0 < out.length; v0++) {
      while (out[v0]) {
        x = v0 % VW; y = (v0 - x) / VW;
        var b = out[v0], d = b & 1 ? 0 : b & 2 ? 1 : b & 4 ? 2 : 3, pts = [], dirs = [];
        for (;;) {
          out[y * VW + x] &= ~(1 << d);
          pts.push(x + DX[d] * 0.5, y + DY[d] * 0.5);
          dirs.push(d);
          x += DX[d]; y += DY[d];
          var o = out[y * VW + x];
          if (!o) break;
          var rt = (d + 1) & 3, lt = (d + 3) & 3;
          d = o & (1 << rt) ? rt : o & (1 << d) ? d : o & (1 << lt) ? lt : -1;
          if (d < 0) break;
        }
        loops.push(keepCorners(pts, dirs));
      }
    }
    return loops;
  }

  // Midpoints shave half a pixel off every corner. Where two straight runs of
  // 3+ edges meet, the corner is real, so put the exact vertex back.
  function keepCorners(mid, dirs) {
    var n = dirs.length, s = 0, i, k;
    while (s < n && dirs[s] === dirs[(s + n - 1) % n]) s++;
    if (s === n) return mid;
    var run = new Int32Array(n);
    for (i = 0; i < n;) {
      var d = dirs[(s + i) % n], len = 0;
      while (i + len < n && dirs[(s + i + len) % n] === d) len++;
      for (k = 0; k < len; k++) run[(s + i + k) % n] = len;
      i += len;
    }
    var out = [], first = -1;
    for (i = 0; i < n; i++) {
      out.push(mid[2 * i], mid[2 * i + 1]);
      var j = (i + 1) % n;
      if (dirs[j] !== dirs[i] && run[i] >= 3 && run[j] >= 3) {
        if (first < 0) first = out.length;
        out.push(mid[2 * i] + DX[dirs[i]] * 0.5, mid[2 * i + 1] + DY[dirs[i]] * 0.5);
      }
    }
    // Start the loop on a real corner: the simplifier always keeps the start point.
    return first > 0 ? out.slice(first).concat(out.slice(0, first)) : out;
  }

  /* ---------- 4. fit ---------- */

  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = 0;
    if (l > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1);
    var ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
  }

  function simplifyClosed(p, tol) {
    var n = p.length >> 1;
    if (n < 3) return p;
    var far = 0, fd = -1, i;
    for (i = 1; i < n; i++) {
      var dx = p[2 * i] - p[0], dy = p[2 * i + 1] - p[1], dd = dx * dx + dy * dy;
      if (dd > fd) { fd = dd; far = i; }
    }
    var t2 = tol * tol, keep = new Uint8Array(n + 1), stack = [0, far, far, n];
    keep[0] = keep[far] = 1;
    while (stack.length) {
      var b = stack.pop(), a = stack.pop();
      if (b - a < 2) continue;
      var bi = b % n, ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * bi], by = p[2 * bi + 1], md = -1, mi = -1;
      for (i = a + 1; i < b; i++) {
        var e = segDist2(p[2 * i], p[2 * i + 1], ax, ay, bx, by);
        if (e > md) { md = e; mi = i; }
      }
      if (md > t2) { keep[mi] = 1; stack.push(a, mi, mi, b); }
    }
    var res = [];
    for (i = 0; i < n; i++) if (keep[i]) res.push(p[2 * i], p[2 * i + 1]);
    return res;
  }

  function intersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var r1 = bx - ax, s1 = by - ay, r2 = dx - cx, s2 = dy - cy, den = r1 * s2 - s1 * r2;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((cx - ax) * s2 - (cy - ay) * r2) / den;
    return [ax + t * r1, ay + t * s1];
  }

  function fitLoop(p, smooth, cornerRad, prec) {
    var n = p.length >> 1, i, ang = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var a = (i + n - 1) % n, b = (i + 1) % n;
      var ux = p[2 * i] - p[2 * a], uy = p[2 * i + 1] - p[2 * a + 1];
      var vx = p[2 * b] - p[2 * i], vy = p[2 * b + 1] - p[2 * i + 1];
      ang[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    }

    // Two short, gentle turns that add up to a sharp one are a chamfered
    // corner: replace them with the true corner point.
    var q = [], corner = [];
    for (i = 0; i < n; i++) {
      var j = i + 1;
      if (j < n && ang[i] * ang[j] > 0 && Math.abs(ang[i]) < cornerRad && Math.abs(ang[j]) < cornerRad &&
          Math.abs(ang[i] + ang[j]) > cornerRad &&
          Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]) < 3) {
        var h = (i + n - 1) % n, k = (j + 1) % n;
        var X = intersect(p[2 * h], p[2 * h + 1], p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1], p[2 * k], p[2 * k + 1]);
        if (X && Math.hypot(X[0] - (p[2 * i] + p[2 * j]) / 2, X[1] - (p[2 * i + 1] + p[2 * j + 1]) / 2) < 3) {
          q.push(X[0], X[1]); corner.push(1); i++;
          continue;
        }
      }
      q.push(p[2 * i], p[2 * i + 1]);
      corner.push(Math.abs(ang[i]) > cornerRad ? 1 : 0);
    }

    n = q.length >> 1;
    if (n < 3) return { d: '', nodes: 0 };
    var w = new PathWriter(prec);
    w.move(q[0], q[1]);
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var x0 = q[2 * i], y0 = q[2 * i + 1], x1 = q[2 * j], y1 = q[2 * j + 1];
      if (smooth <= 0 || (corner[i] && corner[j])) {
        if (j !== 0) w.line(x1, y1);
        continue;
      }
      var hl = Math.hypot(x1 - x0, y1 - y0) * smooth / 3, tx, ty, sx, sy;
      if (corner[i]) { tx = x1 - x0; ty = y1 - y0; }
      else { a = (i + n - 1) % n; tx = x1 - q[2 * a]; ty = y1 - q[2 * a + 1]; }
      if (corner[j]) { sx = x1 - x0; sy = y1 - y0; }
      else { b = (j + 1) % n; sx = q[2 * b] - x0; sy = q[2 * b + 1] - y0; }
      var tl = Math.hypot(tx, ty) || 1, sl = Math.hypot(sx, sy) || 1;
      w.curve(x0 + tx / tl * hl, y0 + ty / tl * hl, x1 - sx / sl * hl, y1 - sy / sl * hl, x1, y1);
    }
    w.close();
    return { d: w.s, nodes: n };
  }

  /* ---------- compact path writer ---------- */

  // Relative commands, deltas taken between already-rounded points (no drift),
  // implicit command repetition and the fewest separators the grammar allows.
  function PathWriter(prec) { this.k = Math.pow(10, prec); this.s = ''; this.x = 0; this.y = 0; this.cmd = ''; this.prev = ''; }
  PathWriter.prototype.r = function (v) { return Math.round(v * this.k) / this.k; };
  PathWriter.prototype.emit = function (cmd, nums) {
    if (cmd !== this.cmd) { this.s += cmd; this.cmd = cmd; this.prev = ''; }
    for (var i = 0; i < nums.length; i++) {
      var t = num(nums[i]);
      if (this.prev && t[0] !== '-' && !(t[0] === '.' && this.prev.indexOf('.') >= 0)) this.s += ' ';
      this.s += t; this.prev = t;
    }
  };
  PathWriter.prototype.move = function (x, y) {
    this.x = this.r(x); this.y = this.r(y);
    this.cmd = ''; this.emit('M', [this.x, this.y]);
  };
  PathWriter.prototype.line = function (x, y) {
    x = this.r(x); y = this.r(y);
    var dx = this.r(x - this.x), dy = this.r(y - this.y);
    if (!dx && !dy) return;
    if (!dy) this.emit('h', [dx]); else if (!dx) this.emit('v', [dy]); else this.emit('l', [dx, dy]);
    this.x = x; this.y = y;
  };
  PathWriter.prototype.curve = function (ax, ay, bx, by, x, y) {
    var r = this.r.bind(this), X = this.x, Y = this.y;
    x = r(x); y = r(y);
    this.emit('c', [r(r(ax) - X), r(r(ay) - Y), r(r(bx) - X), r(r(by) - Y), r(x - X), r(y - Y)]);
    this.x = x; this.y = y;
  };
  PathWriter.prototype.close = function () { this.s += 'z'; this.cmd = 'z'; this.prev = ''; };

  function num(v) {
    if (v === 0) return '0';
    var s = String(v);
    if (s.indexOf('e') >= 0) s = v.toFixed(6).replace(/\.?0+$/, '');
    if (s.slice(0, 2) === '0.') s = s.slice(1);
    else if (s.slice(0, 3) === '-0.') s = '-' + s.slice(2);
    return s;
  }

  /* ---------- helpers ---------- */

  function boxBlur(src, W, H, r) {
    var tmp = new Float32Array(src.length), out = new Uint8ClampedArray(src.length), d = 2 * r + 1, x, y, c, acc, k;
    for (y = 0; y < H; y++) for (c = 0; c < 4; c++) {
      acc = 0;
      for (k = -r; k <= r; k++) acc += src[(y * W + clamp(k, 0, W - 1)) * 4 + c];
      for (x = 0; x < W; x++) {
        tmp[(y * W + x) * 4 + c] = acc / d;
        acc += src[(y * W + Math.min(W - 1, x + r + 1)) * 4 + c] - src[(y * W + Math.max(0, x - r)) * 4 + c];
      }
    }
    for (x = 0; x < W; x++) for (c = 0; c < 4; c++) {
      acc = 0;
      for (k = -r; k <= r; k++) acc += tmp[(clamp(k, 0, H - 1) * W + x) * 4 + c];
      for (y = 0; y < H; y++) {
        out[(y * W + x) * 4 + c] = acc / d;
        acc += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 4 + c] - tmp[(Math.max(0, y - r) * W + x) * 4 + c];
      }
    }
    return out;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(c) { return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function toSVG(res, opt) {
    opt = opt || {};
    var hidden = opt.hidden || new Set();
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + res.width + ' ' + res.height + '"';
    if (opt.width) s += ' width="' + opt.width + '" height="' + opt.height + '"';
    s += '>';
    res.layers.forEach(function (l) { if (!hidden.has(l.color)) s += '\n<path fill="' + l.color + '" d="' + l.d + '"/>'; });
    return s + '\n</svg>\n';
  }

  var api = { trace: trace, toSVG: toSVG, defaults: DEFAULTS };

  var isWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope;
  if (isWorker) {
    root.onmessage = function (e) {
      var m = e.data;
      try {
        var res = trace({ width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) }, m.opts, function (p, stage) {
          root.postMessage({ id: m.id, type: 'progress', p: p, stage: stage });
        });
        root.postMessage({ id: m.id, type: 'done', result: res });
      } catch (err) {
        root.postMessage({ id: m.id, type: 'error', message: String(err && err.message || err) });
      }
    };
  } else if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SVGScan = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
