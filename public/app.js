const API_BASE = (window.FAM_API_BASE || "").replace(/\/$/, "");
const ON_VERCEL = /\.vercel\.app$/i.test(location.hostname);
/** Required so free ngrok doesn't block browser fetch with its interstitial page */
const NGROK_HEADERS = { "ngrok-skip-browser-warning": "true" };

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function apiFetch(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : apiUrl(pathOrUrl);
  const headers = new Headers(options.headers || {});
  headers.set("ngrok-skip-browser-warning", "true");
  return fetch(url, { ...options, headers });
}

const mediaBlobCache = new Map();

async function mediaSrc(url) {
  if (!url) return "";
  if (!API_BASE || !url.startsWith("http")) return url;
  if (mediaBlobCache.has(url)) return mediaBlobCache.get(url);
  try {
    const res = await apiFetch(url);
    if (!res.ok) return url;
    const blobUrl = URL.createObjectURL(await res.blob());
    mediaBlobCache.set(url, blobUrl);
    return blobUrl;
  } catch {
    return url;
  }
}

function assertApiConfigured() {
  if (ON_VERCEL && !API_BASE) {
    toast(
      "API_URL is not set on Vercel. Add your ngrok URL in Environment Variables, then redeploy."
    );
    return false;
  }
  return true;
}

function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  // iOS often leaves HEIC/HEIF with an empty MIME type
  return /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i.test(file.name || "");
}

const gallery = document.getElementById("gallery");
const emptyState = document.getElementById("emptyState");
const countLabel = document.getElementById("countLabel");
const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const exportBtn = document.getElementById("exportBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const toastEl = document.getElementById("toast");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxCaption = document.getElementById("lightboxCaption");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxDownload = document.getElementById("lightboxDownload");
const lightboxDelete = document.getElementById("lightboxDelete");

let photos = [];
const selected = new Set();
let toastTimer;
let activeLightboxId = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2800);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function updateChrome() {
  const n = photos.length;
  countLabel.textContent =
    n === 0 ? "No photos yet" : n === 1 ? "1 photo" : `${n} photos`;
  emptyState.hidden = n > 0;
  selectAllBtn.hidden = n === 0;
  clearSelectionBtn.hidden = selected.size === 0;
  exportBtn.disabled = n === 0;
  exportBtn.textContent =
    selected.size > 0
      ? `Export (${selected.size})`
      : n > 0
        ? "Export all"
        : "Export";
}

function bindLongPressSelect(card, photoId) {
  let timer = null;
  let didLongPress = false;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  card.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest("[data-action], .card-check")) return;
      didLongPress = false;
      timer = setTimeout(() => {
        didLongPress = true;
        toggleSelect(photoId);
        if (navigator.vibrate) navigator.vibrate(12);
      }, 450);
    },
    { passive: true }
  );

  card.addEventListener("touchend", clear, { passive: true });
  card.addEventListener("touchmove", clear, { passive: true });
  card.addEventListener("touchcancel", clear, { passive: true });

  card.addEventListener(
    "click",
    (e) => {
      if (didLongPress) {
        e.preventDefault();
        e.stopImmediatePropagation();
        didLongPress = false;
      }
    },
    true
  );
}

function renderGallery() {
  gallery.innerHTML = "";
  photos.forEach((photo, i) => {
    const card = document.createElement("article");
    card.className = "card" + (selected.has(photo.id) ? " selected" : "");
    card.style.animationDelay = `${Math.min(i * 30, 300)}ms`;
    card.dataset.id = photo.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", photo.originalName);

    card.innerHTML = `
      <span class="card-check" aria-hidden="true">✓</span>
      <img alt="${escapeAttr(photo.originalName)}" loading="lazy" decoding="async" />
      <div class="card-menu">
        <button type="button" class="icon-btn" data-action="download" title="Download" aria-label="Download">↓</button>
        <button type="button" class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete">✕</button>
      </div>
    `;

    const img = card.querySelector("img");
    mediaSrc(photo.url).then((src) => {
      img.src = src;
    });

    card.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "download") {
        e.stopPropagation();
        downloadPhoto(photo.id);
        return;
      }
      if (action === "delete") {
        e.stopPropagation();
        deletePhoto(photo.id);
        return;
      }
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleSelect(photo.id);
        return;
      }
      openLightbox(photo);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLightbox(photo);
      }
      if (e.key === "x" || e.key === "X") {
        toggleSelect(photo.id);
      }
    });

    const check = card.querySelector(".card-check");
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(photo.id);
    });

    bindLongPressSelect(card, photo.id);
    gallery.appendChild(card);
  });
  updateChrome();
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  renderGallery();
}

async function openLightbox(photo) {
  activeLightboxId = photo.id;
  lightboxImg.alt = photo.originalName;
  lightboxImg.src = await mediaSrc(photo.url);
  lightboxCaption.textContent = `${photo.originalName} · ${formatBytes(photo.size)}`;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = "";
  activeLightboxId = null;
  document.body.classList.remove("lightbox-open");
}

async function downloadPhoto(id) {
  try {
    const res = await apiFetch(`/api/download/${id}`);
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const photo = photos.find((p) => p.id === id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = photo?.originalName || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast(err.message || "Download failed");
  }
}

async function loadPhotos() {
  if (!assertApiConfigured()) return;
  try {
    const res = await apiFetch("/api/photos");
    if (!res.ok) throw new Error("Failed to load photos");
    const data = await res.json();
    photos = data.photos || [];
    selected.clear();
    renderGallery();
  } catch (err) {
    const hint = API_BASE
      ? " Check that your Linux API is online, ngrok is running, and Vercel API_URL matches your ngrok URL."
      : " Start the Linux API with npm start, or set API_URL for Vercel.";
    toast((err.message || "Could not load library") + hint);
  }
}

async function uploadFiles(files) {
  if (!assertApiConfigured()) return;
  const list = [...files].filter(isImageFile);
  if (!list.length) {
    toast("Please choose image files");
    return;
  }

  const form = new FormData();
  list.forEach((f) => form.append("photos", f));

  progress.hidden = false;
  progressText.textContent = `Uploading ${list.length} photo${list.length > 1 ? "s" : ""}…`;

  try {
    const res = await apiFetch("/api/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    toast(
      data.photos.length === 1
        ? "Photo saved on your Linux server"
        : `${data.photos.length} photos saved on your Linux server`
    );
    await loadPhotos();
  } catch (err) {
    toast(err.message || "Upload failed");
  } finally {
    progress.hidden = true;
    fileInput.value = "";
  }
}

async function deletePhoto(id) {
  if (!confirm("Delete this photo from the server?")) return;
  try {
    const res = await apiFetch(`/api/photos/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Delete failed");
    }
    selected.delete(id);
    if (activeLightboxId === id) closeLightbox();
    toast("Photo deleted");
    await loadPhotos();
  } catch (err) {
    toast(err.message || "Delete failed");
  }
}

async function exportPhotos() {
  const ids = selected.size > 0 ? [...selected] : null;
  try {
    const res = await apiFetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...NGROK_HEADERS },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Export failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ||
      "fam-pics.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(ids ? `Exported ${ids.length} photo(s)` : "Exported all photos");
  } catch (err) {
    toast(err.message || "Export failed");
  }
}

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) uploadFiles(fileInput.files);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
});

dropzone.addEventListener("click", (e) => {
  if (e.target.closest(".progress")) return;
  fileInput.click();
});

exportBtn.addEventListener("click", exportPhotos);

selectAllBtn.addEventListener("click", () => {
  photos.forEach((p) => selected.add(p.id));
  renderGallery();
});

clearSelectionBtn.addEventListener("click", () => {
  selected.clear();
  renderGallery();
});

lightboxClose.addEventListener("click", closeLightbox);
lightboxDownload.addEventListener("click", () => {
  if (activeLightboxId) downloadPhoto(activeLightboxId);
});
lightboxDelete.addEventListener("click", () => {
  if (activeLightboxId) deletePhoto(activeLightboxId);
});
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
});

loadPhotos();
