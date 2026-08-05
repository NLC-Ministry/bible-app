import https from "node:https";
import fs from "node:fs";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on("error", reject);
  });
}

async function check() {
  const htmlRes = await fetchUrl("https://bible.newlife.org.tw");
  console.log("HTML len:", htmlRes.body.length);
  
  const cssMatches = [...htmlRes.body.matchAll(/href="([^"]+\.css[^"]*)"/g)];
  console.log("CSS hrefs:", cssMatches.map(m => m[1]));

  for (const m of cssMatches) {
    const href = m[1];
    const cssUrl = href.startsWith("http") ? href : "https://bible.newlife.org.tw" + (href.startsWith("/") ? href : "/" + href);
    const res = await fetchUrl(cssUrl);
    console.log(cssUrl, "status:", res.status, "len:", res.body.length);
    console.log("  has --bg-app:", res.body.includes("--bg-app"));
    console.log("  has body style:", res.body.includes("body"));
    console.log("  has .plan-card:", res.body.includes(".plan-card"));
    console.log("  first 200 chars of CSS:\n", res.body.slice(0, 200));
  }
}

check();
