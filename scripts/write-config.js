/**
 * Writes public/config.js from env so the Vercel site knows your Linux/ngrok API URL.
 * Set API_URL in the Vercel project (e.g. https://your-name.ngrok-free.app).
 */
const fs = require("fs");
const path = require("path");

const apiUrl = (process.env.API_URL || "").trim().replace(/\/$/, "");
const onVercel = process.env.VERCEL === "1";
const out = path.join(__dirname, "..", "public", "config.js");

if (onVercel && !apiUrl) {
  console.error(`
ERROR: API_URL is not set in Vercel Environment Variables.

1. Vercel → Project → Settings → Environment Variables
2. Add:  API_URL = https://YOUR-STATIC.ngrok-free.app
   (include Production AND Preview)
3. Redeploy

Without API_URL, uploads hit Vercel and return 405.
`);
  process.exit(1);
}

const contents = `/* Generated at build time — do not edit by hand */
window.FAM_API_BASE = ${JSON.stringify(apiUrl)};
`;

fs.writeFileSync(out, contents, "utf8");
console.log(
  apiUrl
    ? `Wrote config.js with API_URL=${apiUrl}`
    : "Wrote config.js with empty API_URL (same-origin / local mode)"
);
