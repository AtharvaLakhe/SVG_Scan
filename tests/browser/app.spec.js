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
  await expect(page.locator('#colors')).toHaveValue('64');
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  expect(await page.locator('#vector .trace-layer').count()).toBeGreaterThan(8);
});
