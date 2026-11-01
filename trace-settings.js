/* SVG Scan shared trace settings. MIT License. No runtime dependencies. */
(function (root) {
  'use strict';
  var presets = {
    logo: { colors: 6, detail: 72, smooth: 55, noise: 22, blur: 0, majority: 0, denoise: 0, dehalo: true },
    illustration: { colors: 14, detail: 60, smooth: 72, noise: 30, blur: 1, majority: 2, denoise: 0, dehalo: true },
    photo: { colors: 20, detail: 45, smooth: 80, noise: 50, blur: 2, majority: 3, denoise: 0, dehalo: true },
    lineart: { colors: 2, detail: 75, smooth: 62, noise: 26, blur: 0, majority: 0, denoise: 0, dehalo: true },
    detailed: { colors: 64, detail: 85, smooth: 24, noise: 5, blur: 0, majority: 0, denoise: 0, dehalo: false }
  };

  function workingSize(width, height, quality) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError('Image dimensions must be positive integers.');
    var limit = { fast: 900, balanced: 1400, fine: 2200 }[quality] || 1400;
    var longest = Math.max(width, height);
    var scale = longest < 900 ? Math.min(4, 900 / longest) : Math.min(1, limit / longest);
    scale = Math.min(scale, Math.sqrt(4000000 / (width * height)));
    var w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    return { width: w, height: h };
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
      merge: settings.dehalo === false ? 3 : 6,
      precision: 1
    };
  }

  var api = { presets: presets, workingSize: workingSize, engineOptions: engineOptions };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SVGScanSettings = api;
})(typeof self !== 'undefined' ? self : globalThis);
