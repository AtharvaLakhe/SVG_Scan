const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{await page.goto('/');});

test('inspector tabs expose palette controls and retain trace settings',async({page})=>{
  await page.getByRole('tab',{name:/Palette/}).click();
  await expect(page.getByRole('button',{name:'Restore all colors'})).toBeVisible();
  await page.getByRole('tab',{name:'Adjust'}).click();
  await expect(page.locator('#quality')).toBeVisible();
  await page.getByText('Advanced cleanup',{exact:true}).click();
  await expect(page.locator('#denoise')).toBeVisible();
});

test('canvas surface and keyboard help work without an image',async({page})=>{
  await page.getByLabel('Canvas background').selectOption('paper');
  await expect(page.locator('#stage')).toHaveClass(/bg-paper/);
  await page.getByRole('button',{name:'Keyboard shortcuts'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('export controls and canvas stay within a desktop workspace',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const bounds=await page.locator('#controls').boundingBox();
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(1000);
  await expect(page.locator('#download')).toBeInViewport();
});

test('palette color removal and restore update preview and export state',async({page})=>{
  await page.locator('.sample[data-sample="sunset"]').click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await page.getByRole('tab',{name:/Palette/}).click();
  const swatch=page.locator('.swatch').first();
  await swatch.click();await expect(swatch).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#vector .trace-layer.off').first()).toBeAttached();
  await page.getByRole('button',{name:'Restore all colors'}).click();
  await expect(page.locator('#vector .trace-layer.off')).toHaveCount(0);
});

test('image selection is reachable with the keyboard',async({page})=>{
  const choose=page.getByRole('button',{name:'Choose image',exact:true});
  await choose.focus();
  const chooser=page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const file=await chooser;
  await file.setFiles(require('node:path').resolve(__dirname,'../fixtures/mountain.jpg'));
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
});

test('replacement clears stale palette controls while the new image decodes',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.sample[data-sample="sunset"]').click();
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  await page.getByRole('tab',{name:/Palette/}).click();
  await expect(page.locator('.swatch').first()).toBeVisible();
  await page.evaluate(()=>{
    const decode=Image.prototype.decode;
    Image.prototype.decode=function(){return new Promise(resolve=>{window.releaseDecode=resolve;}).then(()=>decode.call(this));};
  });
  await page.locator('#fileInput2').setInputFiles(require('node:path').resolve(__dirname,'../fixtures/mountain.jpg'));
  await expect(page.locator('.swatch')).toHaveCount(0);
  await expect(page.locator('#restoreColors')).toBeDisabled();
  await page.evaluate(()=>window.releaseDecode());
  await expect(page.locator('#download')).toBeEnabled({timeout:30000});
  expect(errors).toEqual([]);
});
