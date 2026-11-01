const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/**', route => route.fulfill({json:{stargazers_count:0}}));
  await page.goto('/');
});

test('detailed preset and working resolution trace and export through a real worker', async ({ page }) => {
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.locator('#colors')).toHaveValue('64');
  await page.locator('.sample[data-sample="sunset"]').click();
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await expect(page.locator('#workingSize')).toContainText('960');
  await page.locator('#quality').selectOption('fast');
  await expect(page.locator('#workingSize')).toContainText('900');
  await expect(page.locator('#vector > svg path').first()).toBeAttached({timeout:30000});
  await expect(page.locator('#cancelTrace')).toBeHidden({timeout:30000});
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  expect(download.suggestedFilename()).toBe('sunset.svg');
});

test('replacement invalidates a slow previous trace and its export immediately', async ({ page }) => {
  await page.locator('.sample[data-sample="sunset"]').click();
  await page.locator('#fileInput2').setInputFiles(path.resolve(__dirname, '../fixtures/mountain.jpg'));
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await expect(page.locator('#cancelTrace')).toBeHidden({timeout:30000});
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  expect(download.suggestedFilename()).toBe('mountain.svg');
});

test('cancel leaves no stale result and a setting change can resume tracing', async ({ page }) => {
  await page.locator('.sample[data-sample="sunset"]').click();
  await page.locator('#cancelTrace').click();
  await expect(page.locator('#cancelTrace')).toBeHidden();
  await expect(page.locator('#download')).toBeDisabled();
  await page.getByRole('button', {name:'Logo',exact:true}).click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
});

test('worker failure falls back to the same image and current settings', async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('Workers unavailable'); } }; });
  await page.reload();
  await page.locator('.sample[data-sample="sunset"]').click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await expect(page.locator('#vector > svg path').first()).toBeAttached();
});

test('quality controls and stage fit a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#quality')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a textured photo automatically selects Detailed even with a muted palette',async({page})=>{
  await page.locator('#fileInput').setInputFiles(path.resolve(__dirname,'../fixtures/dog.jpg'));
  await expect(page.locator('#colors')).toHaveValue('64');
  await expect(page.locator('[data-preset="detailed"]')).toHaveAttribute('aria-pressed','true');
});

test('shaded grayscale artwork is not reduced to two-color line art',async({page})=>{
  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=256;c.height=192;
    const g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,256,192);
    for(let y=40;y<150;y++)for(let x=70;x<180;x++){
      const v=20+(x*7+y*3)%160;
      g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(x,y,1,1);
    }
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    const files=new DataTransfer();files.items.add(new File([blob],'shaded-grayscale.png',{type:'image/png'}));
    const input=document.querySelector('#fileInput');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.locator('[data-preset="detailed"]')).toHaveAttribute('aria-pressed','true');
  expect(Number(await page.locator('#colors').inputValue())).toBeGreaterThanOrEqual(64);
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  expect(await page.locator('#vector .trace-layer').count()).toBeGreaterThan(8);
});

test('new images keep full source resolution within the Fine limit',async({page})=>{
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1000;
    const g=c.getContext('2d');g.fillStyle='#315b80';g.fillRect(0,0,1600,1000);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({name:'full-size.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await expect(page.locator('#workingSize')).toContainText('1600 × 1000 working pixels');
});

test('automatic flat artwork and Reset retain a native one-pixel accent',async({page})=>{
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=96;
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,128,96);
    g.fillStyle='#315b80';g.fillRect(10,10,32,40);g.fillStyle='#ff0000';g.fillRect(85,61,1,1);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({name:'accent.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  async function accent(){return page.evaluate(async()=>{
    const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(document.querySelector('#vector svg').outerHTML);await image.decode();
    const c=document.createElement('canvas');c.width=128;c.height=96;const g=c.getContext('2d');g.drawImage(image,0,0,128,96);
    return Array.from(g.getImageData(85,61,1,1).data);
  });}
  let pixel=await accent();expect(pixel[0]).toBe(255);expect(pixel[1]).toBeLessThan(3);expect(pixel[2]).toBeLessThan(3);
  await page.getByRole('button',{name:'Photo',exact:true}).click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  pixel=await accent();expect(pixel[1]).toBeLessThan(3);expect(pixel[2]).toBeLessThan(3);
});

test('a downsampled panorama exports without transparent letterboxing',async({page})=>{
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=16000;c.height=100;
    const g=c.getContext('2d');g.fillStyle='#315b80';g.fillRect(0,0,16000,100);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({name:'panorama.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  const pending=page.waitForEvent('download');await page.locator('#download').click();const file=await pending;
  const svg=await require('node:fs/promises').readFile(await file.path(),'utf8');
  const pixels=await page.evaluate(async svg=>{
    const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();
    const c=document.createElement('canvas');c.width=16000;c.height=100;const g=c.getContext('2d');g.drawImage(image,0,0);
    return [g.getImageData(8000,0,1,1).data[3],g.getImageData(8000,99,1,1).data[3]];
  },svg);
  expect(pixels).toEqual([255,255]);
});
