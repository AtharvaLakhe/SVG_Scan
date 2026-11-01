const {test,expect}=require('@playwright/test');
test('detailed photo traces remain substantially more faithful than compact traces',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/tests/benchmark/bench.html');
  const results=await page.evaluate(async()=>{
    const compact=await runBench(['dog','mountain']);
    const detailed=await runBench(['dog','mountain'],{preset:'detailed'});
    return {compact,detailed};
  });
  for(let i=0;i<2;i++){
    expect(results.detailed[i].rmse).toBeLessThan(results.compact[i].rmse*.85);
    // Keeping tiny shaded regions increases output size; retain a fixture
    // budget without requiring the destructive cleanup that lost their detail.
    expect(results.detailed[i].bytes).toBeLessThan(8*1024*1024);
  }
});

test('native automatic portrait and texture traces meet their fidelity budgets',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/tests/benchmark/bench.html');
  const results=await page.evaluate(async()=>{
    const out=[];
    for(const file of ['astronaut.png','coffee.png','chelsea.png','camera.png']){
      const c=await load('/tests/fixtures/'+file),data=prep(c,'fine'),source=c.getContext('2d').getImageData(0,0,c.width,c.height);
      const suggestion=SVGScanSettings.recommend(data),r=SVGScan.trace(data,engineOpts(suggestion.settings,data));
      const svg=SVGScan.toSVG(r);out.push({file,error:err(source,await rasterize(svg,c.width,c.height)),bytes:svg.length});
    }
    return out;
  });
  const budgets={'astronaut.png':7,'coffee.png':6.5,'chelsea.png':4.5,'camera.png':5};
  for(const result of results){
    expect(result.error,result.file).toBeLessThan(budgets[result.file]);
    expect(result.bytes,result.file).toBeLessThan(8*1024*1024);
  }
});

test('separate shading directions remain accurate while a single ramp stays compact',async({page})=>{
  await page.goto('/tests/benchmark/bench.html');
  await page.addScriptTag({url:'/tests/benchmark/quality-cases.js'});
  const results=await page.evaluate(async()=>{
    const out=[];
    for(const name of ['opposed-shading','blue-ramp']){
      const c=SVGScanQualityCases[name](),data=prep(c,'fine'),source=c.getContext('2d').getImageData(0,0,c.width,c.height);
      const suggestion=SVGScanSettings.recommend(data),r=SVGScan.trace(data,engineOpts(suggestion.settings,data)),svg=SVGScan.toSVG(r);
      out.push({name,error:err(source,await rasterize(svg,c.width,c.height)),bytes:svg.length});
    }
    return out;
  });
  expect(results[0].error).toBeLessThan(4);
  expect(results[1].error).toBeLessThan(1.5);
  expect(results[1].bytes).toBeLessThan(4096);
});

test('Fine retains more native detail in a large textured image than Balanced',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/tests/benchmark/bench.html');
  const results=await page.evaluate(async()=>{
    const tile=await load('../fixtures/coffee.png'),c=document.createElement('canvas');c.width=1800;c.height=1200;
    const g=c.getContext('2d');for(let y=0;y<c.height;y+=tile.height)for(let x=0;x<c.width;x+=tile.width)g.drawImage(tile,x,y);
    const source=g.getImageData(0,0,c.width,c.height),results=[];
    for(const quality of ['balanced','fine']){
      const data=prep(c,quality),suggestion=SVGScanSettings.recommend(data);
      const r=SVGScan.trace(data,engineOpts(suggestion.settings,data));
      const svg=SVGScan.toSVG(r,{width:c.width,height:c.height,preserveAspectRatio:'none'});
      results.push({quality,error:err(source,await rasterize(svg,c.width,c.height)),bytes:svg.length});
    }
    return results;
  });
  expect(results[1].error).toBeLessThan(results[0].error*.95);
  expect(results[1].bytes).toBeLessThan(32*1024*1024);
});
