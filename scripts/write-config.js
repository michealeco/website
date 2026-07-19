/**
 * Writes public/config.js from env so the Vercel site knows your Linux API URL.
 * Set API_URL in the Vercel project (e.g. https://pics.yourdomain.com).
 */
const fs = require("fs");
const path = require("path");

const apiUrl = (process.env.API_URL || "").trim().replace(/\/$/, "");
const out = path.join(__dirname, "..", "public", "config.js");

const contents = `/* Generated at build time — do not edit by hand */
window.FAM_API_BASE = ${JSON.stringify(apiUrl)};
`;

fs.writeFileSync(out, contents, "utf8");
console.log(
  apiUrl
    ? `Wrote config.js with API_URL=${apiUrl}`
    : "Wrote config.js with empty API_URL (same-origin / local mode)"
);
