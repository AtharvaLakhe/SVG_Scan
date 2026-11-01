/* Deterministic browser quality fixtures; no dependencies or external requests. */
(function(root){
 'use strict';
 function canvas(w,h,draw){var c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);return c;}
 var makers={
  'blue-ramp':function(){return canvas(512,240,function(g,w,h){var ramp=g.createLinearGradient(0,0,w,0);ramp.addColorStop(0,'#123577');ramp.addColorStop(1,'#4a8dd0');g.fillStyle=ramp;g.fillRect(0,0,w,h);});},
  'opposed-shading':function(){return canvas(512,320,function(g){g.fillStyle='#fff';g.fillRect(0,0,512,320);for(var j=0;j<4;j++){var x=20+(j%2)*250,y=20+Math.floor(j/2)*150;var r=g.createLinearGradient(x,y,x+(j%2?0:200),y+(j%2?100:0));r.addColorStop(0,j<2?'#123577':'#4a8dd0');r.addColorStop(1,j<2?'#4a8dd0':'#123577');g.fillStyle=r;g.fillRect(x,y,200,100);}});},
  'translucent-palette':function(){return canvas(384,192,function(g){var colors=['#ef4444','#f59e0b','#facc15','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#d946ef','#ec4899'];g.globalAlpha=.3;colors.forEach(function(c,i){g.fillStyle=c;g.fillRect((i%6)*64,Math.floor(i/6)*96,64,96);});});},
  'transparent-curves':function(){return canvas(400,260,function(g){g.lineCap='round';g.lineWidth=3;['#ed4676','#2563eb','#14b8a6'].forEach(function(c,j){g.strokeStyle=c;g.beginPath();g.moveTo(20,40+j*70);g.bezierCurveTo(90,-10+j*70,210,130+j*40,380,20+j*90);g.stroke();});g.fillStyle='rgba(245,158,11,.35)';g.beginPath();g.arc(210,120,66,0,Math.PI*2);g.fill();});},
  'soft-alpha':function(){return canvas(256,256,function(g){var r=g.createRadialGradient(128,128,15,128,128,120);r.addColorStop(0,'rgba(80,180,250,.7)');r.addColorStop(1,'rgba(80,180,250,0)');g.fillStyle=r;g.fillRect(0,0,256,256);});},
  'fine-ink':function(){return canvas(1000,700,function(g,w,h){g.fillStyle='#fff';g.fillRect(0,0,w,h);g.strokeStyle='#111';g.lineWidth=1;for(var y=50;y<650;y+=24){g.beginPath();g.moveTo(50,y);g.bezierCurveTo(250,y-30,700,y+30,940,y);g.stroke();}g.fillStyle='#111';for(var x=70;x<940;x+=29)g.fillRect(x,665,2,2);g.font='18px sans-serif';g.fillText('Fine ink, small type & punctuation.',50,30);});},
  'pixel-art':function(){return canvas(160,160,function(g){g.fillStyle='#f1eee6';g.fillRect(0,0,160,160);g.fillStyle='#274c77';g.fillRect(30,30,100,100);g.fillStyle='#ef476f';for(var i=0;i<8;i++)g.fillRect(35+i*12,50+i*7,1,1);g.fillStyle='#ffd166';g.fillRect(60,60,40,40);});}
 };
 root.SVGScanQualityCases=makers;
})(typeof window!=='undefined'?window:globalThis);
