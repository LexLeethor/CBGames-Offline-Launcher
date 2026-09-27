"use strict";

const MIRROR_CATALOG_DEFAULT_URL = "https://dhbsgs572kngg.cloudfront.net/Games/games.json";
const MIRROR_CATALOG_ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

async function importFromMirrorCatalog() {
  const catalogUrl = toHttpUrl(mirrorCatalogUrlInput.value || MIRROR_CATALOG_DEFAULT_URL);
  if (!catalogUrl) {
    setMirrorCatalogStatus("Enter a valid HTTP(S) games.json URL.", "error");
    return;
  }
  mirrorCatalogUrlInput.value = catalogUrl;
  putSetting(SETTING_MIRROR_CATALOG_URL, catalogUrl).catch((error) => console.warn("Could not save mirror catalog URL.", error));
  setMirrorCatalogStatus("Checking mirror catalog…");
  loadMirrorCatalogButton.disabled = true;
  setActionButtonsDisabled(true);    setWorkProgress("Checking mirror catalog", 0, 0);

  try {
    const catalog = await fetchMirrorJson(catalogUrl);
    const games = normalizeMirrorCatalogGames(catalog, catalogUrl);
    if (!games.length) throw new Error("The catalog contains no usable games.");
    for (let index = 0; index < games.length; index += 1) {
      const game = games[index];
      setWorkProgress("Checking game metadata (" + (index + 1) + "/" + games.length + ")", index + 1, games.length);
      try {
        game.launcherMetadata = await fetchMirrorLauncherJson(game);
        if (game.launcherMetadata.name) game.name = game.launcherMetadata.name;
        if (game.launcherMetadata.thumbnailPath) game.thumbnailPath = game.launcherMetadata.thumbnailPath;
        if (!game.rawThumbnailPath && typeof game.launcherMetadata.thumbnailPath === "string") game.rawThumbnailPath = game.launcherMetadata.thumbnailPath;
      } catch (error) {
        console.info("Could not preload launcher.json for " + game.name + ".", error);
      }
    }

    state.mirrorCatalogDraft = {
      catalogUrl,
      games: games.map((game, index) => {
        const conflictName = getMirrorCatalogConflictName(game);
        return {
          ...game,
          index,
          catalogUrl,
          selected: false,
          conflictName
        };
      })
    };
    openMirrorCatalogModal(state.mirrorCatalogDraft);
    setMirrorCatalogStatus("Found " + games.length + " game(s) on the mirror.", "success");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setMirrorCatalogStatus("Could not load mirror catalog: " + message, "error");
    log("Mirror catalog lookup failed: " + message, "error");
  } finally {
    loadMirrorCatalogButton.disabled = false;
    setActionButtonsDisabled(false);
    clearWorkProgress();
  }
}

async function fetchMirrorJson(url) {
  const response = await fetch(url, { cache: "no-store", mode: "cors", redirect: "follow" });
  if (!response.ok) throw new Error("Request failed (" + response.status + ").");
  return response.json();
}

function normalizeMirrorCatalogGames(catalog, catalogUrl) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.games)) {
    throw new Error("Expected a JSON object with a games array.");
  }
  const catalogBase = new URL("/", catalogUrl);
  const seenNames = new Set();
  const seenPrefixes = new Map();
  const games = [];
  const encodedSegments = (value) => String(value || "").split("/").map(encodeURIComponent).join("/");
  for (const rawGame of catalog.games) {
    if (!rawGame || typeof rawGame !== "object") continue;
    const name = String(rawGame.name || "").trim();
    const owner = String(rawGame.owner || "").trim();
    const repo = String(rawGame.repo || "").trim();
    const branch = String(rawGame.branch || "").trim();
    const prefix = normalizeMirrorPrefix(rawGame.s3Prefix);
    if (!name || !owner || !repo || !branch || !prefix || !Array.isArray(rawGame.files)) continue;
    const identity = normalizeGameIdentity(name);
    if (!identity || seenNames.has(identity)) continue;
    seenNames.add(identity);

    const files = [];
    const paths = new Set();
    for (const rawFile of rawGame.files) {
      if (!rawFile || typeof rawFile !== "object") continue;
      const path = normalizeMirrorFilePath(rawFile.path);
      if (!path || paths.has(path)) continue;
      paths.add(path);
      const listedKey = typeof rawFile.s3Key === "string" ? rawFile.s3Key.trim() : "";
      const relativeKey = listedKey ? listedKey.replace(/^\/+/, "") : prefix + path;
      // Do not allow a catalog entry to point outside its declared game prefix.
      if (!relativeKey.startsWith(prefix) || normalizeMirrorFilePath(relativeKey.slice(prefix.length)) !== path) continue;
      const fileUrl = resolveMirrorFileUrl(encodeMirrorPath(relativeKey), catalogBase);
      if (!fileUrl) continue;
      files.push({
        path,
        url: fileUrl,
        size: Number.isFinite(Number(rawFile.size)) && Number(rawFile.size) >= 0 ? Number(rawFile.size) : 0,
        contentType: String(rawFile.contentType || mimeFromPath(path)),
        sha: String(rawFile.sha || "")
      });
    }
    if (!files.some((file) => /\.html?$/i.test(file.path))) continue;
    const previousGameName = seenPrefixes.get(prefix);
    if (previousGameName) {
      throw new Error(
        'Games "' + previousGameName + '" and "' + name + '" share the mirror prefix "' + prefix + '". ' +
        "Correct s3Prefix in games.json so each game points to its own files."
      );
    }
    seenPrefixes.set(prefix, name);
    games.push({
      name,
      owner,
      repo,
      branch,
      prefix,
      commit: String(rawGame.commit || ""),
      files,
      totalBytes: Number(rawGame.totalBytes) || files.reduce((sum, file) => sum + file.size, 0),
      fileCount: files.length,
      rawThumbnailPath: resolveMirrorThumbnailPath(rawGame.thumbnail, files),
      thumbnailPath: resolveMirrorThumbnailPath(rawGame.thumbnail, files)
    });
  }
  return games;
}

function normalizeMirrorPrefix(value) {
  const prefix = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!prefix || prefix.split("/").some((part) => part === "..")) return "";
  return prefix.endsWith("/") ? prefix : prefix + "/";
}

function normalizeMirrorFilePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return "";
  for (const part of parts) {
    let decoded = part;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || Array.from(decoded).some((character) => character.charCodeAt(0) < 32)) return "";
  }
  return parts.join("/");
}

function encodeMirrorPath(value) {
  return String(value || "").split("/").map((part) => {
    try {
      return encodeURIComponent(decodeURIComponent(part));
    } catch {
      return encodeURIComponent(part);
    }
  }).join("/");
}

function resolveMirrorFileUrl(key, baseUrl) {
  const raw = String(key || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("//")) return "";
  let url;
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(raw)
      ? new URL(raw)
      : new URL(raw, baseUrl);
  } catch {
    return "";
  }
  if (!MIRROR_CATALOG_ALLOWED_PROTOCOLS.has(url.protocol) || url.username || url.password) return "";
  return url.href;
}

function resolveMirrorThumbnailPath(value, files) {
  const raw = typeof value === "string" ? value.trim() : "";
  const thumbnailRef = raw || "thumbnail.png";
  const fallbackFile = files.find((file) => file.path.toLowerCase() === "thumbnail.png") || files.find((file) => file.path.toLowerCase().includes("thumbnail"));
  const fallbackPath = fallbackFile ? fallbackFile.path : "";
  if (/^data:image\//i.test(thumbnailRef)) return { dataUrl: thumbnailRef };
  if (/^[a-z][a-z0-9+.-]*:/i.test(thumbnailRef)) {
    const remoteUrl = toHttpUrl(thumbnailRef);
    return remoteUrl ? { remoteUrl } : "";
  }
  const localPath = normalizeMirrorFilePath(thumbnailRef.replace(/^\/+/, ""));
  if (!localPath) return fallbackPath;
  const match = findMirrorFileByPath(files, localPath);
  return match ? match.path : fallbackPath;
}

function findMirrorFileByPath(files, path) {
  const normalizedPath = normalizeMirrorFilePath(String(path || "").replace(/^\/+/, ""));
  if (!normalizedPath) return null;
  const lowerPath = normalizedPath.toLowerCase();
  const lowerName = normalizedPath.split("/").pop().toLowerCase();
  return (files || []).find((file) => normalizeMirrorFilePath(file.path || "").toLowerCase() === lowerPath) ||
    (files || []).find((file) => normalizeMirrorFilePath(file.path || "").split("/").pop().toLowerCase() === lowerName) || null;
}

function getMirrorCatalogConflictName(mirrorGame) {
  const incoming = normalizeGameIdentity(mirrorGame.name || "");
  for (const game of state.gamesById.values()) {
    if (incoming && (incoming === normalizeGameIdentity(game.name || "") || incoming === normalizeGameIdentity(game.zipName || ""))) {
      return String(game.name || mirrorGame.name);
    }
  }
  return "";
}

function openMirrorCatalogModal(draft) {
  mirrorCatalogSummary.textContent = draft.games.length + " game(s) found on " + new URL(draft.catalogUrl).host + ". Choose which to import.";
  renderMirrorCatalogModal();
  mirrorCatalogModal.classList.add("open");
  mirrorCatalogModal.setAttribute("aria-hidden", "false");
  mirrorCatalogImportButton.focus();
}

function closeMirrorCatalogModal() {
  mirrorCatalogModal.classList.remove("open");
  mirrorCatalogModal.setAttribute("aria-hidden", "true");
  state.mirrorCatalogDraft = null;
}

function renderMirrorCatalogModal() {
  const draft = state.mirrorCatalogDraft;
  if (!draft) return;
  mirrorCatalogList.replaceChildren();
  for (const game of draft.games) {
    const row = document.createElement("div");
    row.className = "bundle-preview-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(game.selected);
    checkbox.dataset.mirrorSelect = String(game.index);
    checkbox.setAttribute("aria-label", "Select " + game.name);

    const thumbnail = document.createElement("div");
    thumbnail.className = "bundle-preview-thumb";
    const thumbFile = typeof game.thumbnailPath === "string"
      ? game.files.find((file) => file.path === game.thumbnailPath)
      : null;
    const thumbUrl = typeof game.thumbnailPath === "object"
      ? (game.thumbnailPath.remoteUrl || game.thumbnailPath.dataUrl || "")
      : (thumbFile ? thumbFile.url : "");
    if (thumbUrl) {
      thumbnail.style.backgroundImage = "url(\"" + thumbUrl.replace(/[\\"\n\r]/g, "\\$&") + "\")";
    } else {
      thumbnail.classList.add("no-thumb");
    }

    const main = document.createElement("div");
    main.className = "bundle-preview-main";
    const title = document.createElement("p");
    title.className = "bundle-preview-title";
    title.textContent = game.name;
    const metadata = document.createElement("p");
    metadata.className = "bundle-preview-meta";
    metadata.textContent = formatBytes(game.totalBytes) + " • " + game.fileCount + " files • " + game.owner + "/" + game.repo + "@" + game.branch;
    const status = document.createElement("p");
    status.className = "bundle-preview-status";
    status.textContent = game.conflictName ? "Already installed as “" + game.conflictName + "”." : "Available to import.";
    main.append(title, metadata, status);

    const controls = document.createElement("div");
    controls.className = "bundle-preview-controls";
    const hint = document.createElement("span");
    hint.className = "bundle-preview-controls-hint";
    hint.textContent = game.conflictName ? "Import as separate copy" : "New game";
    controls.append(hint);
    row.append(checkbox, thumbnail, main, controls);
    mirrorCatalogList.append(row);
  }
  const selected = draft.games.filter((game) => game.selected);
  const bytes = selected.reduce((sum, game) => sum + game.totalBytes, 0);
  const files = selected.reduce((sum, game) => sum + game.fileCount, 0);
  mirrorCatalogPlan.textContent = "Selected: " + selected.length + " game(s), " + files + " file(s), " + formatBytes(bytes) + ".";
  mirrorCatalogImportButton.disabled = selected.length === 0 || state.actionInProgress;
}

function setMirrorCatalogStatus(message, kind) {
  if (!mirrorCatalogStatus) return;
  mirrorCatalogStatus.textContent = String(message || "");
  mirrorCatalogStatus.classList.toggle("is-error", kind === "error");
  mirrorCatalogStatus.classList.toggle("is-success", kind === "success");
}

async function importSelectedMirrorGames() {
  const draft = state.mirrorCatalogDraft;
  if (!draft) return;
  const selected = draft.games.filter((game) => game.selected);
  if (!selected.length) return;
  closeMirrorCatalogModal();
  setActionButtonsDisabled(true);
  let importedCount = 0;
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const game = selected[index];
      setWorkProgress("Preparing " + game.name + " (" + (index + 1) + "/" + selected.length + ")", 0, game.totalBytes, {
        currentText: "0 B",
        totalText: formatBytes(game.totalBytes)
      });
      if (game.launcherMetadata) {
        if (game.launcherMetadata.name) game.name = game.launcherMetadata.name;
        if (game.launcherMetadata.thumbnailPath) game.thumbnailPath = game.launcherMetadata.thumbnailPath;
        if (!game.rawThumbnailPath && typeof game.launcherMetadata.thumbnailPath === "string") game.rawThumbnailPath = game.launcherMetadata.thumbnailPath;
      }
      if (await importMirrorGameFiles(game)) importedCount += 1;
    }
    log("Imported " + importedCount + " game(s) from mirror catalog.");
    setMirrorCatalogStatus("Imported " + importedCount + " game(s) from the mirror.", "success");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setMirrorCatalogStatus("Mirror import stopped: " + message, "error");
    log("Mirror import failed: " + message, "error");
    openWrongZipTypeModal(message, "Mirror Import Failed");
  } finally {
    state.mirrorCatalogDraft = null;
    setActionButtonsDisabled(false);
    clearWorkProgress();
  }
}

async function fetchMirrorLauncherJson(game) {
  const entry = game.files.find((file) => normalizeMirrorFilePath(file.path || "").split("/").pop().toLowerCase() === "launcher.json");
  if (!entry) return { name: "", thumbnailPath: game.rawThumbnailPath || game.thumbnailPath || "" };
  const response = await fetch(entry.url, { cache: "no-store", mode: "cors" });
  if (!response.ok) throw new Error("Could not read " + game.name + " launcher.json (" + response.status + ").");

  const json = await response.json();
  const launcher = json && json.launcher && typeof json.launcher === "object" ? json.launcher : json;
  const name = String(launcher.name || launcher.title || launcher.gameName || launcher.displayName || "").trim();
  const imageValue = launcher.cover || launcher.thumbnail || launcher.image || launcher.icon || launcher.poster || "";
  const imagePath = typeof imageValue === "string"
    ? imageValue.trim()
    : String(imageValue && (imageValue.path || imageValue.src || imageValue.file || imageValue.url || imageValue.image || imageValue.thumbnail) || "").trim();
  let thumbnailPath = "";
  if (imagePath) {
    const value = imagePath;
    if (/^data:image\//i.test(value)) {
      thumbnailPath = { dataUrl: value };
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      const remoteUrl = toHttpUrl(value);
      const matchingFile = remoteUrl && game.files.find((file) => {
        try { return new URL(file.url).href === remoteUrl; } catch { return false; }
      });
      thumbnailPath = matchingFile ? matchingFile.path : (remoteUrl ? { remoteUrl } : "");
    } else {
      const relativePath = normalizeMirrorFilePath(value.replace(/^\/+/, ""));
      const match = relativePath ? findMirrorFileByPath(game.files, relativePath) : null;
      if (match) {
        thumbnailPath = match.path;
      } else if (relativePath) {
        const base = new URL(".", entry.url);
        const resolved = resolveMirrorFileUrl(encodeMirrorPath(relativePath), base);
        if (resolved) thumbnailPath = { remoteUrl: resolved };
      }
    }
  }
  return { name, thumbnailPath: thumbnailPath || game.rawThumbnailPath || game.thumbnailPath || "" };
}

async function readMirrorLauncherMetadataFromEntries(entries, game) {
  const launcherEntry = entries.find((entry) => normalizePath(entry.path || "").split("/").pop().toLowerCase() === "launcher.json");
  if (!launcherEntry || !(launcherEntry.bytes instanceof Uint8Array)) return null;

  let parsed;
  try {
    parsed = JSON.parse(decodeUtf8(launcherEntry.bytes));
  } catch {
    return null;
  }
  const launcher = parsed && parsed.launcher && typeof parsed.launcher === "object" ? parsed.launcher : parsed;
  const name = String(launcher.name || launcher.title || launcher.gameName || launcher.displayName || "").trim();
  const image = launcher.cover || launcher.thumbnail || launcher.image || launcher.icon || launcher.poster || "";

  const imagePath = typeof image === "string" ? image.trim() : String(image && (image.path || image.src || image.file || image.url || image.image || image.thumbnail) || "").trim();
  let thumbnailDataUrl = "";

  if (imagePath.toLowerCase().startsWith("data:image/")) {
    thumbnailDataUrl = imagePath;
  } else if (imagePath) {
    let assetEntry = null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(imagePath)) {
      const relativePath = normalizeMirrorFilePath(imagePath.replace(/^\/+/, ""));
      if (relativePath) {
        const launcherDirectory = normalizePath(launcherEntry.path || "").split("/").slice(0, -1).join("/");
        const joinedPath = normalizePath((launcherDirectory ? launcherDirectory + "/" : "") + relativePath).toLowerCase();
        const matchedFile = findMirrorFileByPath(entries, relativePath) || findMirrorFileByPath(entries, joinedPath);
        assetEntry = matchedFile;
      }
    } else {
      const imageUrl = toHttpUrl(imagePath);
      assetEntry = imageUrl ? entries.find((entry) => {
        const listed = (game.files || []).find((file) => normalizePath(file.path || "").toLowerCase() === normalizePath(entry.path || "").toLowerCase());
        if (!listed) return false;
        try { return new URL(listed.url).href === imageUrl; } catch { return false; }
      }) : null;
    }

    if (assetEntry && assetEntry.bytes instanceof Uint8Array && assetEntry.bytes.length) {
      const mime = mimeFromPath(assetEntry.path || imagePath);
      if (mime.startsWith("image/")) {
        thumbnailDataUrl = "data:" + mime + ";base64," + bytesToBase64(assetEntry.bytes);
      }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(imagePath)) {
      const imageUrl = toHttpUrl(imagePath);
      if (imageUrl) {
        try {
          const response = await fetch(imageUrl, { cache: "no-store", mode: "cors" });
          if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            const mime = response.headers.get("content-type") || mimeFromPath(imageUrl);
            if (mime.startsWith("image/")) thumbnailDataUrl = "data:" + mime.split(";")[0] + ";base64," + bytesToBase64(bytes);
          }
        } catch (error) {
          console.info("Could not load launcher.json thumbnail for " + game.name + ".", error);
        }
      }
    }
  }
  return { name, thumbnailDataUrl };
}

async function importMirrorGameFiles(game) {
  const expectedBytes = game.files.reduce((sum, file) => addGameImportBytes(sum, file.size), 0);
  if (isGameImportOversized(expectedBytes) && !(await askLargeGameImportDecision(game.name, expectedBytes))) return false;
  const gameId = makeId();

  const sourceRecord = {
    catalogUrl: game.catalogUrl || "",
    prefix: game.prefix,
    commit: game.commit,
    fileCount: game.fileCount,
    totalBytes: game.totalBytes
  };
  const gameRecord = {
    id: gameId,
    name: game.name,
    zipName: game.name + ".zip",
    importedAt: Date.now(),
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
    sortOrder: getNextSortOrder(),
    fileCount: 0,
    totalBytes: 0,
    htmlEntries: [],
    entryPath: "",
    thumbnailDataUrl: "",
    githubSource: null,
    mirrorSource: sourceRecord,
    unityDetected: false,
    flashDetected: false,
    importInProgress: true
  };
  const pending = [];
  let downloadedBytes = 0;
  try {
    await putGame(gameRecord);
    state.gamesById.set(gameId, gameRecord);
    setWorkProgressTree(0, game.files.length, "", game.files.map((file) => file.path));
    for (let index = 0; index < game.files.length; index += 1) {
      const file = game.files[index];
      setWorkProgressTree(index, game.files.length, file.path);
      let response;
      try {
        response = await fetch(file.url, { cache: "no-store", mode: "cors", redirect: "follow" });
      } catch (error) {
        throw new Error("Could not reach " + file.path + ". Check the mirror URL and its browser CORS settings.");
      }
      if (!response.ok) throw new Error("Download failed (" + response.status + ") for " + file.path + ".");
      setWorkProgressTree(index, game.files.length, file.path);
      const fileBytes = await readMirrorResponseBytes(response, (loaded) => {
        const current = addGameImportBytes(downloadedBytes, loaded);
        if (expectedBytes > 0) {
          setWorkProgress("Downloading " + game.name + " (" + (index + 1) + "/" + game.files.length + ")", current, expectedBytes, {
            currentText: formatBytes(current),
            totalText: formatBytes(expectedBytes)
          });
        }
      });
      downloadedBytes = addGameImportBytes(downloadedBytes, fileBytes.byteLength);
      setWorkProgressTree(index + 1, game.files.length, file.path);
      if (isStreamablePath(file.path)) {
        const blob = new Blob([fileBytes], { type: file.contentType || mimeFromPath(file.path) });
        await putFileRecord({ gameId, path: file.path, size: blob.size, type: blob.type, blob, transformations: [] });
        gameRecord.fileCount += 1;
        gameRecord.totalBytes = addGameImportBytes(gameRecord.totalBytes, blob.size);
        await putGame(gameRecord);
      } else {
        pending.push({ path: file.path, bytes: fileBytes });
      }
    }

    if (pending.length) {
      await importEntriesDirectly(pending, {
        existingGameId: gameId,
        gameName: gameRecord.name,
        archiveName: gameRecord.zipName,
        importMode: "separate",
        baseGameBytes: gameRecord.totalBytes,
        baseGameFileCount: gameRecord.fileCount,
        skipLargeWarning: true,
        skipExistingFilePaths: (await getAllFilesForGame(gameId)).map((record) => normalizePath(record.path || "")),
        mirrorSource: sourceRecord,
        suppressEdit: true,
        manageUi: false
      });
    }

    const stored = await getAllFilesForGame(gameId);
    const entries = [];
    for (const file of stored) {
      const bytes = file && file.blob ? new Uint8Array(await file.blob.arrayBuffer()) : new Uint8Array();
      entries.push({ path: file.path, bytes });
    }
    const metadata = detectLauncherMetadata(entries);
    const mirrorMetadata = await readMirrorLauncherMetadataFromEntries(entries, game);
    const paths = stored.map((file) => normalizePath(file.path || ""));
    const htmlEntries = paths.filter((path) => /\.html?$/i.test(path)).sort((a, b) => a.localeCompare(b));
    const declaredThumbnail = typeof game.thumbnailPath === "string"
      ? entries.find((entry) => normalizePath(entry.path) === normalizePath(game.thumbnailPath))
      : null;
    const thumbnailBytes = declaredThumbnail && declaredThumbnail.bytes && declaredThumbnail.bytes.length
      ? declaredThumbnail.bytes
      : null;
    let thumbnailDataUrl = (mirrorMetadata && mirrorMetadata.thumbnailDataUrl) || (thumbnailBytes
      ? "data:" + mimeFromPath(game.thumbnailPath) + ";base64," + bytesToBase64(thumbnailBytes)
      : (metadata.thumbnailDataUrl || findAutoThumbnailDataUrl(entries)));
    if (!thumbnailDataUrl && game.rawThumbnailPath && typeof game.rawThumbnailPath === "string") {
      const thumbnailFile = game.files.find((file) => file.path === game.rawThumbnailPath);
      if (thumbnailFile) {
        try {
          const response = await fetch(thumbnailFile.url, { cache: "no-store", mode: "cors" });
          if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            thumbnailDataUrl = "data:" + mimeFromPath(thumbnailFile.path) + ";base64," + bytesToBase64(bytes);
          }
        } catch (error) {
          console.info("Could not load mirror thumbnail for " + game.name + ".", error);
        }
      }
    }

    const latestRecord = state.gamesById.get(gameId) || gameRecord;
    Object.assign(gameRecord, latestRecord);
    gameRecord.name = (mirrorMetadata && mirrorMetadata.name) ||
      (game.launcherMetadata && game.launcherMetadata.name) || metadata.name || game.name;
    gameRecord.zipName = game.name + ".zip";
    gameRecord.fileCount = stored.length;
    gameRecord.totalBytes = stored.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    gameRecord.htmlEntries = htmlEntries;
    gameRecord.entryPath = chooseBestEntryPath(htmlEntries, "");
    gameRecord.thumbnailDataUrl = thumbnailDataUrl || (typeof game.thumbnailPath === "object" ? (game.thumbnailPath.remoteUrl || game.thumbnailPath.dataUrl || "") : "");
    gameRecord.mirrorSource = sourceRecord;
    gameRecord.unityDetected = detectUnityByPaths(paths);
    gameRecord.flashDetected = detectFlashByPaths(paths);
    gameRecord.importInProgress = false;
    gameRecord.importedAt = Date.now();

    await putGame(gameRecord);
    state.gamesById.set(gameId, gameRecord);
    await loadLibrary(gameId);
    log("Imported “" + gameRecord.name + "” from mirror (" + formatBytes(gameRecord.totalBytes) + ").");
    return true;
  } catch (error) {
    await deleteFilesByGameId(gameId).catch(() => {});
    await deleteGameRecord(gameId).catch(() => {});
    state.gamesById.delete(gameId);
    throw error;
  }
}

async function readMirrorResponseBytes(response, onProgress) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (onProgress) onProgress(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (onProgress) onProgress(total);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
