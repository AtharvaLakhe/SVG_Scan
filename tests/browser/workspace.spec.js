const {test,expect}=require('@playwright/test');

async function traceSample(page){
  await page.goto('/');
  await page.locator('.sample[data-sample="sunset"]').click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
}

test('focus mode preserves the vector and Escape respects an open dialog',async({page})=>{
  await traceSample(page);
  const paths=await page.locator('#vector .trace-layer').count();
  await page.getByRole('button',{name:'Focus workspace',exact:true}).click({timeout:3000});
  await expect(page.locator('body')).toHaveClass(/editor-focus/);
  await expect(page.locator('#download')).toBeInViewport();
  await page.getByRole('button',{name:'Keyboard shortcuts'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/editor-focus/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/editor-focus/);
  expect(await page.locator('#vector .trace-layer').count()).toBe(paths);
  await expect(page.locator('#download')).toBeEnabled();
});

test('actual-size zoom uses source pixels and the navigator returns to Fit',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await traceSample(page);
  await page.getByRole('button',{name:'Actual size',exact:true}).click({timeout:3000});
  const actual=await page.locator('#frame').boundingBox();
  expect(Math.abs(actual.width-960)).toBeLessThan(2);
  await expect(page.locator('#zoomLevel')).toHaveText('100%');
  await page.getByRole('button',{name:'Fit image to canvas',exact:true}).click();
  const frame=await page.locator('#frame').boundingBox(),viewport=await page.locator('#viewport').boundingBox();
  expect(frame.width).toBeLessThan(viewport.width);
  expect(frame.height).toBeLessThan(viewport.height);
  await expect(page.locator('#navigator')).toBeHidden();
});

test('pending settings cannot export an earlier trace and cancellation restores it',async({page})=>{
  await page.addInitScript(()=>{
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(...args){
      if(window.holdTrace){window.releaseTrace=()=>post.apply(this,args);return;}
      return post.apply(this,args);
    };
  });
  await traceSample(page);
  await page.evaluate(()=>{window.holdTrace=true;});
  await page.getByRole('button',{name:'Clean finish',exact:true}).click();
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#copySvg')).toBeDisabled();
  await expect(page.locator('#toCode')).toBeDisabled();
  await page.getByRole('tab',{name:'SVG to code',exact:true}).click();
  await expect(page.locator('#useTraced')).toBeHidden();
  await page.getByRole('tab',{name:'Image to SVG',exact:true}).click();
  await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#traceState')).toHaveText('Previous vector');
});

test('the first reveal does not override a chosen inspection view',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await traceSample(page);
  await page.getByRole('button',{name:'Outline',exact:true}).click();
  await expect(page.locator('#vector')).not.toHaveClass(/\b(draw|wipe)\b/,{timeout:15000});
  await expect(page.locator('[data-view="outline"]')).toHaveAttribute('aria-pressed','true');
});

test('a slider disables old exports before the debounce timer runs',async({page})=>{
  await traceSample(page);
  const disabled=await page.locator('#detail').evaluate(input=>{
    input.value='70';input.dispatchEvent(new Event('input',{bubbles:true}));
    return document.querySelector('#download').disabled;
  });
  expect(disabled).toBe(true);
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
});

test('all export actions remain visible on a short desktop screen',async({page})=>{
  await page.setViewportSize({width:1366,height:664});
  await traceSample(page);
  for(const id of ['#download','#copySvg','#toCode'])await expect(page.locator(id)).toBeInViewport({ratio:1});
});

test('a delayed earlier result cannot enable exports during the slider debounce',async({page})=>{
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      set onmessage(handler){
        super.onmessage=event=>{
          if(window.holdDone&&event.data.type==='done')window.releaseDone=()=>handler(event);
          else handler(event);
        };
      }
    };
  });
  await traceSample(page);
  await page.evaluate(()=>{window.holdDone=true;});
  await page.getByRole('button',{name:'Clean finish',exact:true}).click();
  await page.waitForFunction(()=>!!window.releaseDone);
  const disabled=await page.evaluate(()=>{
    const slider=document.querySelector('#detail');slider.value='70';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    window.releaseDone();
    return document.querySelector('#download').disabled;
  });
  expect(disabled).toBe(true);
});

test('1:1 reaches native size for a very wide image and survives resizing',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=16000;c.height=100;
    const g=c.getContext('2d');g.fillStyle='#c8d6cc';g.fillRect(0,0,c.width,c.height);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({name:'panorama.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Actual size',exact:true}).click();
  expect(Math.abs((await page.locator('#frame').boundingBox()).width-16000)).toBeLessThan(2);
  await expect(page.locator('#zoomLevel')).toHaveText('100%');
  await page.setViewportSize({width:375,height:844});
  await expect.poll(async()=>Math.abs((await page.locator('#frame').boundingBox()).width-16000)).toBeLessThan(2);
});
