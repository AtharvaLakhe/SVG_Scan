// Serve the repo locally first, then: node tests/benchmark/measure.js
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SVG_SCAN_URL || 'http://127.0.0.1:8765/tests/benchmark/bench.html');
    let baseline = null;
    const baselinePath = path.join(__dirname, '../../.playwright-mcp/baseline-tracer.js');
    if (fs.existsSync(baselinePath)) {
      await page.addScriptTag({path:baselinePath});
      await page.evaluate(() => { window.BaselineScan = SVGScan; });
      await page.addScriptTag({path:path.join(__dirname, '../../tracer.js')});
      baseline = await page.evaluate(() => runBench(['logo','lineart','orb','sunset','fox','rocket','dog','mountain'], {engine:BaselineScan}));
    }
    const standard = await page.evaluate(() => runBench(['logo','lineart','orb','sunset','fox','rocket','dog','mountain']));
    const detailed = await page.evaluate(() => runBench(['dog','mountain'], {preset:'detailed'}));
    const result = {date:new Date().toISOString(), browser:browser.version(), baselineRevision:baseline ? 'b36b29a' : null, metric:'RGB RMSE (0–255), composited on white at the working resolution; lower is better',baseline,standard,detailed};
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
