"use strict";
function normalizePath(path) {
    return String(path)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/");
  }

function shouldRunSecretBadgeRescan() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const raw = String(params.get(BADGE_RESCAN_SECRET_PARAM) || "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    } catch {
      return false;
    }
  }

function dirnamePath(path) {
    const normalized = normalizePath(path);
    const idx = normalized.lastIndexOf("/");
    if (idx === -1) {
      return "";
    }
    return normalized.slice(0, idx);
  }

function toVirtualUrl(path) {
    const normalized = normalizePath(path);
    const encoded = normalized.split("/").map(encodeURIComponent).join("/");
    return VFS_ORIGIN + encoded;
  }

function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "game-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

function deriveGameName(fileName) {
    const cleaned = String(fileName || "")
      .replace(/\.zip$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    return cleaned || "Imported Game";
  }

function normalizeGameIdentity(value) {
    return String(value || "")
      .replace(/\.zip$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

function detectUnityByPaths(paths) {
    for (const rawPath of paths || []) {
      const path = normalizePath(rawPath).toLowerCase();
      if (!path) {
        continue;
      }
      if (
        /(^|\/)unityloader\.js$/.test(path) ||
        /(^|\/)unityprogress\.js$/.test(path) ||
        /(^|\/)build\/.*\.(data|wasm|mem|unityweb|loader\.js|framework\.js|json)$/.test(path) ||
        /(^|\/)templatedata\//.test(path)
      ) {
        return true;
      }
    }
    return false;
  }

function detectUnityByHtmlText(text) {
    if (typeof text !== "string" || !text) {
      return false;
    }
    return /createUnityInstance\s*\(|UnityLoader\.instantiate\s*\(|unityInstance/i.test(text);
  }

function detectFlashByPaths(paths) {
    for (const rawPath of paths || []) {
      const path = normalizePath(rawPath).toLowerCase();
      if (/(^|\/)[^/]+\.swf$/.test(path)) {
        return true;
      }
    }
    return false;
  }

function detectSharedArrayBufferUsage(processedEntries) {
    // Scan JavaScript and HTML files for SharedArrayBuffer usage
    const sharedArrayBufferPattern = /\bSharedArrayBuffer\b/;
    for (const entry of processedEntries || []) {
      // Only check files that may contain executable script content
      if (!/\.(?:js|mjs|cjs|html?)$/i.test(entry.path)) {
        continue;
      }
      try {
        const text = decodeUtf8(entry.bytes);
        if (sharedArrayBufferPattern.test(text)) {
          return true;
        }
      } catch (error) {
        // Ignore decode errors and continue scanning
        continue;
      }
    }
    return false;
  }

function toHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.href;
    } catch {
      return "";
    }
  }

function normalizeGithubSource(raw) {
    const source = raw && typeof raw === "object" ? raw : null;
    if (!source) {
      return null;
    }
    const provider = String(source.provider || "").toLowerCase();
    if (provider === "github-release") {
      const owner = String(source.owner || "").trim();
      const repo = String(source.repo || "").trim();
      const downloadUrl = toHttpUrl(source.downloadUrl || "");
      if (!owner || !repo || !downloadUrl) {
        return null;
      }
      return {
        provider,
        owner,
        repo,
        releaseTag: String(source.releaseTag || ""),
        releaseId: Number(source.releaseId) || 0,
        assetId: Number(source.assetId) || 0,
        assetName: String(source.assetName || ""),
        assetUpdatedAt: Number(source.assetUpdatedAt) || 0,
        downloadUrl,
        etag: String(source.etag || ""),
        lastModified: String(source.lastModified || ""),
        lastCheckedAt: Number(source.lastCheckedAt) || 0
      };
    }
    if (provider === "zip-url") {
      const url = toHttpUrl(source.url || "");
      if (!url) {
        return null;
      }
      return {
        provider,
        url,
        etag: String(source.etag || ""),
        lastModified: String(source.lastModified || ""),
        lastCheckedAt: Number(source.lastCheckedAt) || 0
      };
    }
    if (provider === "github-tree") {
      const owner = String(source.owner || "").trim();
      const repo = String(source.repo || "").trim();
      const branch = String(source.branch || "").trim();
      const treeSha = String(source.treeSha || "").trim();
      if (!owner || !repo || !branch || !treeSha) {
        return null;
      }
      return {
        provider,
        owner,
        repo,
        branch,
        treeSha,
        lastCheckedAt: Number(source.lastCheckedAt) || 0
      };
    }
    return null;
  }

function parseGithubRepoRef(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      return null;
    }
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
      const parts = raw.split("/");
      return { owner: parts[0], repo: parts[1] };
    }
    try {
      const parsed = new URL(raw);
      if (parsed.hostname !== "github.com") {
        return null;
      }
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2) {
        return null;
      }
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/i, "")
      };
    } catch {
      return null;
    }
  }

function normalizeHttpHeaderToken(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }

function extractZipFileNameFromResponse(response, fallbackUrl) {
    const disposition = response && response.headers ? response.headers.get("content-disposition") : "";
    if (typeof disposition === "string" && disposition) {
      const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
      if (encoded && encoded[1]) {
        try {
          const value = decodeURIComponent(encoded[1].replace(/^"(.*)"$/, "$1"));
          if (value) {
            return value;
          }
        } catch {
          // ignore
        }
      }
      const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (plain && plain[1]) {
        return plain[1];
      }
    }
    try {
      const parsed = new URL(String(fallbackUrl || response.url || ""));
      const base = parsed.pathname.split("/").pop() || "";
      if (base) {
        return decodeURIComponent(base);
      }
    } catch {
      // ignore
    }
    return "download.zip";
  }

function mimeFromPath(path) {
    const lower = normalizePath(path).toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
    switch (ext) {
      case ".html":
      case ".htm":
        return "text/html";
      case ".js":
      case ".mjs":
      case ".cjs":
        return "application/javascript";
      case ".css":
        return "text/css";
      case ".json":
        return "application/json";
      case ".wasm":
        return "application/wasm";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".svg":
        return "image/svg+xml";
      case ".ico":
        return "image/x-icon";
      case ".webp":
        return "image/webp";
      case ".mp3":
        return "audio/mpeg";
      case ".ogg":
        return "audio/ogg";
      case ".wav":
        return "audio/wav";
      case ".mp4":
        return "video/mp4";
      case ".webm":
        return "video/webm";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      case ".ttf":
        return "font/ttf";
      case ".otf":
        return "font/otf";
      case ".unityweb":
      case ".data":
      case ".mem":
      case ".bin":
        return "application/octet-stream";
      default:
        return "application/octet-stream";
    }
  }

function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

function normalizeResolverBase(baseHref) {
    if (typeof baseHref === "string" && baseHref) {
      try {
        const parsed = new URL(baseHref);
        if (parsed.origin === VFS_ORIGIN_URL) {
          return parsed.href;
        }
      } catch {
        // fall through
      }
    }
    if (state.activeEntryPath) {
      return toVirtualUrl(state.activeEntryPath);
    }
    return VFS_ORIGIN;
  }

function resolveToPath(rawValue, baseHref) {
    if (typeof rawValue !== "string") {
      return null;
    }
    const value = rawValue.trim();
    if (!value || value.startsWith("#")) {
      return null;
    }
    const lower = value.toLowerCase();
    if (
      lower.startsWith("data:") ||
      lower.startsWith("blob:") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:")
    ) {
      return null;
    }
    let resolved;
    try {
      resolved = new URL(value, baseHref || VFS_ORIGIN);
    } catch {
      return null;
    }
    if (resolved.origin !== VFS_ORIGIN_URL) {
      return null;
    }
    const decoded = decodeURIComponent(resolved.pathname.slice(1));
    const normalized = normalizePath(decoded);
    return normalized || null;
  }

function resolveMediaSchemePath(rawValue) {
    if (typeof rawValue !== "string") {
      return null;
    }
    const value = rawValue.trim();
    if (!value || !/^media:/i.test(value)) {
      return null;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "media:") {
        return null;
      }
      const host = normalizePath(parsed.hostname || "");
      const pathname = normalizePath((parsed.pathname || "").replace(/^\/+/, ""));
      const combined = normalizePath([host, pathname].filter(Boolean).join("/"));
      return combined || null;
    } catch {
      return null;
    }
  }

function resolveFileSchemePath(rawValue) {
    if (typeof rawValue !== "string") {
      return null;
    }
    const value = rawValue.trim();
    if (!value || !/^file:/i.test(value)) {
      return null;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "file:") {
        return null;
      }
      const decoded = decodeURIComponent(parsed.pathname || "");
      const normalized = normalizePath(decoded);
      return normalized || null;
    } catch {
      return null;
    }
  }

function buildAssetFallbackCandidates(path) {
    const normalized = normalizePath(path);
    if (!normalized) {
      return [];
    }

    const out = [normalized];
    const push = (candidate) => {
      const next = normalizePath(candidate);
      if (next && !out.includes(next)) {
        out.push(next);
      }
    };

    const mediaTrimmed = normalized.replace(/^media\/+/i, "");
    const baseAsset = mediaTrimmed || normalized;
    if (!/^static\/blocks-media\//i.test(baseAsset)) {
      push("static/blocks-media/default/" + baseAsset);
      push("static/blocks-media/high-contrast/" + baseAsset);
    }

    const fileNameOnly = baseAsset.split("/").pop() || "";
    if (fileNameOnly && fileNameOnly !== baseAsset) {
      push(fileNameOnly);
      push("static/blocks-media/default/" + fileNameOnly);
      push("static/blocks-media/high-contrast/" + fileNameOnly);
    }

    return out;
  }

function entryDepth(path) {
    return normalizePath(path).split("/").length - 1;
  }

function scoreEntryPath(path) {
    const normalized = normalizePath(path).toLowerCase();
    const base = normalized.split("/").pop() || normalized;
    let score = 0;

    if (base === "play.html") {
      score += 340;
    } else if (base === "index.html") {
      score += 320;
    } else if (base === "game.html") {
      score += 260;
    } else if (base === "main.html") {
      score += 230;
    } else if (base === "start.html") {
      score += 220;
    } else if (base === "launch.html") {
      score += 200;
    } else {
      score += 120;
    }

    if (normalized === "play.html" || normalized === "index.html") {
      score += 70;
    }

    if (/\/(assets|scripts|js|vendor|lib|dist|build|docs|examples|tests)\//.test(normalized)) {
      score -= 95;
    }
    if (/(loader|preload|preloader|unityloader|template|embed|frame|privacy|terms)/.test(base)) {
      score -= 120;
    }

    score -= entryDepth(normalized) * 3;
    return score;
  }

function chooseBestEntryPath(entries, preferredPath) {
    if (preferredPath && entries.includes(preferredPath)) {
      return preferredPath;
    }
    const sorted = entries.slice().sort((a, b) => {
      const scoreDiff = scoreEntryPath(b) - scoreEntryPath(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const depthDiff = entryDepth(a) - entryDepth(b);
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return a.localeCompare(b);
    });
    return sorted[0] || "";
  }

function isZipLikeFile(file) {
    if (!file) {
      return false;
    }
    const name = String(file.name || "");
    const type = String(file.type || "").toLowerCase();
    return (
      /\.zip$/i.test(name) ||
      type === "application/zip" ||
      type === "application/x-zip-compressed"
    );
  }

function hasDragFiles(event) {
    const types = event && event.dataTransfer && event.dataTransfer.types
      ? Array.from(event.dataTransfer.types)
      : [];
    return types.includes("Files");
  }

function normalizeErrorText(value, maxLength = 4000) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (!text) {
      return "";
    }
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 3)) + "...";
  }
