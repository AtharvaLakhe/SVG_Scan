'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../trace-settings.js');

test('fine resolution preserves more working pixels than balanced on large images', () => {
  const fine = settings.workingSize(4000, 3000, 'fine');
  const balanced = settings.workingSize(4000, 3000, 'balanced');
  assert.ok(fine.width > balanced.width);
  assert.ok(fine.width * fine.height <= 4000000);
  assert.ok(Math.abs(fine.width / fine.height - 4 / 3) < .002);
});

test('working dimensions remain bounded for extreme aspect ratios and square images', () => {
  for (const [w, h] of [[20000,1], [1,20000], [10000,10000], [1,1], [200,100]]) {
    for (const quality of ['fast','balanced','fine']) {
      const size = settings.workingSize(w,h,quality);
      assert.ok(size.width >= 1 && size.height >= 1);
      assert.ok(size.width * size.height <= 4000000);
      assert.ok(Math.max(size.width, size.height) <= 2200);
    }
  }
});

test('detailed preset keeps texture without forced blur or majority filtering', () => {
  const options = settings.engineOptions(settings.presets.detailed, {width:1000,height:1000});
  assert.ok(options.colors >= 64);
  assert.ok(options.noise <= 4);
  assert.ok(options.tolerance < .7);
  assert.equal(options.blur, 0);
  assert.equal(options.majority, 0);
  assert.equal(options.dehalo, false);
});

test('sizing rejects invalid image dimensions', () => {
  for (const [w,h] of [[0,100],[NaN,10],[-1,10],[10,Infinity]]) assert.throws(() => settings.workingSize(w,h), /dimension/i);
});

function pixels(width,height,at) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(at(x,y),(y*width+x)*4);
  return {width,height,data};
}

test('a dark background does not hide the tonal detail in grayscale artwork',()=>{
  const source=pixels(200,200,(x,y)=>{
    const v=x>=90&&x<110&&y>=90&&y<110 ? 10+(x+y*7)%170 : 0;
    return [v,v,v,255];
  });
  assert.equal(settings.guessPreset(source),'detailed');
});

test('genuine two-tone line art still receives the compact line-art preset',()=>{
  assert.equal(settings.guessPreset(pixels(80,60,x=>x<40?[0,0,0,255]:[255,255,255,255])),'lineart');
});

test('three distinct gray fills are kept instead of being forced into two colors',()=>{
  assert.equal(settings.guessPreset(pixels(90,60,x=>{const v=x<30?0:x<60?128:255;return [v,v,v,255];})),'logo');
});

test('grayscale photographs with a full tonal range receive Detailed',()=>{
  assert.equal(settings.guessPreset(pixels(256,32,x=>[x,x,x,255])),'detailed');
});
