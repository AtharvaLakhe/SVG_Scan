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
