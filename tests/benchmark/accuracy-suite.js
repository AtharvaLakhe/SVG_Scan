/* Loaded after bench.html and quality-cases.js. */
(function(root){
 'use strict';
 function dataAt(canvas,settings,quality){
  var size=settings.workingSize(canvas.width,canvas.height,quality),c=document.createElement('canvas');
  c.width=size.width;c.height=size.height;var g=c.getContext('2d');g.imageSmoothingQuality='high';
  g.drawImage(canvas,0,0,c.width,c.height);return g.getImageData(0,0,c.width,c.height);
 }
 function metrics(a,b){
  var white=0,black=0,alpha=0,bias=0,n=a.width*a.height,edgeError=0,edges=0;
  for(var i=0;i<a.data.length;i+=4){
   var aa=a.data[i+3]/255,ba=b.data[i+3]/255,ea=b.data[i+3]-a.data[i+3],edge=false;
   alpha+=ea*ea;bias+=ea;
   var pixel=i/4,x=pixel%a.width;
   if(x>0)for(var ch=0;ch<4;ch++)if(Math.abs(a.data[i+ch]-a.data[i-4+ch])>=32)edge=true;
   if(pixel>=a.width)for(ch=0;ch<4;ch++)if(Math.abs(a.data[i+ch]-a.data[i-a.width*4+ch])>=32)edge=true;
   for(ch=0;ch<3;ch++){
    var d=a.data[i+ch]*aa-b.data[i+ch]*ba,w=d+255*(ba-aa);
    black+=d*d;white+=w*w;if(edge)edgeError+=w*w;
   }
   if(edge)edges++;
  }
  function round(v){return Math.round(v*1000)/1000;}
  return {whiteRmse:round(Math.sqrt(white/(n*3))),blackRmse:round(Math.sqrt(black/(n*3))),alphaRmse:round(Math.sqrt(alpha/n)),alphaBias:round(bias/n),edgeRmse:edges?round(Math.sqrt(edgeError/(edges*3))):0};
 }
 async function sources(localSource){
  var cases=[['logo',logo()],['line-art',lineart()],['orb',orb()],['poster',sunset()],['fox',emoji('🦊')],['rocket',emoji('🚀')]];
  for(var file of ['dog.jpg','mountain.jpg','astronaut.png','camera.png','chelsea.png','coffee.png'])cases.push([file,await load('/tests/fixtures/'+file)]);
  Object.entries(SVGScanQualityCases).forEach(function(entry){cases.push([entry[0],entry[1]()]);});
  var cat=await load('/tests/fixtures/chelsea.png'),c=document.createElement('canvas');c.width=cat.width;c.height=cat.height;
  var g=c.getContext('2d');g.globalAlpha=.3;g.drawImage(cat,0,0);cases.push(['translucent-photo',c]);
  var coffee=await load('../fixtures/coffee.png'),large=document.createElement('canvas');large.width=2400;large.height=1600;
  var lg=large.getContext('2d');
  for(var y=0;y<large.height;y+=coffee.height)for(var x=0;x<large.width;x+=coffee.width)lg.drawImage(coffee,x,y);
  cases.push(['large-texture',large]);
  if(localSource)cases.push(['local-grayscale',await load(localSource)]);
  return cases;
 }
 root.SVGScanAccuracy={sources:sources,dataAt:dataAt,metrics:metrics};
 root.runAccuracy=async function(options){
  options=options||{};
  var cases=await sources(options.localSource),rows=[],gallery=document.createElement('main');
  if(options.filter)cases=cases.filter(function(entry){return options.filter.indexOf(entry[0])>=0;});
  document.body.innerHTML='<header><h1>Image accuracy check</h1><p>Original / previous automatic trace / updated automatic trace. Errors use original source pixels, with white and black composites and alpha measured separately.</p></header>';
  document.body.append(gallery);
  document.head.insertAdjacentHTML('beforeend','<style>body{margin:0;padding:24px;background:#111b18;color:#f1f5ef;font:13px/1.6 system-ui}h1{font-size:26px;margin:0 0 8px}header p{max-width:95ch;color:#a5b7ab;margin-bottom:24px}article{display:grid;grid-template-columns:170px repeat(3,330px);gap:14px;margin-bottom:24px;break-inside:avoid}h2{font-size:14px;margin:0 0 8px}p{margin:0;white-space:pre-line;color:#a5b7ab}figure{margin:0}canvas{display:block;width:330px;height:240px;object-fit:contain;background:repeating-conic-gradient(#fff 0% 25%,#c7d2ca 0% 50%) 50%/16px 16px}figcaption{font-size:11px;color:#a5b7ab;margin-top:7px}</style>');
  for(var entry of cases){
   var name=entry[0],canvas=entry[1],source=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
   var article=document.createElement('article');article.dataset.case=name;
   var info=document.createElement('section');info.innerHTML='<h2>'+name+'</h2>';article.append(info);
   function show(image,caption){var f=document.createElement('figure'),c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(image,0,0);f.append(c);var cap=document.createElement('figcaption');cap.textContent=caption;f.append(cap);article.append(f);}
   show(source,'Original '+source.width+' × '+source.height);
   var result={name,width:source.width,height:source.height};
   for(var mode of ['before','after']){
    var settings=mode==='before'?AccuracyBeforeSettings:SVGScanSettings,engine=mode==='before'?AccuracyBeforeScan:SVGScan;
    var data=dataAt(canvas,settings,mode==='before'?'balanced':'fine');
    var suggestion=mode==='before'?{preset:settings.guessPreset(data),settings:settings.presets[settings.guessPreset(data)]}:settings.recommend(data);
    var o=settings.engineOptions(suggestion.settings,data),start=performance.now(),r=engine.trace(data,o),ms=performance.now()-start;
    var svg=engine.toSVG(r,{width:source.width,height:source.height,preserveAspectRatio:mode==='after'?'none':undefined});
    var render=await rasterize(svg,source.width,source.height),m=metrics(source,render);
    result[mode]=Object.assign({preset:suggestion.preset,workingWidth:data.width,workingHeight:data.height,colors:r.layers.length,nodes:r.stats.nodes+(r.stats.alphaNodes||0),bytes:new Blob([svg]).size,traceMs:Math.round(ms)},m);
    show(render,(mode==='before'?'Previous':'Updated')+' / RGB '+m.whiteRmse.toFixed(2)+' / alpha '+m.alphaRmse.toFixed(2));
   }
   var text=document.createElement('p');text.textContent='RGB: '+result.before.whiteRmse+' → '+result.after.whiteRmse+'\nEdge: '+result.before.edgeRmse+' → '+result.after.edgeRmse+'\nAlpha: '+result.before.alphaRmse+' → '+result.after.alphaRmse+'\nSVG: '+(result.before.bytes/1048576).toFixed(2)+' → '+(result.after.bytes/1048576).toFixed(2)+' MB';info.append(text);gallery.append(article);rows.push(result);
  }
  return rows;
 };
})(window);
