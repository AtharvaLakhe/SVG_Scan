/*!
 * SVG Scan tracing engine
 * https://github.com/AtharvaLakhe/SVG_Scan
 *
 * Raster to vector in four passes:
 *   1. quantize  k-means++ in OKLab picks a perceptual palette, every pixel gets a label
 *   2. clean     anti-aliasing halos, ragged gradient bands and specks are removed
 *   3. trace     each color layer is walked along its pixel edges into closed loops
 *   4. fit       corners are found, the rest is fit with least-squares cubic Béziers
 *
 * Zero dependencies. Runs in a Web Worker, on the main thread, or in Node.
 * MIT License
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    colors: 8,        // palette size
    tolerance: 1,     // max distance (px) a fitted curve may stray from the traced edge
    smoothness: 1,    // 0 = polygons; higher values smooth pixel noise harder before fitting
    corner: 60,       // turns sharper than this many degrees stay corners
    noise: 8,         // regions with fewer pixels than this are absorbed
    majority: 0,      // passes of a 3x3 majority filter; smooths ragged gradient bands
    dehalo: true,     // fold anti-aliasing slivers back into the colors they blend
    gradients: true,  // give shaded regions a linear gradient instead of a flat fill
    merge: 6,         // merge touching regions that together fit one gradient this well (RMS, 0-255)
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
    var lab = toOklab(px, N);
    var palette = buildPalette(px, lab, N, clamp(o.colors | 0, 2, 64), mulberry32(7));

    report(0.18, 'Sorting pixels');
    var labels = assignLabels(px, lab, N, palette);

    report(0.24, 'Cleaning edges');
    if (o.dehalo) dehalo(labels, W, H, palette);
    for (var pass = 0; pass < o.majority; pass++) majority(labels, W, H);
    if (o.noise > 1) despeckle(labels, W, H, Math.round(o.noise));
    if (o.gradients && o.merge > 0) mergeRamps(image.data, labels, W, H, palette.length / 3, o.merge);

    // Final colors are each region's average on the original pixels, measured
    // away from its edges so anti-aliasing doesn't tint flat colors.
    var K = palette.length / 3, sum = new Float64Array(K * 4), all = new Float64Array(K * 4), area = new Float64Array(K), i, l;
    var box = new Int32Array(K * 4);
    for (i = 0; i < K; i++) { box[i * 4] = W; box[i * 4 + 1] = H; box[i * 4 + 2] = -1; box[i * 4 + 3] = -1; }
    for (i = 0; i < N; i++) {
      l = labels[i];
      if (l < 0) continue;
      var x = i % W, y = (i - x) / W, acc = x > 0 && x < W - 1 && y > 0 && y < H - 1 &&
        labels[i - 1] === l && labels[i + 1] === l && labels[i - W] === l && labels[i + W] === l ? sum : all;
      area[l]++;
      acc[l * 4] += image.data[i * 4]; acc[l * 4 + 1] += image.data[i * 4 + 1]; acc[l * 4 + 2] += image.data[i * 4 + 2]; acc[l * 4 + 3]++;
      if (x < box[l * 4]) box[l * 4] = x;
      if (y < box[l * 4 + 1]) box[l * 4 + 1] = y;
      if (x > box[l * 4 + 2]) box[l * 4 + 2] = x;
      if (y > box[l * 4 + 3]) box[l * 4 + 3] = y;
    }
    for (i = 0; i < K; i++) if (!sum[i * 4 + 3]) for (var q = 0; q < 4; q++) sum[i * 4 + q] = all[i * 4 + q];
    var order = [];
    for (i = 0; i < K; i++) if (area[i] > 0) order.push(i);
    order.sort(function (a, b) { return area[b] - area[a]; });
    var rank = new Int16Array(K).fill(-1);
    order.forEach(function (lb, r) { rank[lb] = r; });

    var grads = o.gradients ? fitGradients(image.data, labels, W, H, K) : [];

    var mask = new Uint8Array(N), layers = [], nodes = 0;
    var fitOpts = {
      tol: Math.max(0.2, o.tolerance),
      passes: o.smoothness <= 0 ? 0 : Math.max(1, Math.round(o.smoothness * 2.3)),
      corner: clamp(o.corner, 20, 85) * Math.PI / 180,
      prec: o.precision
    };

    // Stacking: the first (largest) layer covers the whole silhouette, and every
    // other layer reaches a few pixels under the layers drawn above it. Each
    // boundary is then the top layer's edge over its real neighbour, never over
    // an unrelated color that would bleed through the anti-aliasing.
    var reach = o.stacked ? Math.ceil(fitOpts.tol) + 1 : 0, grow = new Uint8Array(N);
    for (var r = 0; r < order.length; r++) {
      report(0.3 + 0.68 * r / order.length, 'Tracing color ' + (r + 1) + ' of ' + order.length);
      if (r === 0 && o.stacked) {
        for (i = 0; i < N; i++) mask[i] = labels[i] >= 0 ? 1 : 0;
      } else {
        for (i = 0; i < N; i++) mask[i] = labels[i] >= 0 && rank[labels[i]] === r ? 1 : 0;
        var lb0 = order[r];
        var x0 = Math.max(0, box[lb0 * 4] - reach), y0 = Math.max(0, box[lb0 * 4 + 1] - reach);
        var x1 = Math.min(W - 1, box[lb0 * 4 + 2] + reach), y1 = Math.min(H - 1, box[lb0 * 4 + 3] + reach);
        for (var step = 0; step < reach; step++) {
          for (var yy = y0; yy <= y1; yy++) {
            for (var xx = x0; xx <= x1; xx++) {
              var p = yy * W + xx;
              grow[p] = 0;
              if (mask[p] || labels[p] < 0 || rank[labels[p]] < r) continue;
              if ((xx > 0 && mask[p - 1]) || (xx < W - 1 && mask[p + 1]) || (yy > 0 && mask[p - W]) || (yy < H - 1 && mask[p + W])) grow[p] = 1;
            }
          }
          for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) if (grow[yy * W + xx]) mask[yy * W + xx] = 1;
        }
      }
      var loops = traceMask(mask, W, H), d = '', layerNodes = 0;
      for (var k = 0; k < loops.length; k++) {
        var fit = fitLoop(loops[k], fitOpts);
        d += fit.d;
        layerNodes += fit.nodes;
      }
      if (!d) continue;
      var lb = order[r], a = area[lb];
      var layer = {
        color: hex([0, 1, 2].map(function (ch) { return Math.round(sum[lb * 4 + ch] / sum[lb * 4 + 3]); })),
        d: d, coverage: a / N, nodes: layerNodes
      };
      if (grads[lb]) layer.gradient = grads[lb];
      layers.push(layer);
      nodes += layerNodes;
    }

    report(1, 'Done');
    return { width: W, height: H, layers: layers, stats: { colors: layers.length, nodes: nodes, ms: Date.now() - t0 } };
  }

  /* ---------- 1. quantize ---------- */

  // sRGB to OKLab (Björn Ottosson, 2020). Distances in OKLab track how different
  // colors look, so clusters spread evenly across what the eye can tell apart.
  var LIN = new Float32Array(256);
  for (var c8 = 0; c8 < 256; c8++) {
    var cs = c8 / 255;
    LIN[c8] = cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }
  function oklab(r, g, b, out, o) {
    r = LIN[r]; g = LIN[g]; b = LIN[b];
    var L = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var M = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var S = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out[o] = 0.2104542553 * L + 0.7936177850 * M - 0.0040720468 * S;
    out[o + 1] = 1.9779984951 * L - 2.4285922050 * M + 0.4505937099 * S;
    out[o + 2] = 0.0259040371 * L + 0.7827717662 * M - 0.8086757660 * S;
  }
  function toOklab(px, N) {
    var lab = new Float32Array(N * 3), lastKey = -1;
    for (var i = 0; i < N; i++) {
      var j = i * 4, key = (px[j] << 16) | (px[j + 1] << 8) | px[j + 2];
      if (key === lastKey) { lab[i * 3] = lab[i * 3 - 3]; lab[i * 3 + 1] = lab[i * 3 - 2]; lab[i * 3 + 2] = lab[i * 3 - 1]; continue; }
      oklab(px[j], px[j + 1], px[j + 2], lab, i * 3);
      lastKey = key;
    }
    return lab;
  }
  function dist(A, a, B, b) {
    var dl = A[a] - B[b], da = A[a + 1] - B[b + 1], db = A[a + 2] - B[b + 2];
    return dl * dl + da * da + db * db;
  }

  function buildPalette(px, lab, N, K, rand) {
    var step = Math.max(1, N / 40000), idx = [], uniq = new Map(), f, j;
    for (f = 0; f < N; f += step) {
      var i = f | 0;
      if (px[i * 4 + 3] < 128) continue;
      idx.push(i);
      if (uniq.size <= K) {
        j = i * 4;
        var key = (px[j] << 16) | (px[j + 1] << 8) | px[j + 2];
        if (!uniq.has(key)) uniq.set(key, i);
      }
    }
    var n = idx.length, S = new Float32Array(n * 3), k, c;
    if (!n) return new Float32Array(0);
    // Few distinct colors (flat logos, pixel art): use them exactly.
    if (uniq.size <= K) {
      var exact = new Float32Array(uniq.size * 3);
      Array.from(uniq.values()).forEach(function (p, q) { exact[q * 3] = lab[p * 3]; exact[q * 3 + 1] = lab[p * 3 + 1]; exact[q * 3 + 2] = lab[p * 3 + 2]; });
      return exact;
    }
    for (k = 0; k < n; k++) { S[k * 3] = lab[idx[k] * 3]; S[k * 3 + 1] = lab[idx[k] * 3 + 1]; S[k * 3 + 2] = lab[idx[k] * 3 + 2]; }

    // k-means++ seeding
    var C = new Float32Array(K * 3), D = new Float64Array(n).fill(Infinity), first = (rand() * n | 0) * 3;
    C[0] = S[first]; C[1] = S[first + 1]; C[2] = S[first + 2];
    for (k = 1; k < K; k++) {
      var total = 0;
      for (i = 0; i < n; i++) {
        var dd = dist(S, i * 3, C, (k - 1) * 3);
        if (dd < D[i]) D[i] = dd;
        total += D[i];
      }
      if (total <= 1e-9) break;
      var target = rand() * total, pick = n - 1;
      for (i = 0; i < n; i++) { target -= D[i]; if (target <= 0) { pick = i; break; } }
      C[k * 3] = S[pick * 3]; C[k * 3 + 1] = S[pick * 3 + 1]; C[k * 3 + 2] = S[pick * 3 + 2];
    }
    K = k;

    // Lloyd iterations
    var sums = new Float64Array(K * 3), cnt = new Float64Array(K);
    for (var it = 0; it < 20; it++) {
      sums.fill(0); cnt.fill(0);
      for (i = 0; i < n; i++) {
        var best = 0, bd = Infinity;
        for (c = 0; c < K; c++) { var e = dist(S, i * 3, C, c * 3); if (e < bd) { bd = e; best = c; } }
        sums[best * 3] += S[i * 3]; sums[best * 3 + 1] += S[i * 3 + 1]; sums[best * 3 + 2] += S[i * 3 + 2]; cnt[best]++;
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
      if (moved < 1e-4) break;
    }
    var out = [];
    for (c = 0; c < K; c++) if (cnt[c]) out.push(C[c * 3], C[c * 3 + 1], C[c * 3 + 2]);
    return new Float32Array(out);
  }

  function assignLabels(px, lab, N, P) {
    var L = new Int16Array(N), K = P.length / 3;
    for (var i = 0; i < N; i++) {
      if (px[i * 4 + 3] < 128 || !K) { L[i] = -1; continue; }
      if (i && lab[i * 3] === lab[i * 3 - 3] && lab[i * 3 + 1] === lab[i * 3 - 2] && lab[i * 3 + 2] === lab[i * 3 - 1] && L[i - 1] >= 0) { L[i] = L[i - 1]; continue; }
      var best = 0, bd = Infinity;
      for (var c = 0; c < K; c++) { var e = dist(lab, i * 3, P, c * 3); if (e < bd) { bd = e; best = c; } }
      L[i] = best;
    }
    return L;
  }

  /* ---------- 2. clean ---------- */

  // Anti-aliased edges leave thin bands of in-between color (orange + black
  // makes a brown outline). A pixel is a halo when its run is at most 3 px
  // thick along some direction, the colors on either side differ, and its own
  // color sits between them. It joins whichever side it looks closer to.
  // Real thin features (a dark line between two light areas) are not blends,
  // so they survive.
  function dehalo(L, W, H, P) {
    var out = new Int16Array(L), steps = [1, W, W + 1, W - 1];
    for (var y = 4; y < H - 4; y++) {
      for (var x = 4; x < W - 4; x++) {
        var p = y * W + x, c = L[p];
        if (c < 0) continue;
        for (var s = 0; s < 4; s++) {
          var d = steps[s], fa = 1, ba = 1;
          while (fa <= 3 && L[p + fa * d] === c) fa++;
          while (ba <= 3 && L[p - ba * d] === c) ba++;
          if (fa + ba - 1 > 3) continue;
          var A = L[p + fa * d], B = L[p - ba * d];
          if (A === B) continue;
          // Edges against transparency are not blends (canvas pixels are unpremultiplied).
          if (A < 0 || B < 0) continue;
          // project c onto the segment A-B in OKLab
          var a = A * 3, b = B * 3, cc = c * 3;
          var abl = P[b] - P[a], aba = P[b + 1] - P[a + 1], abb = P[b + 2] - P[a + 2];
          var len2 = abl * abl + aba * aba + abb * abb;
          if (len2 < 1e-6) continue;
          var t = ((P[cc] - P[a]) * abl + (P[cc + 1] - P[a + 1]) * aba + (P[cc + 2] - P[a + 2]) * abb) / len2;
          if (t <= 0.05 || t >= 0.95) continue;
          var el = P[a] + t * abl - P[cc], ea = P[a + 1] + t * aba - P[cc + 1], eb = P[a + 2] + t * abb - P[cc + 2];
          if (el * el + ea * ea + eb * eb > 0.09 * len2) continue;
          out[p] = t < 0.5 ? A : B;
          break;
        }
      }
    }
    L.set(out);
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

  // Shading. Per region, sums over its interior pixels (n, x, y, xx, xy, yy, and
  // per channel c, cx, cy, cc) are enough to fit color as a linear ramp along
  // one direction by least squares. Sums add, so two regions can be tested as
  // one without touching pixels again.
  var SF = 18;
  function regionStats(px, L, W, H, K) {
    var S = new Float64Array(K * SF), cx = W / 2, cy = H / 2;
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var i = y * W + x, l = L[i];
        if (l < 0 || L[i - 1] !== l || L[i + 1] !== l || L[i - W] !== l || L[i + W] !== l) continue;
        var u = x - cx, v = y - cy, b = l * SF;
        S[b]++; S[b + 1] += u; S[b + 2] += v; S[b + 3] += u * u; S[b + 4] += u * v; S[b + 5] += v * v;
        for (var ch = 0; ch < 3; ch++) {
          var c = px[i * 4 + ch], q = b + 6 + ch * 4;
          S[q] += c; S[q + 1] += c * u; S[q + 2] += c * v; S[q + 3] += c * c;
        }
      }
    }
    return S;
  }

  // Fits color = mean + rate * t, where t runs along the direction the color
  // changes fastest. Returns the ramp and its RMS error (in 0-255 units).
  function rampFit(S, b) {
    var n = S[b];
    if (n < 3) return null;
    var mx = S[b + 1] / n, my = S[b + 2] / n;
    var sxx = S[b + 3] / n - mx * mx, sxy = S[b + 4] / n - mx * my, syy = S[b + 5] / n - my * my;
    var det = sxx * syy - sxy * sxy, mean = [], vr = [], cvx = [], cvy = [], variance = 0, ch;
    var m00 = 0, m01 = 0, m11 = 0;
    for (ch = 0; ch < 3; ch++) {
      var q = b + 6 + ch * 4, mc = S[q] / n;
      mean.push(mc);
      cvx.push(S[q + 1] / n - mc * mx); cvy.push(S[q + 2] / n - mc * my);
      var vc = Math.max(0, S[q + 3] / n - mc * mc);
      vr.push(vc); variance += vc;
      if (det > 1e-6) {
        var gx = (syy * cvx[ch] - sxy * cvy[ch]) / det, gy = (sxx * cvy[ch] - sxy * cvx[ch]) / det;
        m00 += gx * gx; m01 += gx * gy; m11 += gy * gy;
      }
    }
    var flat = { n: n, mean: mean, rms: Math.sqrt(variance / 3), variance: variance, ratio: 0 };
    if (det <= 1e-6 || m00 + m11 < 1e-12) return flat;
    var th = 0.5 * Math.atan2(2 * m01, m00 - m11), ux = Math.cos(th), uy = Math.sin(th);
    var vt = ux * ux * sxx + 2 * ux * uy * sxy + uy * uy * syy;
    if (vt < 1e-6) return flat;
    var rate = [], sse = 0;
    for (ch = 0; ch < 3; ch++) {
      var cov = ux * cvx[ch] + uy * cvy[ch];
      rate.push(cov / vt);
      sse += Math.max(0, vr[ch] - cov * cov / vt);
    }
    return { n: n, mean: mean, rms: Math.sqrt(sse / 3), variance: variance, ratio: variance > 0 ? 1 - sse / variance : 0,
      mx: mx, my: my, ux: ux, uy: uy, rate: rate };
  }

  // Quantizing a smooth gradient slices it into bands. Greedily merge the pair
  // of touching regions whose union still fits one linear ramp best, until no
  // pair fits within `limit`. A banded sky collapses back into one shape.
  function mergeRamps(px, L, W, H, K, limit) {
    var S = regionStats(px, L, W, H, K), touch = new Map(), i, a, b;
    for (i = 0; i < W * H; i++) {
      a = L[i];
      if (a < 0) continue;
      if ((i + 1) % W && (b = L[i + 1]) !== a && b >= 0) touch.set(Math.min(a, b) * K + Math.max(a, b), 1);
      if (i + W < W * H && (b = L[i + W]) !== a && b >= 0) touch.set(Math.min(a, b) * K + Math.max(a, b), 1);
    }
    var parent = new Int16Array(K), tmp = new Float64Array(SF), merged = false;
    for (i = 0; i < K; i++) parent[i] = i;
    function find(v) { while (parent[v] !== v) v = parent[v] = parent[parent[v]]; return v; }
    for (;;) {
      var best = null, bestRms = limit;
      touch.forEach(function (_, key) {
        var ra = find((key / K) | 0), rb = find(key % K);
        if (ra === rb || S[ra * SF] < 30 || S[rb * SF] < 30) return;
        for (var f = 0; f < SF; f++) tmp[f] = S[ra * SF + f] + S[rb * SF + f];
        var fit = rampFit(tmp, 0);
        if (!fit || fit.rms >= bestRms) return;
        // a merged region too small to earn a gradient must already be one flat color
        if (tmp[0] < 400 && fit.rms >= 3) return;
        // only merge slices of the same ramp: the union may not fit much worse than its parts
        var fa = rampFit(S, ra * SF), fb = rampFit(S, rb * SF);
        if (fit.rms > Math.max(fa.rms, fb.rms) * 1.3 + 1) return;
        bestRms = fit.rms; best = [ra, rb];
      });
      if (!best) break;
      for (var f2 = 0; f2 < SF; f2++) S[best[0] * SF + f2] += S[best[1] * SF + f2];
      parent[best[1]] = best[0];
      merged = true;
    }
    if (!merged) return;
    for (i = 0; i < W * H; i++) if (L[i] >= 0) L[i] = find(L[i]);
  }

  // Regions whose color ramps clearly get a linear gradient along that ramp.
  function fitGradients(px, L, W, H, K) {
    var S = regionStats(px, L, W, H, K), out = new Array(K), fit = [], l, i, cx = W / 2, cy = H / 2;
    for (l = 0; l < K; l++) {
      var r = rampFit(S, l * SF);
      if (!r || !r.rate || r.n < 400 || r.variance < 4 || r.ratio < 0.3) continue;
      r.lo = Infinity; r.hi = -Infinity;
      fit[l] = r;
    }
    // Extent of each region along its gradient direction.
    for (i = 0; i < W * H; i++) {
      l = L[i];
      var f = l >= 0 && fit[l];
      if (!f) continue;
      var x = i % W, y = (i - x) / W, t = (x - cx - f.mx) * f.ux + (y - cy - f.my) * f.uy;
      if (t < f.lo) f.lo = t;
      if (t > f.hi) f.hi = t;
    }
    for (l = 0; l < K; l++) {
      f = fit[l];
      if (!f) continue;
      var from = [], to = [], span = 0;
      for (var ch = 0; ch < 3; ch++) {
        from.push(clamp(Math.round(f.mean[ch] + f.rate[ch] * f.lo), 0, 255));
        to.push(clamp(Math.round(f.mean[ch] + f.rate[ch] * f.hi), 0, 255));
        span = Math.max(span, Math.abs(to[ch] - from[ch]));
      }
      if (span < 10) continue;
      out[l] = {
        x1: round1(cx + f.mx + f.ux * f.lo), y1: round1(cy + f.my + f.uy * f.lo),
        x2: round1(cx + f.mx + f.ux * f.hi), y2: round1(cy + f.my + f.uy * f.hi),
        from: hex(from), to: hex(to)
      };
    }
    return out;
  }
  function round1(v) { return Math.round(v * 10) / 10; }

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
    var out = [];
    for (i = 0; i < n; i++) {
      out.push(mid[2 * i], mid[2 * i + 1]);
      var j = (i + 1) % n;
      if (dirs[j] !== dirs[i] && run[i] >= 3 && run[j] >= 3) {
        out.push(mid[2 * i] + DX[dirs[i]] * 0.5, mid[2 * i + 1] + DY[dirs[i]] * 0.5);
      }
    }
    return out;
  }

  /* ---------- 4. fit ---------- */

  function fitLoop(p, o) {
    var n = p.length >> 1, w = new PathWriter(o.prec), i;
    if (n < 3) return { d: '', nodes: 0 };

    // Polygon mode, and loops too small to have a meaningful curve.
    if (!o.passes || n < 10) {
      var poly = simplifyClosed(p, Math.max(o.tol, 0.5));
      var m = poly.length >> 1;
      if (m < 3) return { d: '', nodes: 0 };
      w.move(poly[0], poly[1]);
      for (i = 1; i < m; i++) w.line(poly[2 * i], poly[2 * i + 1]);
      w.close();
      return { d: w.s, nodes: m };
    }

    var X = new Float64Array(n), Y = new Float64Array(n);
    for (i = 0; i < n; i++) { X[i] = p[2 * i]; Y[i] = p[2 * i + 1]; }

    // Corners. A point is a corner when the turn measured across +-k points is
    // sharp, most of that turn survives when measured across only +-k/2 points
    // (a tight curve loses half, a real corner keeps it), and it is the sharpest
    // turn in its neighbourhood.
    var k = n < 30 ? 2 : n < 80 ? 3 : n < 200 ? 4 : 6, kh = Math.ceil(k / 2);
    var turn = new Float64Array(n), isCorner = new Uint8Array(n), corners = [];
    function turnAt(i, s) {
      var a = (i - s + n) % n, b = (i + s) % n;
      var ux = X[i] - X[a], uy = Y[i] - Y[a], vx = X[b] - X[i], vy = Y[b] - Y[i];
      return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    }
    for (i = 0; i < n; i++) turn[i] = turnAt(i, k);
    for (i = 0; i < n; i++) {
      if (turn[i] < o.corner) continue;
      var peak = true;
      for (var j = 1; j <= k && peak; j++) {
        if (turn[(i + j) % n] > turn[i] || turn[(i - j + n) % n] >= turn[i]) peak = false;
      }
      if (!peak || turnAt(i, kh) < 0.6 * turn[i]) continue;
      isCorner[i] = 1;
      corners.push(i);
    }
    // Anti-aliasing rounds every corner a little. Snap each one to where its
    // two edges meet, so corners come out crisp instead of chamfered.
    var snapped = [];
    for (var ci = 0; ci < corners.length; ci++) {
      i = corners[ci];
      var a1 = (i - k + n) % n, a2 = (i - kh + n) % n, b1 = (i + kh) % n, b2 = (i + k) % n;
      var hit = intersect(X[a1], Y[a1], X[a2], Y[a2], X[b1], Y[b1], X[b2], Y[b2]);
      snapped.push(hit && Math.hypot(hit[0] - X[i], hit[1] - Y[i]) < k * 0.75 ? hit : null);
    }
    for (ci = 0; ci < corners.length; ci++) if (snapped[ci]) { X[corners[ci]] = snapped[ci][0]; Y[corners[ci]] = snapped[ci][1]; }

    // Smooth away pixel noise, keeping corners pinned.
    var TX = new Float64Array(n), TY = new Float64Array(n);
    for (var pass = 0; pass < o.passes; pass++) {
      for (i = 0; i < n; i++) {
        if (isCorner[i]) { TX[i] = X[i]; TY[i] = Y[i]; continue; }
        var pi = (i + n - 1) % n, ni = (i + 1) % n;
        TX[i] = (X[pi] + 2 * X[i] + X[ni]) / 4;
        TY[i] = (Y[pi] + 2 * Y[i] + Y[ni]) / 4;
      }
      var sw = X; X = TX; TX = sw; sw = Y; Y = TY; TY = sw;
    }

    // Break points: corners, or two opposite points on a smooth loop.
    var breaks = corners.length ? corners : [0, n >> 1], sharp = corners.length > 0, nb = breaks.length;
    function tangentAt(i, forward) {
      // central difference on smooth joints, one-sided into the piece at corners
      var m = Math.min(k, 3), tx, ty;
      if (!sharp) { tx = X[(i + m) % n] - X[(i - m + n) % n]; ty = Y[(i + m) % n] - Y[(i - m + n) % n]; if (!forward) { tx = -tx; ty = -ty; } }
      else if (forward) { tx = X[(i + m) % n] - X[i]; ty = Y[(i + m) % n] - Y[i]; }
      else { tx = X[(i - m + n) % n] - X[i]; ty = Y[(i - m + n) % n] - Y[i]; }
      var l = Math.hypot(tx, ty) || 1;
      return [tx / l, ty / l];
    }

    var err2 = o.tol * o.tol, nodes = 0;
    w.move(X[breaks[0]], Y[breaks[0]]);
    for (var bi = 0; bi < nb; bi++) {
      var s0 = breaks[bi], s1 = breaks[(bi + 1) % nb], len = (s1 - s0 + n) % n || n;
      var PX = new Float64Array(len + 1), PY = new Float64Array(len + 1);
      for (i = 0; i <= len; i++) { PX[i] = X[(s0 + i) % n]; PY[i] = Y[(s0 + i) % n]; }
      var last = bi === nb - 1;
      if (len < 3 || (sharp && isStraight(PX, PY, 0, len, o.tol))) {
        if (!last || !sharp) w.line(PX[len], PY[len]);
        nodes++;
        continue;
      }
      var t1 = tangentAt(s0, true), t2 = tangentAt(s1, false), curves = [];
      fitCubic(PX, PY, 0, len, t1[0], t1[1], t2[0], t2[1], err2, curves);
      for (var q = 0; q < curves.length; q += 6) w.curve(curves[q], curves[q + 1], curves[q + 2], curves[q + 3], curves[q + 4], curves[q + 5]);
      nodes += curves.length / 6;
    }
    w.close();
    return { d: w.s, nodes: nodes };
  }

  function intersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var r1 = bx - ax, s1 = by - ay, r2 = dx - cx, s2 = dy - cy, den = r1 * s2 - s1 * r2;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((cx - ax) * s2 - (cy - ay) * r2) / den;
    return [ax + t * r1, ay + t * s1];
  }

  function isStraight(PX, PY, a, b, tol) {
    var t2 = tol * tol;
    for (var i = a + 1; i < b; i++) if (segDist2(PX[i], PY[i], PX[a], PY[a], PX[b], PY[b]) > t2) return false;
    return true;
  }

  // Least-squares cubic Bézier fitting after Philip J. Schneider, "An Algorithm
  // for Automatically Fitting Digitized Curves" (Graphics Gems, 1990): fit one
  // curve with fixed end tangents, refine the parameters with Newton-Raphson,
  // and split at the worst point when the curve still strays too far.
  function fitCubic(PX, PY, first, last, t1x, t1y, t2x, t2y, err2, out) {
    var x0 = PX[first], y0 = PY[first], x3 = PX[last], y3 = PY[last];
    if (last - first === 1) {
      var d3 = Math.hypot(x3 - x0, y3 - y0) / 3;
      out.push(x0 + t1x * d3, y0 + t1y * d3, x3 + t2x * d3, y3 + t2y * d3, x3, y3);
      return;
    }
    var u = chordParams(PX, PY, first, last), split = (first + last) >> 1, bez, worst;
    for (var it = 0; it < 6; it++) {
      bez = generateBezier(PX, PY, first, last, u, t1x, t1y, t2x, t2y);
      worst = maxError(PX, PY, first, last, bez, u);
      if (worst[0] <= err2) { out.push(bez[0], bez[1], bez[2], bez[3], x3, y3); return; }
      split = worst[1];
      if (worst[0] > err2 * 16 || !reparameterize(PX, PY, first, last, u, bez)) break;
    }
    var m = Math.min(4, split - first, last - split);
    var cx = PX[split - m] - PX[split + m], cy = PY[split - m] - PY[split + m], cl = Math.hypot(cx, cy) || 1;
    cx /= cl; cy /= cl;
    fitCubic(PX, PY, first, split, t1x, t1y, cx, cy, err2, out);
    fitCubic(PX, PY, split, last, -cx, -cy, t2x, t2y, err2, out);
  }

  function chordParams(PX, PY, first, last) {
    var u = new Float64Array(last - first + 1);
    for (var i = first + 1; i <= last; i++) u[i - first] = u[i - first - 1] + Math.hypot(PX[i] - PX[i - 1], PY[i] - PY[i - 1]);
    var total = u[last - first] || 1;
    for (i = 1; i <= last - first; i++) u[i] /= total;
    return u;
  }

  function generateBezier(PX, PY, first, last, u, t1x, t1y, t2x, t2y) {
    var x0 = PX[first], y0 = PY[first], x3 = PX[last], y3 = PY[last];
    var c00 = 0, c01 = 0, c11 = 0, X0 = 0, X1 = 0;
    for (var i = first; i <= last; i++) {
      var t = u[i - first], s = 1 - t, b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
      var a1x = t1x * b1, a1y = t1y * b1, a2x = t2x * b2, a2y = t2y * b2;
      var rx = PX[i] - x0 * (b0 + b1) - x3 * (b2 + b3), ry = PY[i] - y0 * (b0 + b1) - y3 * (b2 + b3);
      c00 += a1x * a1x + a1y * a1y; c01 += a1x * a2x + a1y * a2y; c11 += a2x * a2x + a2y * a2y;
      X0 += a1x * rx + a1y * ry; X1 += a2x * rx + a2y * ry;
    }
    var det = c00 * c11 - c01 * c01, seg = Math.hypot(x3 - x0, y3 - y0), a1, a2;
    if (Math.abs(det) > 1e-12) { a1 = (X0 * c11 - X1 * c01) / det; a2 = (c00 * X1 - c01 * X0) / det; }
    else a1 = a2 = seg / 3;
    // Fall back to the classic third-of-the-chord handles when the solve degenerates.
    if (!(a1 > 1e-6 * seg) || !(a2 > 1e-6 * seg) || a1 > seg * 2 || a2 > seg * 2) a1 = a2 = seg / 3;
    return [x0 + t1x * a1, y0 + t1y * a1, x3 + t2x * a2, y3 + t2y * a2];
  }

  function bezAt(t, a, b, c, d) { var s = 1 - t; return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d; }

  function maxError(PX, PY, first, last, bez, u) {
    var x0 = PX[first], y0 = PY[first], x3 = PX[last], y3 = PY[last], max = 0, idx = (first + last) >> 1;
    for (var i = first + 1; i < last; i++) {
      var t = u[i - first];
      var dx = bezAt(t, x0, bez[0], bez[2], x3) - PX[i], dy = bezAt(t, y0, bez[1], bez[3], y3) - PY[i], e = dx * dx + dy * dy;
      if (e >= max) { max = e; idx = i; }
    }
    return [max, idx];
  }

  function reparameterize(PX, PY, first, last, u, bez) {
    var x0 = PX[first], y0 = PY[first], x3 = PX[last], y3 = PY[last], c1x = bez[0], c1y = bez[1], c2x = bez[2], c2y = bez[3];
    for (var i = first + 1; i < last; i++) {
      var t = u[i - first], s = 1 - t;
      var qx = bezAt(t, x0, c1x, c2x, x3) - PX[i], qy = bezAt(t, y0, c1y, c2y, y3) - PY[i];
      var d1x = 3 * (s * s * (c1x - x0) + 2 * s * t * (c2x - c1x) + t * t * (x3 - c2x));
      var d1y = 3 * (s * s * (c1y - y0) + 2 * s * t * (c2y - c1y) + t * t * (y3 - c2y));
      var d2x = 6 * (s * (c2x - 2 * c1x + x0) + t * (x3 - 2 * c2x + c1x));
      var d2y = 6 * (s * (c2y - 2 * c1y + y0) + t * (y3 - 2 * c2y + c1y));
      var den = d1x * d1x + d1y * d1y + qx * d2x + qy * d2y;
      if (Math.abs(den) > 1e-12) u[i - first] = clamp(t - (qx * d1x + qy * d1y) / den, 0, 1);
    }
    for (i = 1; i < u.length; i++) if (u[i] < u[i - 1]) return false;
    return true;
  }

  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = 0;
    if (l > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1);
    var ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
  }

  // Ramer-Douglas-Peucker on a closed loop (polygon mode).
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

  function gradientDef(id, g) {
    return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + g.x1 + '" y1="' + g.y1 + '" x2="' + g.x2 + '" y2="' + g.y2 +
      '"><stop offset="0" stop-color="' + g.from + '"/><stop offset="1" stop-color="' + g.to + '"/></linearGradient>';
  }

  // opt: { hidden: Set of layer colors to leave out, gradients: false for flat fills, width, height }
  function toSVG(res, opt) {
    opt = opt || {};
    var hidden = opt.hidden || new Set(), defs = '', body = '';
    res.layers.forEach(function (l, i) {
      if (hidden.has(l.color)) return;
      var fill = l.color;
      if (l.gradient && opt.gradients !== false) { defs += '\n' + gradientDef('g' + i, l.gradient); fill = 'url(#g' + i + ')'; }
      body += '\n<path fill="' + fill + '" d="' + l.d + '"/>';
    });
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + res.width + ' ' + res.height + '"';
    if (opt.width) s += ' width="' + opt.width + '" height="' + opt.height + '"';
    s += '>' + (defs ? '\n<defs>' + defs + '\n</defs>' : '') + body;
    return s + '\n</svg>\n';
  }

  var api = { trace: trace, toSVG: toSVG, gradientDef: gradientDef, defaults: DEFAULTS };

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
