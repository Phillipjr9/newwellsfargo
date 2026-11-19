const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => console.log('PAGEERROR', error.message));
  for (const [name, url] of [
    ['checking', '/checking/'],
    ['compare', '/checking/compare-checking-accounts/'],
    ['savings', '/savings-cds/'],
    ['mortgage', '/mortgage/'],
    ['legal', '/privacy-security/'],
  ]) {
    await page.goto(`http://127.0.0.1:5173${url}`, { waitUntil: 'load' });
    await page.locator('.public-page-host').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    console.log(name, await page.evaluate(() => {
      const host = document.querySelector('.public-page-host');
      const root = host.shadowRoot;
      return {
        title: document.title,
        headline: root.querySelector('h1,h2')?.textContent.trim(),
        height: host.getBoundingClientRect().height,
        images: root.querySelectorAll('img').length,
        mainWidth: root.querySelector('main')?.getBoundingClientRect().width,
        mainClass: root.querySelector('main')?.className,
      };
    }));
    await page.screenshot({ path: `.review/${name}.png` });
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
