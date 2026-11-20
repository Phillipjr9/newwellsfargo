const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const upstreamOrigin = new URL(process.env.TEST_ORIGIN || "http://127.0.0.1:5173");
  const host = "sbx-preview-cookie-test.arena.site";
  const scratch = mkdtempSync(join(tmpdir(), "preview-tls-"));
  let proxy, browser;
  try {
    const key = join(scratch, "key.pem"), cert = join(scratch, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", key, "-out", cert, "-days", "1"], { stdio: "ignore" });
    proxy = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      if (req.url === "/embed") return res.writeHead(200, { "Content-Type": "text/html" }).end(`<iframe src="https://${host}/login" title="Preview"></iframe>`);
      const headers = { ...req.headers };
      delete headers.cookie;
      const upstream = http.request({ hostname: upstreamOrigin.hostname, port: upstreamOrigin.port, path: req.url, method: req.method, headers }, response => {
        const returned = { ...response.headers };
        delete returned["set-cookie"];
        res.writeHead(response.statusCode, returned);
        response.pipe(res);
      });
      upstream.on("error", () => res.writeHead(502).end());
      req.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const port = proxy.address().port;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-proxy-server", `--host-resolver-rules=MAP ${host}:443 127.0.0.1:${port}`] });
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.setDefaultTimeout(10000);
    await page.goto(`https://127.0.0.1:${port}/embed`, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("iframe");
    await frame.getByRole("button", { name: "One-click sign in" }).click();
    await frame.getByText("This is a temporary workspace.", { exact: false }).waitFor();
    await frame.locator("#portal-main h1").waitFor();
    assert.equal((await page.context().cookies()).length, 0);
    await frame.getByRole("navigation", { name: "Online banking" }).getByRole("link", { name: "Account summary", exact: true }).click();
    await frame.locator("#portal-main h1").waitFor();
    const embedded = page.frames().find(f => new URL(f.url()).hostname === host);
    assert.equal(await embedded.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await frame.getByRole("button", { name: "Customer profile menu" }).click();
    await frame.getByRole("button", { name: "Sign out" }).click();
    await frame.getByRole("button", { name: "One-click sign in" }).waitFor();
    await frame.getByRole("button", { name: "One-click sign in" }).click();
    await frame.locator("#portal-main h1").waitFor();
    await embedded.goto(`https://${host}/portal`, { waitUntil: "domcontentloaded" });
    await frame.getByRole("button", { name: "One-click sign in" }).waitFor();
    console.log("PASS preview one-click sign-in, navigation, and sign-out with all cookies blocked");
  } finally {
    if (browser) await browser.close();
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    rmSync(scratch, { force: true, recursive: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
