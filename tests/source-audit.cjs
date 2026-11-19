const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const catalog = require('../src/public-catalog.json');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const failures=[];
 let index = 0;
 const allRoutes = Object.keys(catalog);
 const sample = process.env.SAMPLE ? Number(process.env.SAMPLE) : 0;
 const auditRoutes = sample
   ? allRoutes.filter((_, i) => i % Math.ceil(allRoutes.length / sample) === 0)
   : allRoutes;
 for(const route of auditRoutes){
  if(['/stories','/credit-cards','/guidance'].includes(route))continue;
  index += 1;
  if (index % 20 === 0) console.log(`Checked ${index} routes`);
  try{
   await page.goto(origin+route,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('.public-page-host')?.shadowRoot?.querySelector('main, #nxgSearchRoot'),{},{timeout:12000});
   const result=await page.evaluate(()=>{const r=document.querySelector('.public-page-host').shadowRoot;return {h:r.querySelector('h1,h2')?.textContent.trim(),scripts:r.querySelectorAll('script,iframe').length,main:r.querySelector('main')?.getBoundingClientRect().width,overflow:r.querySelector('main')?.getBoundingClientRect().right>innerWidth+2};});
   if(!result.h)failures.push([route,'missing heading']);if(result.scripts)failures.push([route,'active embed']);if(result.overflow)failures.push([route,'overflow']);
  }catch(e){failures.push([route,e.message]);}
 }
 for(const route of ['/credit-cards','/guidance','/stories','/mortgage','/checking/compare-checking-accounts']){
  await page.goto(origin+route);await page.waitForFunction(()=>document.querySelector('.public-page-host')?.shadowRoot?.querySelector('main'));
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
  await page.screenshot({path:`.review/source-${route.replaceAll('/','-')}.png`});
 }
 for(const width of [390,768]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/checking/compare-checking-accounts');await page.waitForFunction(()=>document.querySelector('.public-page-host')?.shadowRoot?.querySelector('main'));await page.screenshot({path:`.review/mobile-compare-${width}.png`});
 }
 console.log('AUDITED',auditRoutes.length,'of',allRoutes.length,'cached routes. Failures:',failures,'Page errors:',errors);
 assert.equal(failures.length,0);assert.equal(errors.length,0);
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
