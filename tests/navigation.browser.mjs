const {chromium}=await import(process.env.PW_MODULE||'playwright');
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox']});
for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));let feedRequests=0;
const topic=i=>({id:String(i),title:`Patient story ${i}`,body:'A long recovery story with appointments and gradual progress. '.repeat(9),summary:'A long recovery story with appointments and gradual progress. '.repeat(4),nickname:'Anonymous',source_lang:'en',status:'published',content_version:1,created_at:1794500000,terms:[],reply_count:0,like_count:0});
await page.route('http://localhost/**',async route=>{const url=new URL(route.request().url());let data;
if(url.pathname==='/api/me')data={user:null,googleConfigured:false};
else if(url.pathname==='/api/health')data={environment:'preview'};
else if(url.pathname==='/api/taxonomy')data={terms:[]};
else if(url.pathname==='/api/topics'){feedRequests++;let offset=Number(url.searchParams.get('offset')||0);data={topics:Array.from({length:20},(_,i)=>topic(offset+i+1)),next:offset<40?offset+20:null,highlights:[]};}
else if(url.pathname.startsWith('/api/topics/'))data={topic:topic(Number(url.pathname.split('/').pop())),comments:[],progress:[],next:null};
else if(url.pathname.startsWith('/api/'))data={};
if(data!==undefined)return route.fulfill({json:data});
const local=path.join(path.resolve('public'),url.pathname==='/'||!path.extname(url.pathname)?'index.html':url.pathname);
return route.fulfill({body:fs.readFileSync(local),contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':'text/html'});
});
await page.goto('http://localhost/search?q=recovery&sort=latest');await page.locator('[data-topic="20"]').waitFor();
await page.locator('[data-topic="20"]').scrollIntoViewIfNeeded();await page.locator('[data-topic="40"]').waitFor();
await page.locator('[data-topic="34"]').scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);const requests=feedRequests;
await page.locator('[data-topic="34"] h3 a').click();await page.locator('.article-title').waitFor();
await page.goBack();await page.locator('[data-topic="34"]').waitFor();await page.waitForTimeout(150);
assert(Math.abs((await page.evaluate(()=>scrollY))-before)<3,'browser back position');assert.equal(feedRequests,requests,'no list reload');assert.equal(await page.locator('#search-form input[name=q]').inputValue(),'recovery');
await page.goForward();await page.locator('.article-title').waitFor();await page.locator('.back-link').click();await page.locator('[data-topic="34"]').waitFor();await page.waitForTimeout(150);assert(Math.abs((await page.evaluate(()=>scrollY))-before)<3,'detail back position');
await page.locator('[data-topic="34"] h3 a').click();await page.locator('.article-title').waitFor();await page.goBack();await page.locator('[data-topic="34"]').waitFor();assert.equal(await page.locator('[data-topic]').count(),40);assert.deepEqual(errors,[]);
console.log('PASS',viewport.width,'back, forward, back link, loaded pages, filters, repeated navigation');await page.close();
}
if(process.env.PREVIEW_URL){
 const base=process.env.PREVIEW_URL;const source=fs.readFileSync('public/app.js','utf8');
 let deployed=false;
 for(let i=0;i<40;i++){
  const html=await (await fetch(base+'/?navigation_probe='+Date.now())).text();
  const src=html.match(/src="([^"]*\/app\.js)"/)?.[1];
  if(src&&(await (await fetch(new URL(src,base))).text())===source){deployed=true;break;}
  await new Promise(resolve=>setTimeout(resolve,6000));
 }
 assert(deployed,'Preview did not deploy the tested app.js');
 for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
  const page=await browser.newPage({viewport});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  const cards=page.locator('#feed .topic-card');await cards.first().waitFor({timeout:30000});
  const count=await cards.count();assert(count>2,'Need public list cards');
  const card=cards.nth(Math.min(8,count-2));await card.scrollIntoViewIfNeeded();
  const href=await card.locator('h3 a').getAttribute('href');
  const top=await card.evaluate(el=>el.getBoundingClientRect().top);
  await card.locator('h3 a').click();await page.locator('.article-title').waitFor({timeout:30000});
  await page.goBack();const link=page.locator('#feed h3 a[href="'+href+'"]');await link.waitFor();
  assert(Math.abs(await link.evaluate(el=>el.closest('.topic-card').getBoundingClientRect().top)-top)<5,'Preview browser Back lost card position');
  await link.click();await page.locator('.article-title').waitFor({timeout:30000});
  await page.locator('.back-link').click();await link.waitFor();
  assert(Math.abs(await link.evaluate(el=>el.closest('.topic-card').getBoundingClientRect().top)-top)<5,'Preview back link lost card position');
  console.log('PASS deployed Preview',viewport.width,'browser back and detail back link');await page.close();
 }
}

await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
