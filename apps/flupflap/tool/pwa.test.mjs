import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const source = readFileSync(new URL('../web/pwa-worker.js', import.meta.url), 'utf8')
  .replace('__PWA_CACHE__', 'flupflap-pwa-test').replace('__PWA_ASSETS__', JSON.stringify(['index.html','main.dart.js']));
function worker() {
  const handlers = {}; const calls = []; let failed = false;
  const scope = 'https://www.flupflap.com/app/';
  const self = {registration:{scope},location:{origin:'https://www.flupflap.com'},
    addEventListener:(type,fn) => {handlers[type] = fn;}};
  vm.runInNewContext(source, {self, URL, Request, Response,
    caches:{keys:async()=>['unrelated','flupflap-pwa-old','flupflap-pwa-test'],delete:async key=>calls.push(key),
      open:async()=>({addAll:async reqs=>calls.push(...reqs.map(req=>req.url)),match:async key=>new Response(key)})},
    fetch:async request => { if(failed) throw Error('offline'); return new Response(request.url); }});
  return {handlers,calls,offline:()=>{failed=true;}};
}
test('API, mutations, credentials and checkout queries never use the asset cache', () => {
  const w = worker();
  for (const [url,method] of [
    ['https://ticash-api.onrender.com/api/flupflap/auth/login','GET'],
    ['https://www.flupflap.com/app/main.dart.js','POST'],
    ['https://www.flupflap.com/app/?checkoutResumeToken=secret','GET'],
    ['https://www.flupflap.com/app/main.dart.js?token=secret','GET'],
    ['https://www.flupflap.com/app/transactions','GET'],
    ['https://checkout.stripe.com/c/pay/session','GET']]) {
    let handled = false;
    w.handlers.fetch({request:{url,method,mode:'cors'},respondWith:()=>{handled=true;}});
    assert.equal(handled,false,url);
  }
});
test('public app assets load offline and only this app old caches are removed', async () => {
  const w=worker(); w.offline(); let response;
  w.handlers.fetch({request:{url:'https://www.flupflap.com/app/',method:'GET',mode:'navigate'},respondWith:p=>{response=p;}});
  assert.equal(await (await response).text(),'https://www.flupflap.com/app/index.html');
  let work; w.handlers.activate({waitUntil:p=>{work=p;}}); await work;
  assert.deepEqual(w.calls,['flupflap-pwa-old']);
  assert.doesNotMatch(source,/skipWaiting|clients\.claim|localStorage|indexedDB/);
});
test('manifest confines the app and includes required home screen icons', () => {
  const m=JSON.parse(readFileSync(new URL('../web/manifest.json',import.meta.url)));
  assert.equal(m.scope,'/app/'); assert.equal(m.start_url,'/app/'); assert.equal(m.display,'standalone');
  for(const size of [192,512]) assert.ok(m.icons.some(icon=>icon.sizes===`${size}x${size}`));
});
