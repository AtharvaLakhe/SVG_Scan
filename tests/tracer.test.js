'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trace, toSVG } = require('../tracer.js');

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const exact = { noise: 0, dehalo: false, gradients: false, smoothness: 0, tolerance: .2, stacked: false };

test('detailed palettes preserve more than 64 distinct flat colors', () => {
  const src = image(100, 80, (x, y) => {
    const i = Math.floor(y / 10) * 10 + Math.floor(x / 10);
    return [(i % 5) * 60, (Math.floor(i / 5) % 4) * 80, Math.floor(i / 20) * 80, 255];
  });
  const result = trace(src, { ...exact, colors: 128 });
  assert.equal(result.layers.length, 80);
});

test('a rare one-pixel accent is represented even between palette sample positions', () => {
  const src = image(400, 200, (x, y) => x === 201 && y === 101 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
  const result = trace(src, { ...exact, colors: 2 });
  assert.ok(result.layers.some(l => l.color === '#ff0000' && l.d));
});

test('a single opaque pixel produces a nonempty path', () => {
  const result = trace(image(1, 1, () => [12, 34, 56, 255]), exact);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].color, '#0c2238');
  assert.ok(result.layers[0].d.endsWith('z'));
});

test('translucent pixels survive in an SVG opacity mask applied once', () => {
  const src = image(40, 20, x => [255, x < 20 ? 0 : 255, 0, 64]);
  const result = trace(src, { ...exact, colors: 2, stacked: true });
  assert.equal(result.layers.length, 2);
  assert.ok(result.alpha && result.alpha.length);
  const svg = toSVG(result);
  assert.match(svg, /<mask /);
  assert.equal((svg.match(/<g mask=/g) || []).length, 1);
  assert.doesNotMatch(svg, /<image|data:image/);
});

test('fully transparent image has no paths or opacity mask', () => {
  const result = trace(image(12, 12, () => [255, 0, 0, 0]));
  assert.equal(result.layers.length, 0);
  assert.ok(!result.alpha || !result.alpha.length);
});

test('opaque images do not gain a mask and tracing is deterministic', () => {
  const src = image(20, 20, x => x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.equal(toSVG(trace(src, exact)), toSVG(trace(src, exact)));
  assert.doesNotMatch(toSVG(trace(src, exact)), /<mask/);
});

for (const [name, src] of [
  ['zero width', { width: 0, height: 1, data: new Uint8ClampedArray(0) }],
  ['fractional width', { width: 1.5, height: 2, data: new Uint8ClampedArray(12) }],
  ['short buffer', { width: 2, height: 2, data: new Uint8ClampedArray(4) }],
  ['oversized image', { width: 100000, height: 100000, data: new Uint8ClampedArray(4) }],
  ['missing image', null]
]) test('rejects ' + name + ' before tracing', () => assert.throws(() => trace(src), /image|pixel|dimension|RGBA/i));

test('rejects nonfinite controls rather than silently producing invalid geometry', () => {
  const src = image(10, 10, () => [0, 0, 0, 255]);
  for (const key of ['colors', 'tolerance', 'noise', 'smoothness', 'majority', 'precision', 'denoise']) {
    assert.throws(() => trace(src, { [key]: Infinity }), /finite|option/i, key);
  }
});

test('edge-aware denoising preserves a narrow contrasting line', () => {
  const src = image(32, 32, x => x === 16 ? [0, 0, 0, 255] : [240, 240, 240, 255]);
  const result = trace(src, { ...exact, colors: 2, denoise: 80 });
  assert.ok(result.layers.some(l => l.color === '#000000' && l.coverage >= .03));
});

test('cleanup preserves a transparent pinhole surrounded by opaque pixels', () => {
  const src = image(21, 21, (x, y) => [255, 0, 0, x === 10 && y === 10 ? 0 : 255]);
  const result = trace(src, { colors: 2, noise: 20, majority: 2, gradients: false, smoothness: 0, tolerance: .2 });
  assert.ok((result.layers[0].d.match(/M/g) || []).length >= 2, 'hole remains a separate loop');
});

test('signed RGBA arrays are rejected instead of generating malformed colors', () => {
  assert.throws(() => trace({width:1,height:1,data:new Int8Array([-1,0,0,-1])}), /RGBA|byte/i);
});

test('noisy transparency is bounded before building millions of vector mask nodes', () => {
  let seed = 7;
  const src = image(256,256,()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return [255,0,0,1+(seed>>>24)%255];
  });
  assert.throws(()=>trace(src,{gradients:false,noise:0}),/transparency.*detail|transparency.*complex/i);
});
