/* Fixture-only browser verification. No live API, payment or provider requests. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../build/web');
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.css':'text/css','.otf':'font/otf','.ttf':'font/ttf','.svg':'image/svg+xml'};
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https://ticash-api.onrender.com; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; child-src 'none'; worker-src 'self'; manifest-src 'self'";
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(root,pathname.replace(/^\/app\//,''));
  if (!pathname.startsWith('/app/') || !(file === root || file.startsWith(root + '/'))) {res.writeHead(404);res.end();return;}
  const target = pathname === '/app/' ? root + '/index.html' : file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {res.writeHead(404);res.end();return;}
  res.writeHead(200, {'Content-Type':types[path.extname(target)] || 'application/octet-stream','Content-Security-Policy':csp,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  res.end(fs.readFileSync(target));
});
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function boot(page) {
  await page.locator('#startup').waitFor({state:'detached',timeout:30000});
  await page.locator('flt-semantics-placeholder').evaluate(element=>element.click());
}
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,locale:'en-US'});
    const calls = [], errors = [];
    await context.route('https://ticash-api.onrender.com/**',route=>{
      calls.push({url:route.request().url(),method:route.request().method(),body:route.request().postData()});
      return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'INVALID_REFRESH_TOKEN',error:'Sign in again'})});
    });
    const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/app/'); await boot(page);
    await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    const manifest = await (await context.newCDPSession(page)).send('Page.getAppManifest');
    assert.equal(manifest.errors.length,0);
    assert.equal(JSON.parse(manifest.data).display,'standalone');
    let active = false;
    for(let attempt=0;attempt<100 && !active;attempt++) {
      active = await page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistrations()).some(r=>r.active?.state==='activated')));
      if(!active) await pause(100);
    }
    assert.ok(active,'PWA worker must activate');
    assert.ok(calls.some(call=>call.url.endsWith('/auth/refresh') && call.body==='{}'));
    assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
    const screenshotDir = process.env.PWA_SCREENSHOT_DIR;
    if(screenshotDir) {fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'pwa-login.png')});}
    await page.reload(); await boot(page); // Ensure the worker controls this tab.
    assert.ok(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)), 'Worker must control the reloaded page');
    await context.setOffline(true);
    await page.reload(); await boot(page);
    await page.locator('#offline').waitFor({state:'visible'});
    const cacheUrls = await page.evaluate(async()=>{
      const urls=[];
      for(const name of await caches.keys()) for(const req of await (await caches.open(name)).keys()) urls.push(req.url);
      return urls;
    });
    assert.ok(cacheUrls.length>10);
    assert.ok(cacheUrls.every(url=>url.startsWith(origin+'/app/') && !url.includes('?')));
    assert.ok(!cacheUrls.some(url=>/\/api\/|checkoutResumeToken|checkout\.stripe/.test(url)));
    await context.close();
    const returned = await browser.newContext({viewport:{width:390,height:844},locale:'en-US'});
    const returnCalls=[];
    await returned.route('https://ticash-api.onrender.com/**',route=>{
      returnCalls.push({url:route.request().url(),method:route.request().method(),body:route.request().postData()});
      return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'INVALID_REFRESH_TOKEN'})});
    });
    const returnPage=await returned.newPage(); returnPage.on('pageerror',error=>errors.push(error.message));
    const token='a'.repeat(43);
    await returnPage.goto(origin+'/app/#/checkout-return?checkoutResumeToken='+token);
    await boot(returnPage);
    for(let attempt=0;attempt<40 && returnPage.url().includes('checkoutResumeToken');attempt++) await pause(100);
    assert.ok(!returnPage.url().includes('checkoutResumeToken'),'Return capability must be removed from the URL');
    assert.ok(returnCalls.some(call=>call.url.endsWith('/checkout-resume') && JSON.parse(call.body).resumeToken===token));
    assert.ok(!returnCalls.some(call=>/payment-sessions|\/purchase|\/cancel/.test(call.url)));
    assert.deepEqual(errors,[]);
    console.log('PWA browser PASS: login, manifest, worker, offline shell, memory-only credentials and scrubbed checkout return');
  } finally {
    if(browser) await browser.close();
    server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
