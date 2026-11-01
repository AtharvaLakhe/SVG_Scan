// Serve the repository, then npm run bench:accuracy. Git supplies the pinned baseline.
const{chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const baseline='f9e375ddb556690f94be92de0977cb00c8164824';
const repo=path.resolve(__dirname,'../..');
(async()=>{
 const git=process.env.SVG_SCAN_GIT||'git';
 const previous=file=>execFileSync(git,['show',baseline+':'+file],{cwd:repo,encoding:'utf8'});
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.goto((process.env.SVG_SCAN_ORIGIN||'http://127.0.0.1:8765')+'/tests/benchmark/bench.html');
  await page.addScriptTag({content:previous('tracer.js').replace('root.SVGScan = api;','root.AccuracyBeforeScan = api;')});
  await page.addScriptTag({content:previous('trace-settings.js').replace('root.SVGScanSettings = api;','root.AccuracyBeforeSettings = api;')});
  await page.addScriptTag({path:path.join(__dirname,'quality-cases.js')});
  await page.addScriptTag({path:path.join(__dirname,'accuracy-suite.js')});
  const rows=await page.evaluate(options=>runAccuracy(options),{localSource:process.env.SVG_SCAN_LOCAL_IMAGE||null});
  const result={date:new Date().toISOString(),browser:browser.version(),baselineRevision:baseline,comparison:'Previous automatic Balanced settings vs updated automatic Fine settings; identical source files, rendered at original dimensions.',metric:'RGB RMSE on white and black (0–255), alpha RMSE/bias, and RGB RMSE at source edges. Lower RMS is better; alpha bias should be near zero.',cases:rows};
  // Keep private/local sources out of the tracked report.
  const tracked={...result,cases:rows.filter(r=>r.name!=='local-grayscale')};
  fs.writeFileSync(path.join(__dirname,'accuracy-results.json'),JSON.stringify(tracked,null,2)+'\n');
  if(process.env.SVG_SCAN_REPORT_DIR){
   const dir=path.resolve(process.env.SVG_SCAN_REPORT_DIR);fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,'accuracy-results.json'),JSON.stringify(result,null,2)+'\n');
   await page.screenshot({path:path.join(dir,'accuracy-all-images.png'),fullPage:true});
   await page.evaluate(()=>{
    const specs=[['logo',250,65],['line-art',275,65],['astronaut.png',170,65],['chelsea.png',170,120],['pixel-art',25,35],['soft-alpha',50,100]];
    const detail=document.createElement('main');detail.id='accuracyDetails';detail.hidden=true;
    for(const[name,x,y]of specs){
     const article=document.querySelector('article[data-case="'+name+'"]'),row=document.createElement('article'),label=document.createElement('section');
     label.innerHTML='<h2>'+name+' at 300%</h2>';row.append(label);
     article.querySelectorAll('canvas').forEach(source=>{const f=document.createElement('figure'),c=document.createElement('canvas');c.width=110;c.height=80;c.getContext('2d').drawImage(source,x,y,110,80,0,0,110,80);f.append(c);row.append(f);});
     detail.append(row);
    }
    document.body.append(detail);
   });
   await page.evaluate(()=>{
    const keep=new Set(['line-art','astronaut.png','coffee.png','opposed-shading','pixel-art','translucent-photo']);
    document.querySelectorAll('body>main:not(#accuracyDetails)>article').forEach(el=>{if(!keep.has(el.dataset.case))el.remove();});
   });
   await page.screenshot({path:path.join(dir,'accuracy-highlights.png'),fullPage:true});
   await page.evaluate(()=>{document.querySelector('body>main').hidden=true;document.querySelector('#accuracyDetails').hidden=false;});
   await page.screenshot({path:path.join(dir,'accuracy-300-percent.png'),fullPage:true});
  }
  console.log(JSON.stringify({tested:rows.length,results:rows.map(r=>({name:r.name,before:r.before.whiteRmse,after:r.after.whiteRmse,alphaBefore:r.before.alphaRmse,alphaAfter:r.after.alphaRmse,bytes:r.after.bytes}))}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
