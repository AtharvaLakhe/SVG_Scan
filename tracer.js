/*!
 * SVG Scan tracing engine
 * https://github.com/AtharvaLakhe/SVG_Scan
 *
 * Raster to vector:
 *   1. quantize  k-means++ in OKLab picks a perceptual palette, every pixel gets a label
 *   2. clean     anti-aliasing halos, ragged gradient bands and specks are removed
 *   3. merge     bands of one smooth shading rejoin across soft borders
 *   4. trace     each color layer is walked along its pixel edges into closed loops
 *   5. fit       corners are found, the rest is fit with least-squares cubic Béziers
 *   6. shade     shaded regions get linear or (focal) radial gradients
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
    merge: 6,         // merge regions across soft borders while one gradient still fits this well (RMS, 0-255)
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
    if (o.gradients && o.merge > 0) mergeSmooth(image.data, labels, W, H, palette.length / 3, o.merge);

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

    var mask = new Uint8Array(N), layers = [], nodes = 0, pixelsOf = [], fillAt = new Int32Array(K);
    for (i = 0; i < K; i++) pixelsOf.push(new Int32Array(area[i]));
    for (i = 0; i < N; i++) { l = labels[i]; if (l >= 0) pixelsOf[l][fillAt[l]++] = i; }
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
        var lb0 = order[r], own = pixelsOf[lb0];
        mask.fill(0);
        for (i = 0; i < own.length; i++) mask[own[i]] = 1;
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

  // Shading. A region's color is modelled three ways, each fit to its interior
  // pixels, and the best one wins:
  //   flat    one color
  //   linear  a color profile along the direction the color changes fastest
  //   radial  a color profile by distance from a point (a lit ball, a glow)
  // Profiles are free-form (BINS buckets, later thinned to a few gradient
  // stops), so a sky running through four colors or a ball with a highlight
  // fits as well as a plain two-color ramp. The linear direction comes from a
  // least-squares plane, the radial center from the peak of a least-squares
  // bowl c = a + b*u + c*v + d*(u^2 + v^2), which sits at (-b/2d, -c/2d).
  var BINS = 16;
  function shading(px, pix, W, H, mark, stamp, step, refine) {
    step = step || 1;
    var ox = W / 2, oy = H / 2, sc = Math.max(W, H) / 2, k, p, x, y, u, v, q, ch, c;
    var n = 0, su = 0, sv = 0, suu = 0, suv = 0, svv = 0, sq = 0, suq = 0, svq = 0, sqq = 0;
    var C = new Float64Array(15); // per channel: c, cu, cv, cq, cc
    for (k = 0; k < pix.length; k += step) {
      p = pix[k]; x = p % W; y = (p - x) / W;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || mark[p - 1] !== stamp || mark[p + 1] !== stamp || mark[p - W] !== stamp || mark[p + W] !== stamp) continue;
      u = (x - ox) / sc; v = (y - oy) / sc; q = u * u + v * v;
      n++; su += u; sv += v; suu += u * u; suv += u * v; svv += v * v; sq += q; suq += u * q; svq += v * q; sqq += q * q;
      for (ch = 0; ch < 3; ch++) {
        c = px[p * 4 + ch];
        C[ch * 5] += c; C[ch * 5 + 1] += c * u; C[ch * 5 + 2] += c * v; C[ch * 5 + 3] += c * q; C[ch * 5 + 4] += c * c;
      }
    }
    if (n < 50) return null;
    var mu = su / n, mv = sv / n, cuu = suu / n - mu * mu, cuv = suv / n - mu * mv, cvv = svv / n - mv * mv;
    var det = cuu * cvv - cuv * cuv, mean = [], flat = 0, m00 = 0, m01 = 0, m11 = 0, wsum = 0, rx = 0, ry = 0;
    var A = [n, su, sv, sq, su, suu, suv, suq, sv, suv, svv, svq, sq, suq, svq, sqq];
    for (ch = 0; ch < 3; ch++) {
      var mc = C[ch * 5] / n;
      mean.push(mc);
      flat += C[ch * 5 + 4] - n * mc * mc;
      if (det > 1e-12) {
        var cu = C[ch * 5 + 1] / n - mc * mu, cv = C[ch * 5 + 2] / n - mc * mv;
        var gx = (cvv * cu - cuv * cv) / det, gy = (cuu * cv - cuv * cu) / det;
        m00 += gx * gx; m01 += gx * gy; m11 += gy * gy;
      }
      var sol = solve(A.slice(), [C[ch * 5], C[ch * 5 + 1], C[ch * 5 + 2], C[ch * 5 + 3]], 4);
      if (sol && Math.abs(sol[3]) > 1e-3) {
        var w = sol[3] * sol[3];
        rx += w * -sol[1] / (2 * sol[3]); ry += w * -sol[2] / (2 * sol[3]); wsum += w;
      }
    }
    var res = { n: n, mean: mean, sse: Math.max(0, flat), flat: Math.max(0, flat), type: 'flat' };
    // nothing to shade: skip the profile passes entirely
    if (res.flat < 3 * n * 2.25) return res;
    var models = [];
    if (m00 + m11 > 1e-12) {
      var th = 0.5 * Math.atan2(2 * m01, m00 - m11);
      models.push({ type: 'linear', ux: Math.cos(th), uy: Math.sin(th) });
    }
    if (wsum > 0) {
      rx /= wsum; ry /= wsum;
      // a center far outside the region means the shading is really a ramp
      if (Math.hypot(rx - mu, ry - mv) < 2.5 * Math.sqrt(Math.max(1e-12, cuu + cvv))) models.push({ type: 'radial', rx: rx, ry: ry });
    }
    if (!models.length) return res;

    // Gather the pixels once (coords, colors, interior flag) so profiles can be
    // re-evaluated cheaply, including inside the focal-point search below.
    function gather(stride) {
      var m = Math.ceil(pix.length / stride), G = { U: new Float64Array(m), V: new Float64Array(m), R: new Float64Array(m * 3), I: new Uint8Array(m), m: m, cc: 0 };
      for (var a = 0, kk = 0; kk < pix.length; kk += stride, a++) {
        var pp = pix[kk], xx = pp % W, yy = (pp - xx) / W;
        G.U[a] = (xx - ox) / sc; G.V[a] = (yy - oy) / sc;
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1 || mark[pp - 1] !== stamp || mark[pp + 1] !== stamp || mark[pp - W] !== stamp || mark[pp + W] !== stamp) continue;
        G.I[a] = 1;
        for (var c3 = 0; c3 < 3; c3++) { var cv3 = px[pp * 4 + c3]; G.R[a * 3 + c3] = cv3; G.cc += cv3 * cv3; }
      }
      return G;
    }
    // Position t of a pixel along a model: projection for linear; for radial the
    // t at which the circle centered f + t*e with radius t passes through it
    // (SVG's focal radial gradient; e = 0 gives plain concentric rings).
    function tOf(mdl, uu, vv) {
      if (mdl.type === 'linear') return uu * mdl.ux + vv * mdl.uy;
      var wx = uu - mdl.fx, wy = vv - mdl.fy, wd = wx * mdl.ex + wy * mdl.ey, ww = wx * wx + wy * wy;
      var a2 = mdl.ex * mdl.ex + mdl.ey * mdl.ey - 1;
      return a2 > -1e-9 ? Math.sqrt(ww) : (wd - Math.sqrt(Math.max(0, wd * wd - a2 * ww))) / a2;
    }
    function profile(mdl, G, keepBins) {
      var lo = Infinity, hi = -Infinity, a, T = new Float64Array(G.m);
      for (a = 0; a < G.m; a++) { var t = tOf(mdl, G.U[a], G.V[a]); T[a] = t; if (t < lo) lo = t; if (t > hi) hi = t; }
      if (!(hi > lo)) return null;
      var Bn = new Float64Array(BINS * 4), span = hi - lo;
      for (a = 0; a < G.m; a++) {
        if (!G.I[a]) continue;
        var j = Math.min(BINS - 1, ((T[a] - lo) / span * BINS) | 0) * 4;
        Bn[j]++; Bn[j + 1] += G.R[a * 3]; Bn[j + 2] += G.R[a * 3 + 1]; Bn[j + 3] += G.R[a * 3 + 2];
      }
      var sse = G.cc;
      for (j = 0; j < BINS * 4; j += 4) if (Bn[j]) sse -= (Bn[j + 1] * Bn[j + 1] + Bn[j + 2] * Bn[j + 2] + Bn[j + 3] * Bn[j + 3]) / Bn[j];
      return { sse: Math.max(0, sse), lo: lo, hi: hi, bins: keepBins ? Bn : null };
    }

    var full = gather(step);
    function score(mdl) {
      var pr = profile(mdl, full, true);
      if (!pr) return;
      mdl.sse = pr.sse; mdl.lo = pr.lo; mdl.hi = pr.hi; mdl.bins = pr.bins;
      if (mdl.sse < res.sse) { res.sse = mdl.sse; res.type = mdl.type; res.model = mdl; }
    }
    models.forEach(function (mdl) {
      if (mdl.type === 'radial') { mdl.fx = mdl.rx; mdl.fy = mdl.ry; mdl.ex = 0; mdl.ey = 0; }
      score(mdl);
    });
    // (only worth it when rings clearly describe the region)
    if (refine && res.type === 'radial' && res.sse < 0.6 * res.flat) {
      // Lit 3D shapes have off-center highlights: their rings shift as they
      // grow. Search focal point and ring shift on a sample of the pixels.
      var mdl = res.model, G = gather(Math.max(step, Math.ceil(pix.length / 5000))), spread = Math.sqrt(Math.max(1e-12, cuu + cvv));
      var best = nelderMead(function (x) {
        if (x[2] * x[2] + x[3] * x[3] > 0.9) return Infinity;
        var pr = profile({ type: 'radial', fx: x[0], fy: x[1], ex: x[2], ey: x[3] }, G, false);
        return pr ? pr.sse : Infinity;
      }, [mdl.rx, mdl.ry, 0, 0], [spread * 0.3, spread * 0.3, 0.25, 0.25], 45);
      score({ type: 'radial', fx: best[0], fy: best[1], ex: best[2], ey: best[3] });
    }
    return res;
  }

  function nelderMead(f, x0, steps, iters) {
    var n = x0.length, pts = [x0.slice()], i, j;
    for (i = 0; i < n; i++) { var q = x0.slice(); q[i] += steps[i]; pts.push(q); }
    var vals = pts.map(f);
    function mix(a, b, t) { return a.map(function (v, k) { return v + (b[k] - v) * t; }); }
    for (var it = 0; it < iters; it++) {
      var idx = vals.map(function (_, k) { return k; }).sort(function (a, b) { return vals[a] - vals[b]; });
      pts = idx.map(function (k) { return pts[k]; }); vals = idx.map(function (k) { return vals[k]; });
      var c = new Array(n).fill(0);
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) c[j] += pts[i][j] / n;
      var xr = mix(c, pts[n], -1), fr = f(xr);
      if (fr < vals[0]) {
        var xe = mix(c, pts[n], -2), fe = f(xe);
        if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
      } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else {
        var xc = mix(c, pts[n], 0.5), fc = f(xc);
        if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
        else for (i = 1; i <= n; i++) { pts[i] = mix(pts[0], pts[i], 0.5); vals[i] = f(pts[i]); }
      }
    }
    var b = 0;
    for (i = 1; i <= n; i++) if (vals[i] < vals[b]) b = i;
    return pts[b];
  }

  // Quantizing smooth shading slices it into bands whose borders are soft:
  // the source image barely changes across them. Real edges are sharp. Merge
  // regions across soft borders, softest first, whenever the union is still
  // described by one gradient profile about as well as its parts were.
  function mergeSmooth(px, L, W, H, K, limit) {
    var N = W * H, i, a, b, g, ch;
    var pairs = new Map();
    function edge(p, q, d) {
      a = L[p]; b = L[q];
      if (a === b || a < 0 || b < 0) return;
      var p0 = p - d, q1 = q + d;
      if (p0 < 0 || q1 >= N) return;
      for (g = 0, ch = 0; ch < 3; ch++) g = Math.max(g, Math.abs(px[q1 * 4 + ch] - px[p0 * 4 + ch]));
      var key = Math.min(a, b) * K + Math.max(a, b), e = pairs.get(key);
      if (!e) pairs.set(key, e = [0, 0]);
      e[0]++; e[1] += g / 3;
    }
    for (i = W; i < N - 2 * W; i++) {
      var li = L[i];
      if (li < 0) continue;
      if (L[i + 1] !== li) { var x = i % W; if (x > 0 && x < W - 2) edge(i, i + 1, 1); }
      if (L[i + W] !== li) edge(i, i + W, W);
    }
    var soft = [];
    pairs.forEach(function (e, key) { if (e[0] >= 8 && e[1] / e[0] < 4) soft.push([e[1] / e[0], (key / K) | 0, key % K]); });
    if (!soft.length) return;
    soft.sort(function (p1, p2) { return p1[0] - p2[0]; });

    var count = new Int32Array(K), lists = [], parent = new Int32Array(K), rep = [], mark = new Int32Array(N), stamp = 0;
    for (i = 0; i < N; i++) if (L[i] >= 0) count[L[i]]++;
    for (i = 0; i < K; i++) { lists.push(new Int32Array(count[i])); count[i] = 0; parent[i] = i; }
    for (i = 0; i < N; i++) if (L[i] >= 0) lists[L[i]][count[L[i]]++] = i;
    function find(v) { while (parent[v] !== v) v = parent[v] = parent[parent[v]]; return v; }
    function rms(pix, refine) {
      stamp++;
      for (var k = 0; k < pix.length; k++) mark[pix[k]] = stamp;
      // a sample is plenty to judge a merge; the final gradient uses every pixel
      var s = shading(px, pix, W, H, mark, stamp, Math.max(1, (pix.length / 20000) | 0), refine);
      return s ? Math.sqrt(s.sse / (3 * s.n)) : Infinity;
    }
    var merged = false;
    for (i = 0; i < soft.length; i++) {
      var ra = find(soft[i][1]), rb = find(soft[i][2]);
      if (ra === rb) continue;
      var union = new Int32Array(lists[ra].length + lists[rb].length);
      union.set(lists[ra]); union.set(lists[rb], lists[ra].length);
      if (rep[ra] === undefined) rep[ra] = rms(lists[ra]);
      if (rep[rb] === undefined) rep[rb] = rms(lists[rb]);
      var err = rms(union), cap = Math.max(rep[ra], rep[rb]) * 1.25 + 1;
      // close calls get the slower focal-point fit before being turned down
      if ((!(err < limit) || err > cap) && err < 1.6 * Math.min(limit, cap)) err = rms(union, true);
      if (!(err < limit) || err > cap) continue;
      parent[rb] = ra; lists[ra] = union; lists[rb] = null; rep[ra] = err;
      merged = true;
    }
    if (merged) for (i = 0; i < N; i++) if (L[i] >= 0) L[i] = find(L[i]);
  }

  // Turns each region's best shading model into an SVG gradient.
  function fitGradients(px, L, W, H, K) {
    var N = W * H, count = new Int32Array(K), lists = [], out = new Array(K), mark = new Int32Array(N), i, l;
    var ox = W / 2, oy = H / 2, sc = Math.max(W, H) / 2;
    for (i = 0; i < N; i++) if (L[i] >= 0) count[L[i]]++;
    for (l = 0; l < K; l++) { lists.push(count[l] >= 400 ? new Int32Array(count[l]) : null); count[l] = 0; }
    for (i = 0; i < N; i++) { l = L[i]; if (l >= 0 && lists[l]) lists[l][count[l]++] = i; }
    for (l = 0; l < K; l++) {
      if (!lists[l]) continue;
      for (i = 0; i < lists[l].length; i++) mark[lists[l][i]] = l + 1;
      var s = shading(px, lists[l], W, H, mark, l + 1, 1, true);
      // the gradient has to explain a real share of the variation
      if (!s || s.type === 'flat' || s.sse > 0.6 * s.flat) continue;
      var m = s.model, stops = [];
      for (var j = 0; j < BINS; j++) {
        var B = m.bins, c = B[j * 4];
        if (!c) continue;
        var t = m.lo + (j + 0.5) / BINS * (m.hi - m.lo);
        stops.push([m.type === 'linear' ? (j + 0.5) / BINS : t / m.hi, [B[j * 4 + 1] / c, B[j * 4 + 2] / c, B[j * 4 + 3] / c]]);
      }
      stops = thinStops(stops, 2.5);
      var span = 0;
      for (j = 1; j < stops.length; j++) for (var ch = 0; ch < 3; ch++) span = Math.max(span, Math.abs(stops[j][1][ch] - stops[0][1][ch]));
      if (stops.length < 2 || span < 8) continue;
      var g = { type: m.type, stops: stops.map(function (st) { return [Math.round(st[0] * 1000) / 1000, hex(st[1].map(function (v) { return clamp(Math.round(v), 0, 255); }))]; }) };
      if (m.type === 'linear') {
        g.x1 = round1(ox + m.ux * m.lo * sc); g.y1 = round1(oy + m.uy * m.lo * sc);
        g.x2 = round1(ox + m.ux * m.hi * sc); g.y2 = round1(oy + m.uy * m.hi * sc);
      } else {
        g.cx = round1(ox + (m.fx + m.ex * m.hi) * sc); g.cy = round1(oy + (m.fy + m.ey * m.hi) * sc); g.r = round1(m.hi * sc);
        if (m.ex || m.ey) { g.fx = round1(ox + m.fx * sc); g.fy = round1(oy + m.fy * sc); }
      }
      g.from = g.stops[0][1]; g.to = g.stops[g.stops.length - 1][1];
      out[l] = g;
    }
    return out;
  }

  // Drops gradient stops that the stops either side of them already predict
  // to within `tol` (0-255), most redundant first.
  function thinStops(stops, tol) {
    for (;;) {
      var bestI = -1, bestE = tol;
      for (var i = 1; i < stops.length - 1; i++) {
        var a = stops[i - 1], b = stops[i + 1], t = (stops[i][0] - a[0]) / (b[0] - a[0]), e = 0;
        for (var ch = 0; ch < 3; ch++) e = Math.max(e, Math.abs(a[1][ch] + (b[1][ch] - a[1][ch]) * t - stops[i][1][ch]));
        if (e < bestE) { bestE = e; bestI = i; }
      }
      if (bestI < 0) return stops;
      stops.splice(bestI, 1);
    }
  }

  // Gaussian elimination with partial pivoting on an n x n row-major matrix.
  function solve(A, b, n) {
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r;
      if (Math.abs(A[piv * n + c]) < 1e-12) return null;
      if (piv !== c) {
        for (var k = 0; k < n; k++) { var t = A[c * n + k]; A[c * n + k] = A[piv * n + k]; A[piv * n + k] = t; }
        t = b[c]; b[c] = b[piv]; b[piv] = t;
      }
      for (r = c + 1; r < n; r++) {
        var m = A[r * n + c] / A[c * n + c];
        for (k = c; k < n; k++) A[r * n + k] -= m * A[c * n + k];
        b[r] -= m * b[c];
      }
    }
    var x = new Array(n);
    for (r = n - 1; r >= 0; r--) {
      var acc = b[r];
      for (k = r + 1; k < n; k++) acc -= A[r * n + k] * x[k];
      x[r] = acc / A[r * n + r];
    }
    return x;
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
    var stops = g.stops.map(function (st) { return '<stop offset="' + st[0] + '" stop-color="' + st[1] + '"/>'; }).join('');
    if (g.type === 'radial') {
      return '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + g.cx + '" cy="' + g.cy + '" r="' + g.r + '"' +
        (g.fx !== undefined ? ' fx="' + g.fx + '" fy="' + g.fy + '"' : '') + '>' + stops + '</radialGradient>';
    }
    return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + g.x1 + '" y1="' + g.y1 + '" x2="' + g.x2 + '" y2="' + g.y2 + '">' + stops + '</linearGradient>';
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
