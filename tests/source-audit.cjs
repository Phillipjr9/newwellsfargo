const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const catalog = require('../src/public-catalog.json');
const destinations = require('../shared/official-destinations.json');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors = [], failures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const request = route.request();
      if (new URL(request.url()).origin === origin) return route.continue();
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<h1>Official destination</h1>' });
      return process.env.WRITE_SCREENSHOTS ? route.continue() : route.abort();
    });
    const home = async () => {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.checking-hero h1').waitFor();
    };
    await home();
    const open = async (path) => {
      if (destinations[path]) {
        await Promise.all([page.waitForURL(url => url.href === destinations[path]), page.goto(origin + path, { waitUntil: 'domcontentloaded' }).catch(e => {
          if (!/interrupted/.test(e.message)) throw e;
        })]);
        await home();
        return;
      }
      await page.evaluate((route) => {
        history.pushState(null, '', route);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      const host = page.locator(`.public-page-host[data-route=${JSON.stringify(path)}]`);
      await host.locator('main, #nxgSearchRoot').first().waitFor({ state: 'attached' });
      const result = await host.evaluate(element => {
        const root = element.shadowRoot;
        return {
          heading: [...root.querySelectorAll('h1,h2')].some(h => h.textContent.trim()),
          embeds: root.querySelectorAll('script,iframe').length,
          overflow: root.querySelector('main')?.getBoundingClientRect().right > innerWidth + 2,
        };
      });
      assert.ok(result.heading, 'missing heading');
      assert.equal(result.embeds, 0, 'active embed');
      assert.equal(result.overflow, false, 'main content overflows viewport');
    };
    const all = Object.keys(catalog);
    const sample = Number(process.env.SAMPLE || 0);
    const featured = ['/credit-cards', '/guidance', '/stories', '/mortgage', '/checking/compare-checking-accounts'];
    const routes = [...new Set([...(sample ? all.filter((_, i) => i % Math.ceil(all.length / sample) === 0) : all), ...featured, ...Object.keys(destinations).filter(path => catalog[path])])];
    for (const [i, path] of routes.entries()) {
      if (i && i % 50 === 0) console.log(`Checked ${i} routes`);
      try {
        await open(path);
        if (process.env.WRITE_SCREENSHOTS && featured.includes(path)) await page.screenshot({ path: `.review/source-${path.replaceAll('/', '-')}.png` });
      } catch (e) { failures.push([path, e.message]); }
    }
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await open('/checking/compare-checking-accounts');
      if (process.env.WRITE_SCREENSHOTS) await page.screenshot({ path: `.review/mobile-compare-${width}.png` });
    }
    console.log('AUDITED', routes.length, 'of', all.length, 'catalog routes. Failures:', failures, 'Page errors:', errors);
    assert.deepEqual(failures, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
