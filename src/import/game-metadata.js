"use strict";

function getAutoThumbnailCandidateScore(path) {
    const normalized = normalizePath(path).toLowerCase();
    if (!normalized) {
      return Number.MAX_SAFE_INTEGER;
    }

    const fileName = normalized.split("/").pop() || "";
    const stem = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
    const directory = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const candidates = [
      ["thumbnail", 0],
      ["thumb", 1],
      ["cover", 2],
      ["poster", 3],
      ["boxart", 4],
      ["gamecover", 5],
      ["art", 6]
    ];

    for (const [token, score] of candidates) {
      const matchesStem =
        stem === token ||
        stem.startsWith(token + "-") ||
        stem.startsWith(token + "_") ||
        stem.endsWith("-" + token) ||
        stem.endsWith("_" + token);
      if (matchesStem) {
        return score;
      }
    }

    for (const [token, score] of candidates) {
      const directoryMatches =
        directory === token ||
        directory.endsWith("/" + token) ||
        directory.includes("/" + token + "/");
      if (directoryMatches) {
        return score;
      }
    }

    return Number.MAX_SAFE_INTEGER;
  }

function findAutoThumbnailDataUrl(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return "";
    }

    let selected = null;
    for (const entry of entries) {
      const path = normalizePath(entry && entry.path ? entry.path : "");
      const mime = mimeFromPath(path);
      if (!path || !/^image\//.test(mime)) {
        continue;
      }

      const score = getAutoThumbnailCandidateScore(path);
      if (score === Number.MAX_SAFE_INTEGER) {
        continue;
      }

      const bytes = entry && entry.bytes instanceof Uint8Array
        ? entry.bytes
        : new Uint8Array(entry && entry.bytes ? entry.bytes : []);
      if (!bytes.length) {
        continue;
      }

      if (!selected || score < selected.score || (score === selected.score && path.length < selected.path.length)) {
        selected = { score, path, bytes };
      }
    }

    if (!selected) {
      return "";
    }

    return "data:" + mimeFromPath(selected.path) + ";base64," + bytesToBase64(selected.bytes);
  }

function pickFirstStringValue(target, keys) {
    if (!target || typeof target !== "object") {
      return "";
    }
    for (const key of keys) {
      const value = target[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

function pickNestedStringValue(target, keys, nestedKeys) {
    if (!target || typeof target !== "object") {
      return "";
    }

    for (const key of keys) {
      const value = target[key];
      if (value && typeof value === "object") {
        const nested = pickFirstStringValue(value, nestedKeys);
        if (nested) {
          return nested;
        }
      }
    }
    return pickFirstStringValue(target, keys);
  }

function resolveLauncherMetadataImagePath(value) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (value && typeof value === "object") {
      for (const key of ["path", "src", "file", "url", "image", "thumbnail"]) {
        if (typeof value[key] === "string" && value[key].trim()) {
          return value[key].trim();
        }
      }
    }
    return "";
  }

const LAUNCHER_METADATA_FILE_NAMES = new Set([
    "launcher.json",
    "cbgames.json",
    "game.json",
    "metadata.json",
    ".launcher.json",
    ".cbgames-metadata.json"
  ]);

function isLauncherMetadataPath(path) {
    const fileName = normalizePath(path).split("/").pop() || "";
    const lower = fileName.toLowerCase();
    return LAUNCHER_METADATA_FILE_NAMES.has(lower) || lower.endsWith("-launcher.json") || lower.endsWith("-cbgames.json") || lower.endsWith("-game.json");
  }

async function recoverGameThumbnailFromStoredFiles(game) {
    if (!game || (typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl)) {
      return "";
    }

    let files;
    try {
      files = await getAllFilesForGame(game.id);
    } catch (error) {
      console.warn("Could not inspect saved files while restoring the thumbnail for " + game.name + ".", error);
      return "";
    }
    if (!files.length) {
      return "";
    }

    const readBytes = async (record) => {
      if (!record || !record.blob || typeof record.blob.arrayBuffer !== "function") {
        return new Uint8Array(0);
      }
      return new Uint8Array(await record.blob.arrayBuffer());
    };
    const metadataRecords = files.filter((record) => isLauncherMetadataPath(record.path || ""));
    const parsedMetadata = [];
    for (const record of metadataRecords) {
      try {
        const json = JSON.parse(decodeUtf8(await readBytes(record)));
        if (json && json.launcher && typeof json.launcher === "object") {
          parsedMetadata.push({ record, json });
        }
      } catch {
        // A damaged metadata file should not prevent trying other recovery candidates.
      }
    }
    parsedMetadata.sort((left, right) =>
      Number(right.json._cbgames === GAME_EDITOR_METADATA_MARKER) -
      Number(left.json._cbgames === GAME_EDITOR_METADATA_MARKER)
    );
    const managedMetadataFound = parsedMetadata.some(
      ({ json }) => json._cbgames === GAME_EDITOR_METADATA_MARKER
    );
    for (const { json } of parsedMetadata) {
      const coverValue = json.launcher.cover;
      const coverPath = typeof coverValue === "string"
        ? coverValue
        : resolveLauncherMetadataImagePath(coverValue);
      if (!coverPath) {
        continue;
      }
      const targetPath = normalizePath(coverPath);
      if (!targetPath || targetPath.startsWith("/") || targetPath.split("/").includes("..")) {
        continue;
      }
      const resolvedPath = targetPath;
      const mime = mimeFromPath(resolvedPath);
      const record = files.find((file) => normalizePath(file.path || "") === resolvedPath);
      if (record && mime.startsWith("image/")) {
        try {
          const bytes = await readBytes(record);
          if (bytes.length) {
            return "data:" + mime + ";base64," + bytesToBase64(bytes);
          }
        } catch {
          // Fall through to the usual filename-based candidates.
        }
      }
    }

    // Do not replace an explicitly managed-but-missing cover with an unrelated guessed image.
    if (managedMetadataFound) {
      return "";
    }

    const imageCandidates = files
      .filter((record) => {
        const path = normalizePath(record.path || "");
        return path !== "launcher.json" &&
          !path.split("/").some((segment) => segment.startsWith("__cbgames-launcher"));
      })
      .map((record) => ({
        record,
        path: normalizePath(record.path || ""),
        score: getAutoThumbnailCandidateScore(record.path || "")
      }))
      .filter((candidate) =>
        mimeFromPath(candidate.path).startsWith("image/") &&
        candidate.score !== Number.MAX_SAFE_INTEGER
      )
      .sort((left, right) =>
        left.score - right.score || left.path.length - right.path.length
      );

    for (const candidate of imageCandidates) {
      try {
        const bytes = await readBytes(candidate.record);
        const thumbnailDataUrl = findAutoThumbnailDataUrl([{ path: candidate.path, bytes }]);
        if (thumbnailDataUrl) {
          return thumbnailDataUrl;
        }
      } catch {
        // Skip unreadable candidates and try the next best match.
      }
    }
    return "";
  }

function detectLauncherMetadata(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return { name: "", thumbnailDataUrl: "" };
    }

    const entryMap = new Map();
    for (const entry of entries) {
      const path = normalizePath(entry && entry.path ? entry.path : "");
      if (!path) {
        continue;
      }
      entryMap.set(path, entry);
      const fileName = path.split("/").pop() || "";
      if (fileName) {
        entryMap.set(fileName.toLowerCase(), entry);
      }
    }

    let metadataEntry = null;
    let metadataPath = "";
    for (const entry of entries) {
      const path = normalizePath(entry && entry.path ? entry.path : "");
      if (!path) {
        continue;
      }
      if (isLauncherMetadataPath(path)) {
        metadataEntry = entry;
        metadataPath = path;
        break;
      }
    }

    if (!metadataEntry) {
      return { name: "", thumbnailDataUrl: "" };
    }

    try {
      const jsonText = decodeUtf8(metadataEntry.bytes instanceof Uint8Array ? metadataEntry.bytes : new Uint8Array(metadataEntry.bytes || []));
      const json = JSON.parse(jsonText);
      if (!json || typeof json !== "object") {
        return { name: "", thumbnailDataUrl: "" };
      }

      const name = pickNestedStringValue(json, ["name", "title", "gameName", "displayName", "label"], ["name", "title", "gameName", "displayName"])
        || pickNestedStringValue(json, ["game", "launcher", "metadata"], ["name", "title", "gameName", "displayName"])
        || pickNestedStringValue(json, ["config"], ["name", "title", "gameName", "displayName"]);

      const imagePathValue = resolveLauncherMetadataImagePath(
        pickNestedStringValue(json, ["thumbnail", "cover", "image", "icon", "poster"], ["path", "src", "file", "url", "image", "thumbnail"])
          || json.thumbnail
          || json.cover
          || json.image
          || json.icon
          || json.poster
          || (json.launcher && (json.launcher.thumbnail || json.launcher.cover || json.launcher.image || json.launcher.icon))
          || (json.game && (json.game.thumbnail || json.game.cover || json.game.image || json.game.icon))
      );

      let thumbnailDataUrl = "";
      if (imagePathValue) {
        const targetPath = normalizePath(imagePathValue);
        const thumbEntry = entryMap.get(targetPath) || entryMap.get(targetPath.split("/").pop() || "");
        if (thumbEntry && thumbEntry.bytes) {
          const bytes = thumbEntry.bytes instanceof Uint8Array
            ? thumbEntry.bytes
            : new Uint8Array(thumbEntry.bytes || []);
          if (bytes.length) {
            const mime = mimeFromPath(targetPath);
            if (/^image\//.test(mime)) {
              thumbnailDataUrl = "data:" + mime + ";base64," + bytesToBase64(bytes);
            }
          }
        }
      }

      return {
        name: String(name || "").trim(),
        thumbnailDataUrl,
        thumbnailPath: imagePathValue,
        path: metadataPath
      };
    } catch {
      return { name: "", thumbnailDataUrl: "" };
    }
  }
