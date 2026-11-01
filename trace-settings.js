/* SVG Scan shared trace settings. MIT License. No runtime dependencies. */
(function (root) {
  'use strict';
  var presets = {
    logo: { colors: 6, detail: 72, smooth: 55, noise: 22, blur: 0, majority: 0, denoise: 0, dehalo: true },
    illustration: { colors: 14, detail: 60, smooth: 72, noise: 30, blur: 1, majority: 2, denoise: 0, dehalo: true },
    photo: { colors: 20, detail: 45, smooth: 80, noise: 50, blur: 2, majority: 3, denoise: 0, dehalo: true },
    lineart: { colors: 2, detail: 75, smooth: 62, noise: 26, blur: 0, majority: 0, denoise: 0, dehalo: true },
    detailed: { colors: 64, detail: 85, smooth: 24, noise: 0, blur: 0, majority: 0, denoise: 0, dehalo: false, merge: 0 },
    clean: { colors: 64, detail: 80, smooth: 80, noise: 0, blur: 0, majority: 0, denoise: 100, dehalo: false, merge: 0 }
  };

  function guessPreset(img) {
    var d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / 20000));
    var seen = new Set(), fine = new Set();
    var gray = 0, opaque = 0;
    for (var i = 0; i < n; i += step) {
      var j = i * 4;
      if (!d[j + 3]) continue;
      opaque++;
      seen.add((d[j] >> 3) << 10 | (d[j + 1] >> 3) << 5 | (d[j + 2] >> 3));
      fine.add((d[j] << 16) | (d[j + 1] << 8) | d[j + 2]);
      if (Math.abs(d[j] - d[j + 1]) < 14 && Math.abs(d[j + 1] - d[j + 2]) < 14) gray++;
    }
    // Muted photos can share few coarse colors while containing thousands of
    // subtle tones. Don't mistake their texture for flat illustration fills.
    if (fine.size > 4000) return 'detailed';
    // Grayscale can contain at most 256 exact tones (32 after coarse binning),
    // even in a richly shaded photo. Color count alone is not evidence of ink.
    // Favor retaining tones; the compact two-color preset remains explicit.
    if (opaque && gray / opaque > 0.97) {
      if (fine.size <= 2) return 'lineart';
      if (fine.size <= 6) return 'logo';
      return 'detailed';
    }
    if (seen.size <= 40) return 'logo';
    if (seen.size < 900) return 'illustration';
    return 'detailed';
  }

  function workingSize(width, height, quality) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError('Image dimensions must be positive integers.');
    var limit = { fast: 900, balanced: 1400, fine: 2200 }[quality] || 1400;
    var longest = Math.max(width, height);
    var scale = Math.min(1, limit / longest);
    scale = Math.min(scale, Math.sqrt(4000000 / (width * height)));
    var w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    return { width: w, height: h };
  }

  function simpleRamp(img) {
    var W = img.width, H = img.height, d = img.data;
    var tl = 0, tr = (W - 1) * 4, bl = (H - 1) * W * 4, br = (W * H - 1) * 4;
    function close(a, b) { for (var ch = 0; ch < 3; ch++) if (Math.abs(d[a + ch] - d[b + ch]) > 3) return false; return true; }
    var horizontal = close(tl, bl) && close(tr, br), vertical = close(tl, tr) && close(bl, br);
    if (!horizontal && !vertical) return false;
    var end = horizontal ? tr : bl, length = Math.max(1, (horizontal ? W : H) - 1), sum = 0;
    // Verify every pixel, including rare marks. Similar corner colors alone
    // cannot distinguish a true ramp from several differently shaded objects.
    for (var i = 0; i < W * H; i++) {
      var j = i * 4;
      if (!d[j + 3]) return false;
      var t = (horizontal ? i % W : Math.floor(i / W)) / length;
      for (var ch = 0; ch < 3; ch++) {
        var e = d[j + ch] - (d[ch] + (d[end + ch] - d[ch]) * t);
        if (Math.abs(e) > 4) return false;
        sum += e * e;
      }
    }
    return sum / (W * H * 3) < 2.25;
  }

  function recommend(img) {
    var colors = new Set(), d = img.data, n = img.width * img.height;
    // Inspect every visible pixel: sampled analysis can miss small accents.
    // A bounded exact palette is both more accurate and cheaper than cleanup.
    for (var i = 0; i < n && colors.size <= 128; i++) {
      var j = i * 4;
      if (d[j + 3]) colors.add((d[j] << 16) | (d[j + 1] << 8) | d[j + 2]);
    }
    if (colors.size && colors.size <= 128) {
      var key = guessPreset(img) === 'lineart' ? 'lineart' : 'logo';
      return { preset: key, exactColors: colors.size, settings: Object.assign({}, presets[key], {
        colors: Math.max(2, colors.size), detail: 100, smooth: 0, noise: 0,
        blur: 0, majority: 0, denoise: 0, dehalo: false, merge: 0, gradients: false
      }) };
    }
    // Rich and antialiased artwork starts with fidelity. Compact/clean presets
    // remain deliberate choices, rather than silently discarding source detail.
    var preset = guessPreset(img) === 'logo' && simpleRamp(img) ? 'logo' : 'detailed';
    var settings = Object.assign({}, presets[preset]);
    // Native small photos need more tonal resolution; their lower pixel count
    // keeps this within a practical geometry budget. Large detailed images use
    // the standard 64-tone profile; more colors remain an explicit control.
    if (preset === 'detailed' && Math.max(img.width, img.height) < 900) settings.colors = 96;
    return { preset: preset, exactColors: null, settings: settings };
  }

  function engineOptions(settings, size) {
    var d = +settings.detail, s = +settings.smooth, n = +settings.noise;
    return {
      colors: +settings.colors,
      tolerance: .25 + Math.pow(1 - d / 100, 1.5) * 3.2,
      smoothness: s / 100 * 1.3,
      corner: 42 + s * .28,
      noise: Math.max(1, Math.round(n * n / 12 * size.width * size.height / 1e6)),
      blur: settings.blur || 0,
      majority: settings.majority || 0,
      denoise: +settings.denoise || 0,
      dehalo: settings.dehalo !== false,
      gradients: settings.gradients !== false,
      merge: settings.merge === undefined ? 6 : settings.merge,
      precision: 1
    };
  }

  var api = { presets: presets, guessPreset: guessPreset, recommend: recommend, workingSize: workingSize, engineOptions: engineOptions };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SVGScanSettings = api;
})(typeof self !== 'undefined' ? self : globalThis);
