const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => { await page.goto('/tests/benchmark/bench.html'); });

test('translucent overlapping color layers apply opacity once', async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const c=document.createElement('canvas'); c.width=80;c.height=40;
    const g=c.getContext('2d');g.fillStyle='rgba(255,0,0,.25)';g.fillRect(0,0,60,40);
    g.fillStyle='rgba(0,0,255,.25)';g.clearRect(60,0,20,40);g.fillRect(60,0,20,40);
    const source=g.getImageData(0,0,80,40);
    const result=SVGScan.trace(source,{colors:2,noise:0,gradients:false});
    const rendered=await rasterize(SVGScan.toSVG(result),80,40);
    return [rendered.data[(20*80+20)*4+3],rendered.data[(20*80+70)*4+3]];
  });
  for (const alpha of samples) expect(alpha).toBeGreaterThanOrEqual(62);
  for (const alpha of samples) expect(alpha).toBeLessThanOrEqual(66);
});

test('blur respects original transparency and hidden RGB', async ({ page }) => {
  const samples=await page.evaluate(async()=>{
    const data=new Uint8ClampedArray(40*40*4);
    for(let y=0;y<40;y++)for(let x=0;x<40;x++){
      const p=(y*40+x)*4;
      data[p]=x>=10&&x<30?255:0;
      data[p+2]=x>=10&&x<30?0:255;
      data[p+3]=x>=10&&x<30?255:0;
    }
    const r=SVGScan.trace({width:40,height:40,data},{colors:2,blur:2,noise:0,gradients:false,tolerance:.2,smoothness:0});
    const out=await rasterize(SVGScan.toSVG(r),40,40);
    return {outside:out.data[(20*40+8)*4+3],edge:Array.from(out.data.slice((20*40+11)*4,(20*40+11)*4+4))};
  });
  expect(samples.outside).toBe(0);
  expect(samples.edge[0]).toBeGreaterThan(250);
  expect(samples.edge[2]).toBeLessThan(5);
});

test('transparent holes and a one-pixel accent survive SVG rendering',async({page})=>{
  const samples=await page.evaluate(async()=>{
    const data=new Uint8ClampedArray(40*40*4);
    for(let i=0;i<1600;i++)data.set([255,255,255,255],i*4);
    data.set([255,0,0,255],(20*40+20)*4);data[(10*40+10)*4+3]=0;
    const r=SVGScan.trace({width:40,height:40,data},{colors:2,noise:0,dehalo:false,gradients:false,tolerance:.2,smoothness:0});
    const out=await rasterize(SVGScan.toSVG(r),40,40);
    return {hole:out.data[(10*40+10)*4+3],accent:Array.from(out.data.slice((20*40+20)*4,(20*40+20)*4+4))};
  });
  expect(samples.hole).toBeLessThan(50);
  expect(samples.accent[0]).toBe(255);
  expect(samples.accent[1]).toBeLessThan(100);
});

test('Detailed preserves isolated shaded marks in a large grayscale image',async({page})=>{
  const rmse=await page.evaluate(async()=>{
    const width=1000,height=1000,data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<width*height;i++)data[i*4+3]=255;
    let seed=7;
    for(let y=400;y<600;y++)for(let x=400;x<600;x++){
      if(x%3 || y%3) continue;
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const v=32+((seed>>>24)%16)*8;data.set([v,v,v,255],(y*width+x)*4);
    }
    const source={width,height,data};
    const options=SVGScanSettings.engineOptions(SVGScanSettings.presets.detailed,source);
    const out=await rasterize(SVGScan.toSVG(SVGScan.trace(source,options)),width,height);
    let sse=0;
    for(let y=400;y<600;y++)for(let x=400;x<600;x++){
      const j=(y*width+x)*4,e=data[j]-out.data[j];sse+=e*e;
    }
    return Math.sqrt(sse/40000);
  });
  expect(rmse).toBeLessThan(10);
});
