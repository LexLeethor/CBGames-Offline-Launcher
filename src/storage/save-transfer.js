"use strict";

// ---------------------------------------------------------------------------
// Tiny self-contained MD5 (RFC 1321). No external deps.
// ---------------------------------------------------------------------------
function md5(str) {
  function safeAdd(x, y) { const l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5blks(s) {
    const nblk = ((s.length + 8) >> 6) + 1;
    const blks = new Array(nblk * 16).fill(0);
    for (let i = 0; i < s.length; i++) blks[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    blks[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    blks[nblk * 16 - 2] = s.length * 8;
    return blks;
  }
  function md5core(x) {
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const [oa, ob, oc, od] = [a, b, c, d];
      a = md5ff(a,b,c,d,x[i],7,-680876936); d = md5ff(d,a,b,c,x[i+1],12,-389564586); c = md5ff(c,d,a,b,x[i+2],17,606105819); b = md5ff(b,c,d,a,x[i+3],22,-1044525330);
      a = md5ff(a,b,c,d,x[i+4],7,-176418897); d = md5ff(d,a,b,c,x[i+5],12,1200080426); c = md5ff(c,d,a,b,x[i+6],17,-1473231341); b = md5ff(b,c,d,a,x[i+7],22,-45705983);
      a = md5ff(a,b,c,d,x[i+8],7,1770035416); d = md5ff(d,a,b,c,x[i+9],12,-1958414417); c = md5ff(c,d,a,b,x[i+10],17,-42063); b = md5ff(b,c,d,a,x[i+11],22,-1990404162);
      a = md5ff(a,b,c,d,x[i+12],7,1804603682); d = md5ff(d,a,b,c,x[i+13],12,-40341101); c = md5ff(c,d,a,b,x[i+14],17,-1502002290); b = md5ff(b,c,d,a,x[i+15],22,1236535329);
      a = md5gg(a,b,c,d,x[i+1],5,-165796510); d = md5gg(d,a,b,c,x[i+6],9,-1069501632); c = md5gg(c,d,a,b,x[i+11],14,643717713); b = md5gg(b,c,d,a,x[i],20,-373897302);
      a = md5gg(a,b,c,d,x[i+5],5,-701558691); d = md5gg(d,a,b,c,x[i+10],9,38016083); c = md5gg(c,d,a,b,x[i+15],14,-660478335); b = md5gg(b,c,d,a,x[i+4],20,-405537848);
      a = md5gg(a,b,c,d,x[i+9],5,568446438); d = md5gg(d,a,b,c,x[i+14],9,-1019803690); c = md5gg(c,d,a,b,x[i+3],14,-187363961); b = md5gg(b,c,d,a,x[i+8],20,1163531501);
      a = md5gg(a,b,c,d,x[i+13],5,-1444681467); d = md5gg(d,a,b,c,x[i+2],9,-51403784); c = md5gg(c,d,a,b,x[i+7],14,1735328473); b = md5gg(b,c,d,a,x[i+12],20,-1926607734);
      a = md5hh(a,b,c,d,x[i+5],4,-378558); d = md5hh(d,a,b,c,x[i+8],11,-2022574463); c = md5hh(c,d,a,b,x[i+11],16,1839030562); b = md5hh(b,c,d,a,x[i+14],23,-35309556);
      a = md5hh(a,b,c,d,x[i+1],4,-1530992060); d = md5hh(d,a,b,c,x[i+4],11,1272893353); c = md5hh(c,d,a,b,x[i+7],16,-155497632); b = md5hh(b,c,d,a,x[i+10],23,-1094730640);
      a = md5hh(a,b,c,d,x[i+13],4,681279174); d = md5hh(d,a,b,c,x[i],11,-358537222); c = md5hh(c,d,a,b,x[i+3],16,-722521979); b = md5hh(b,c,d,a,x[i+6],23,76029189);
      a = md5hh(a,b,c,d,x[i+9],4,-640364487); d = md5hh(d,a,b,c,x[i+12],11,-421815835); c = md5hh(c,d,a,b,x[i+15],16,530742520); b = md5hh(b,c,d,a,x[i+2],23,-995338651);
      a = md5ii(a,b,c,d,x[i],6,-198630844); d = md5ii(d,a,b,c,x[i+7],10,1126891415); c = md5ii(c,d,a,b,x[i+14],15,-1416354905); b = md5ii(b,c,d,a,x[i+5],21,-57434055);
      a = md5ii(a,b,c,d,x[i+12],6,1700485571); d = md5ii(d,a,b,c,x[i+3],10,-1894986606); c = md5ii(c,d,a,b,x[i+10],15,-1051523); b = md5ii(b,c,d,a,x[i+1],21,-2054922799);
      a = md5ii(a,b,c,d,x[i+8],6,1873313359); d = md5ii(d,a,b,c,x[i+15],10,-30611744); c = md5ii(c,d,a,b,x[i+6],15,-1560198380); b = md5ii(b,c,d,a,x[i+13],21,1309151649);
      a = md5ii(a,b,c,d,x[i+4],6,-145523070); d = md5ii(d,a,b,c,x[i+11],10,-1120210379); c = md5ii(c,d,a,b,x[i+2],15,718787259); b = md5ii(b,c,d,a,x[i+9],21,-343485551);
      a = safeAdd(a,oa); b = safeAdd(b,ob); c = safeAdd(c,oc); d = safeAdd(d,od);
    }
    return [a, b, c, d];
  }
  function rhex(n) { let s = ""; for (let i = 0; i < 4; i++) s += ("0" + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2); return s; }
  const blks = md5blks(unescape(encodeURIComponent(str)));
  return md5core(blks).map(rhex).join("");
}

// ---------------------------------------------------------------------------
// Helpers matching player.js zipSlug formula exactly
// ---------------------------------------------------------------------------
function zipSlugFromZipName(zipName) {
  return String(zipName || "")
    .replace(/\.zip$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128) || "game";
}

function computeUnityHash(zipSlug) {
  return md5(VFS_ORIGIN.replace(/\/$/, "") + "/" + zipSlug);
}

// ---------------------------------------------------------------------------
// IDB constants and exclusion list
// ---------------------------------------------------------------------------
const IDBFS_DB_NAME = "/idbfs";
const IDBFS_STORE = "FILE_DATA";

// Databases we never export: the launcher's own game library, Unity's asset
// cache (large, device-specific, not save data).
const EXCLUDED_IDB_NAMES = new Set([
  "cbgamesOfflineZipDB",
  "UnityCache",
  "/UnityCache"
]);

// ---------------------------------------------------------------------------
// IDB helpers
// ---------------------------------------------------------------------------
function openAnyIdb(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openIdbfsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDBFS_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(IDBFS_STORE)) {
        e.target.result.createObjectStore(IDBFS_STORE);
      }
    };
  });
}

function readAllRecordsFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const records = [];
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      records.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(records);
    tx.onabort = () => reject(tx.error || new Error("readAllRecordsFromStore aborted"));
  });
}

// ---------------------------------------------------------------------------
// Value serialization — handles Uint8Array / ArrayBuffer as { __b64__: "..." }
// and recurses into plain objects.
// ---------------------------------------------------------------------------
function serializeValue(value) {
  // Date — must come before the generic object check since Date is an object
  // with no own enumerable keys, so Object.keys(date) === [] → would become {}
  if (value instanceof Date) {
    return { __date__: value.toISOString() };
  }
  // Use ArrayBuffer.isView to catch all typed arrays across realms (Uint8Array,
  // Int8Array, etc.) — instanceof Uint8Array fails for cross-realm typed arrays
  // such as those read from IndexedDB that were originally created in a popup window.
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { __b64__: btoa(bin) };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { __b64__: btoa(bin) };
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = serializeValue(value[k]);
    return out;
  }
  return value;
}

function deserializeValue(value) {
  if (value && typeof value === "object" && "__date__" in value) {
    return new Date(value.__date__);
  }
  if (value && typeof value === "object" && "__b64__" in value) {
    const bin = atob(value.__b64__);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deserializeValue(value[k]);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
async function exportSaveData() {
  setActionButtonsDisabled(true);
  try {
    log("Exporting save data…");

    const zipEntries = [];
    const manifest = {
      version: "cbgames-save-v2",
      exportedAt: Date.now(),
      games: [],
      hasLocalStorage: false,
      databases: []
    };

    // 1. localStorage
    const lsData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      lsData[k] = localStorage.getItem(k);
    }
    if (Object.keys(lsData).length > 0) {
      manifest.hasLocalStorage = true;
      zipEntries.push({
        path: "localstorage.json",
        bytes: new TextEncoder().encode(JSON.stringify(lsData))
      });
    }

    // 2. Enumerate all IndexedDB databases
    let allDbs = [];
    try {
      allDbs = await indexedDB.databases();
    } catch (_) {
      // Safari / older browsers don't support databases() — fall back to /idbfs only
      allDbs = [{ name: IDBFS_DB_NAME }];
    }

    for (const dbInfo of allDbs) {
      const dbName = dbInfo.name;
      if (!dbName || EXCLUDED_IDB_NAMES.has(dbName)) continue;

      let db;
      try {
        db = await openAnyIdb(dbName);
      } catch (e) {
        console.warn("Could not open IDB for export:", dbName, e);
        continue;
      }

      if (dbName === IDBFS_DB_NAME) {
        // Unity IDBFS — group records by hash prefix and map to zip slugs
        if (!db.objectStoreNames.contains(IDBFS_STORE)) {
          db.close();
          continue;
        }
        const allRecords = await readAllRecordsFromStore(db, IDBFS_STORE);
        db.close();

        const byHash = new Map();
        for (const rec of allRecords) {
          const m = String(rec.key).match(/^\/idbfs\/([a-f0-9]{32})\//);
          if (!m) continue;
          if (!byHash.has(m[1])) byHash.set(m[1], []);
          byHash.get(m[1]).push(rec);
        }

        const hashToSlug = new Map();
        for (const game of state.gamesById.values()) {
          if (!game.zipName) continue;
          const slug = zipSlugFromZipName(game.zipName);
          hashToSlug.set(computeUnityHash(slug), slug);
        }

        for (const [hash, records] of byHash) {
          const slug = hashToSlug.get(hash) || ("unknown-" + hash.slice(0, 8));
          const serialized = records.map((r) => ({ key: serializeValue(r.key), value: serializeValue(r.value) }));
          manifest.games.push({ zipSlug: slug, hash, fileCount: records.length });
          zipEntries.push({
            path: "idbfs/" + slug + ".json",
            bytes: new TextEncoder().encode(JSON.stringify(serialized))
          });
        }
      } else {
        // Any other database — export every store
        const storeNames = [...db.objectStoreNames];
        const dbMeta = { dbName, stores: [] };

        for (const storeName of storeNames) {
          try {
            const records = await readAllRecordsFromStore(db, storeName);
            if (!records.length) continue;
            const serialized = records.map((r) => ({ key: serializeValue(r.key), value: serializeValue(r.value) }));
            dbMeta.stores.push({ storeName, recordCount: records.length });
            zipEntries.push({
              path: "idb/" + encodeURIComponent(dbName) + "/" + encodeURIComponent(storeName) + ".json",
              bytes: new TextEncoder().encode(JSON.stringify(serialized))
            });
          } catch (e) {
            console.warn("Could not read store", storeName, "from", dbName, e);
          }
        }
        db.close();
        if (dbMeta.stores.length) manifest.databases.push(dbMeta);
      }
    }

    const hasAny = manifest.hasLocalStorage || manifest.games.length || manifest.databases.length;
    if (!hasAny) {
      log("No save data found to export.", "error");
      return;
    }

    zipEntries.unshift({
      path: "manifest.json",
      bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    });

    const blob = createZipStoreArchive(zipEntries);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "save-data-" + date + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

    const parts = [];
    if (manifest.hasLocalStorage) parts.push("localStorage");
    if (manifest.games.length) parts.push(manifest.games.length + " Unity game(s)");
    if (manifest.databases.length) parts.push(manifest.databases.length + " other DB(s)");
    log("Exported: " + parts.join(", ") + ".");

  } catch (err) {
    console.error(err);
    log("Export failed: " + (err.message || String(err)), "error");
  } finally {
    setActionButtonsDisabled(false);
  }
}

// ---------------------------------------------------------------------------
// Parse a save ZIP (supports v1 and v2)
// ---------------------------------------------------------------------------
async function parseSaveZip(file) {
  const arrayBuffer = await readFileArrayBufferWithProgress(file, "Reading save ZIP");
  const zip = await parseZipArchive(arrayBuffer);
  if (!zip) throw new Error("Could not parse save ZIP.");

  const entryByPath = new Map(zip.entries.map((e) => [e.path, e]));

  const manifestEntry = entryByPath.get("manifest.json");
  if (!manifestEntry) {
    if (entryByPath.has("bundle.json")) {
      throw new Error("This looks like a Bundle ZIP. Use 'Import Bundle' to import it.");
    }
    const hasHtml = [...entryByPath.keys()].some((p) => /\.html?$/i.test(p));
    if (hasHtml) {
      throw new Error("This looks like a Game ZIP. Use 'Import Game' to import it.");
    }
    throw new Error("No manifest.json found — is this a save data ZIP?");
  }

  const manifestBytes = await extractEntryBytes(zip, manifestEntry);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));

  if (manifest.version !== "cbgames-save-v1" && manifest.version !== "cbgames-save-v2") {
    throw new Error("Unsupported save ZIP version: " + manifest.version);
  }

  // Unity /idbfs games
  const gameEntries = new Map();
  for (const gameMeta of (manifest.games || [])) {
    const slug = String(gameMeta.zipSlug || "");
    const jsonEntry = entryByPath.get("idbfs/" + slug + ".json");
    if (!jsonEntry) continue;
    const jsonBytes = await extractEntryBytes(zip, jsonEntry);
    const records = JSON.parse(new TextDecoder().decode(jsonBytes));
    gameEntries.set(slug, { ...gameMeta, records });
  }

  // localStorage (v2)
  let localStorageData = null;
  if (manifest.hasLocalStorage) {
    const lsEntry = entryByPath.get("localstorage.json");
    if (lsEntry) {
      const lsBytes = await extractEntryBytes(zip, lsEntry);
      localStorageData = JSON.parse(new TextDecoder().decode(lsBytes));
    }
  }

  // Other IDBs (v2)
  const otherDbs = [];
  for (const dbMeta of (manifest.databases || [])) {
    const dbEntry = { dbName: dbMeta.dbName, stores: [] };
    for (const storeMeta of (dbMeta.stores || [])) {
      const jsonEntry = entryByPath.get(
        "idb/" + encodeURIComponent(dbMeta.dbName) + "/" + encodeURIComponent(storeMeta.storeName) + ".json"
      );
      if (!jsonEntry) continue;
      const jsonBytes = await extractEntryBytes(zip, jsonEntry);
      const records = JSON.parse(new TextDecoder().decode(jsonBytes));
      dbEntry.stores.push({ storeName: storeMeta.storeName, records });
    }
    if (dbEntry.stores.length) otherDbs.push(dbEntry);
  }

  return { manifest, gameEntries, localStorageData, otherDbs };
}

// ---------------------------------------------------------------------------
// Apply import plan
// plan: { localStorageAction, localStorageData, unityGames, otherDbs }
// ---------------------------------------------------------------------------
async function applySaveImport(plan) {
  // Restore localStorage
  if (plan.localStorageAction === "import" && plan.localStorageData) {
    for (const [key, value] of Object.entries(plan.localStorageData)) {
      try { localStorage.setItem(key, String(value)); } catch (_) { /* quota */ }
    }
  }

  // Restore Unity /idbfs
  if (plan.unityGames && plan.unityGames.length) {
    const db = await openIdbfsDb();
    for (const entry of plan.unityGames) {
      if (entry.action === "ignore") continue;
      let targetHash = entry.sourceHash;
      if (entry.action.startsWith("auto:") || entry.action.startsWith("map:")) {
        const gameId = entry.action.split(":")[1];
        const game = state.gamesById.get(gameId);
        if (game && game.zipName) {
          targetHash = computeUnityHash(zipSlugFromZipName(game.zipName));
        }
      }
      const sourcePrefix = "/idbfs/" + entry.sourceHash + "/";
      const targetPrefix = "/idbfs/" + targetHash + "/";
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDBFS_STORE, "readwrite");
        const store = tx.objectStore(IDBFS_STORE);
        for (const rec of entry.records) {
          const key = String(rec.key);
          const targetKey = key.startsWith(sourcePrefix)
            ? targetPrefix + key.slice(sourcePrefix.length)
            : key;
          store.put(deserializeValue(rec.value), targetKey);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("write aborted"));
      });
    }
    db.close();
  }

  // Restore other IDBs
  for (const dbEntry of (plan.otherDbs || [])) {
    if (dbEntry.action === "ignore") continue;
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbEntry.dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
          for (const st of dbEntry.stores) {
            if (!e.target.result.objectStoreNames.contains(st.storeName)) {
              e.target.result.createObjectStore(st.storeName);
            }
          }
        };
      });
    } catch (e) {
      console.error("Could not open IDB for restore:", dbEntry.dbName, e);
      continue;
    }
    for (const storeEntry of dbEntry.stores) {
      if (!db.objectStoreNames.contains(storeEntry.storeName)) continue;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeEntry.storeName, "readwrite");
        const store = tx.objectStore(storeEntry.storeName);
        for (const rec of storeEntry.records) {
          store.put(deserializeValue(rec.value), deserializeValue(rec.key));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("write aborted"));
      });
    }
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point: triggered when user picks a save ZIP file
// ---------------------------------------------------------------------------
async function handleSaveImportFile(file) {
  if (!file) return;
  setActionButtonsDisabled(true);
  try {
    log("Reading save ZIP…");
    const parsed = await parseSaveZip(file);
    const hasContent = parsed.gameEntries.size > 0
      || parsed.localStorageData !== null
      || parsed.otherDbs.length > 0;
    if (!hasContent) {
      log("No save data found in this ZIP.", "error");
      return;
    }
    openSaveImportModal(parsed);
  } catch (err) {
    console.error(err);
    const msg = err.message || String(err);
    if (msg.startsWith("This looks like")) {
      openWrongZipTypeModal(msg);
    } else {
      log("Could not read save ZIP: " + msg, "error");
    }
  } finally {
    setActionButtonsDisabled(false);
    clearWorkProgress();
  }
}
