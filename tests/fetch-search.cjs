// Fetches the live-rendered search page through the app's public-page API
// and inspects its filter/result markup for local wiring.
const fs = require("node:fs");

(async () => {
  const res = await fetch("http://127.0.0.1:5173/api/public-page?path=/search&q=checking");
  const page = await res.json();
  fs.writeFileSync("/tmp/search-source.json", JSON.stringify(page));
  console.log("saved", page.title, page.html.length);
})();
