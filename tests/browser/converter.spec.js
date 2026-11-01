const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{await page.goto('/');});

test('currentColor preserves the grayscale paint used by transparency masks',async({page})=>{
  const result=await page.evaluate(async()=>{
    const data=new Uint8ClampedArray(32*32*4);for(let i=0;i<1024;i++)data.set([255,0,0,128],i*4);
    const source=SVGScan.toSVG(SVGScan.trace({width:32,height:32,data},{gradients:false}));
    const svg=SVG2Code.convert(source,'svg',{currentColor:true}).svg;
    const im=new Image();im.src='data:image/svg+xml,'+encodeURIComponent(svg);await im.decode();
    const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d');g.drawImage(im,0,0);
    return Array.from(g.getImageData(16,16,1,1).data);
  });
  expect(result[3]).toBeGreaterThanOrEqual(126);
  expect(result[3]).toBeLessThanOrEqual(130);
});

test('Android conversion reports unsupported masks rather than exporting an opaque image',async({page})=>{
  const error=await page.evaluate(()=>{
    try {SVG2Code.convert('<svg viewBox="0 0 10 10"><defs><mask id="a"><path fill="#808080" d="M0 0h10v10H0Z"/></mask></defs><g mask="url(#a)"><path fill="red" d="M0 0h10v10H0Z"/></g></svg>','android');return null;}
    catch(e){return e.message;}
  });
  expect(error).toMatch(/Android.*mask|mask.*Android/i);
});
