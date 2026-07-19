const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const archiver = require("archiver");

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const META_FILE = path.join(UPLOAD_DIR, "manifest.json");
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024;
/** Public URL of this Linux API, e.g. https://pics.example.com — used for absolute media links */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
/** Comma-separated Vercel origins allowed to call the API, or * */
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadManifest() {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, "utf8"));
    }
  } catch {
    /* start fresh */
  }
  return { photos: [] };
}

function saveManifest(manifest) {
  fs.writeFileSync(META_FILE, JSON.stringify(manifest, null, 2));
}

function mediaUrl(filename) {
  const relative = `/media/${encodeURIComponent(filename)}`;
  return PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${relative}` : relative;
}

function withAbsoluteUrls(photo) {
  return { ...photo, url: mediaUrl(photo.filename) };
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (CORS_ORIGIN === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    const allowed = CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 50 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const app = express();

app.use((req, res, next) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    storage: UPLOAD_DIR,
    publicBaseUrl: PUBLIC_BASE_URL || null,
  });
});

app.get("/api/photos", (_req, res) => {
  const manifest = loadManifest();
  const photos = [...manifest.photos]
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map(withAbsoluteUrls);
  res.json({ photos });
});

app.post("/api/upload", upload.array("photos", 50), (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const manifest = loadManifest();
  const added = req.files.map((file) => {
    const photo = {
      id: randomUUID(),
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date().toISOString(),
      url: mediaUrl(file.filename),
    };
    manifest.photos.push(photo);
    return photo;
  });

  saveManifest(manifest);
  res.status(201).json({ photos: added });
});

app.delete("/api/photos/:id", (req, res) => {
  const manifest = loadManifest();
  const index = manifest.photos.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Photo not found" });
  }

  const [photo] = manifest.photos.splice(index, 1);
  const filePath = path.join(UPLOAD_DIR, photo.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  saveManifest(manifest);
  res.json({ ok: true });
});

app.post("/api/export", (req, res) => {
  const { ids } = req.body || {};
  const manifest = loadManifest();
  let photos = manifest.photos;

  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    photos = photos.filter((p) => idSet.has(p.id));
  }

  if (!photos.length) {
    return res.status(400).json({ error: "No photos to export" });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fam-pics-${stamp}.zip"`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  archive.pipe(res);

  const usedNames = new Map();
  for (const photo of photos) {
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    if (!fs.existsSync(filePath)) continue;

    let name = photo.originalName || photo.filename;
    const count = usedNames.get(name) || 0;
    usedNames.set(name, count + 1);
    if (count > 0) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base} (${count})${ext}`;
    }
    archive.file(filePath, { name });
  }

  archive.finalize();
});

app.get("/api/download/:id", (req, res) => {
  const manifest = loadManifest();
  const photo = manifest.photos.find((p) => p.id === req.params.id);
  if (!photo) {
    return res.status(404).json({ error: "Photo not found" });
  }

  const filePath = path.join(UPLOAD_DIR, photo.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File missing on disk" });
  }

  res.download(filePath, photo.originalName || photo.filename);
});

// Serve stored files (images are fetched by the Vercel frontend from this host)
app.use("/media", express.static(UPLOAD_DIR));

// Optional: local all-in-one testing (frontend + API on same host)
if (process.env.SERVE_FRONTEND !== "0") {
  app.use(express.static(path.join(__dirname, "public")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large (max 50MB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fam Pic Vault API on http://0.0.0.0:${PORT}`);
  console.log(`Storing photos in: ${UPLOAD_DIR}`);
  if (PUBLIC_BASE_URL) console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
