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
// Helpers matching player.js zipSlug formula and saveAlias disambiguation
// ---------------------------------------------------------------------------
function zipSlugFromZipName(zipName) {
  return String(zipName || "")
    .replace(/\.zip$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128) || "game";
}

function sanitizeSaveAliasBase(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[\/\\]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (cleaned) return cleaned;
  const fb = String(fallback || "")
    .replace(/[\/\\]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return fb || "game";
}

function computeGameSaveAliasesMap(gamesIterable) {
  const list = Array.from(gamesIterable || (state && state.gamesById ? state.gamesById.values() : [])).filter(Boolean);
  list.sort((a, b) => {
    const aImp = Number(a.importedAt);
    const bImp = Number(b.importedAt);
    const aValid = Number.isFinite(aImp) && aImp > 0 ? aImp : Number.MAX_SAFE_INTEGER;
    const bValid = Number.isFinite(bImp) && bImp > 0 ? bImp : Number.MAX_SAFE_INTEGER;
    if (aValid !== bValid) return aValid - bValid;
    const aOrd = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
    const bOrd = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const usedLower = new Set();
  const nextSuffixByBase = new Map();
  const aliasById = new Map();

  for (const game of list) {
    const fallback = game.zipName ? zipSlugFromZipName(game.zipName) : (game.id || "game");
    const base = sanitizeSaveAliasBase(game.name, fallback);
    const baseKey = base.toLowerCase();
    let candidate = base;
    if (usedLower.has(baseKey)) {
      let num = nextSuffixByBase.get(baseKey) || 2;
      while (usedLower.has((base + " #" + num).toLowerCase())) {
        num += 1;
      }
      candidate = base + " #" + num;
      nextSuffixByBase.set(baseKey, num + 1);
    } else {
      nextSuffixByBase.set(baseKey, 2);
    }
    usedLower.add(candidate.toLowerCase());
    aliasById.set(game.id, candidate);
  }

  return aliasById;
}

function getGameSaveAlias(game, gamesIterable) {
  if (!game) return "game";
  const map = computeGameSaveAliasesMap(gamesIterable);
  if (game.id && map.has(game.id)) {
    return map.get(game.id);
  }
  const fallback = game.zipName ? zipSlugFromZipName(game.zipName) : (game.id || "game");
  return sanitizeSaveAliasBase(game.name, fallback);
}

function computeUnityEntryDirHash(entryPath, zipSlug) {
  const effectiveEntry = normalizePath(entryPath || "") || ((zipSlug || "game") + "/index.html");
  const docUrl = VFS_ORIGIN + effectiveEntry;
  try {
    const directoryURL = new URL(docUrl);
    directoryURL.search = "";
    directoryURL.hash = "";
    directoryURL.pathname = directoryURL.pathname.substring(0, directoryURL.pathname.lastIndexOf("/") + 1);
    return md5(directoryURL.href.replace(/\/$/, ""));
  } catch (_) {
    const lastSlash = docUrl.lastIndexOf("/");
    const dirHref = lastSlash >= 0 ? docUrl.slice(0, lastSlash) : docUrl.replace(/\/$/, "");
    return md5(dirHref);
  }
}

function computeUnityHash(zipSlug) {
  return md5(VFS_ORIGIN.replace(/\/$/, "") + "/" + zipSlug);
}

function getKnownUnityPrefixesForGame(game, gamesIterable) {
  if (!game) return [];
  const prefixes = new Set();
  const alias = getGameSaveAlias(game, gamesIterable);
  if (alias) prefixes.add(alias);
  if (typeof game.saveAlias === "string" && game.saveAlias.trim()) {
    prefixes.add(game.saveAlias.trim());
  }
  const slug = zipSlugFromZipName(game.zipName || game.name || game.id);
  if (slug) {
    prefixes.add(computeUnityHash(slug));
    prefixes.add(slug);
  }
  if (game.entryPath) {
    prefixes.add(computeUnityEntryDirHash(game.entryPath, slug));
  }
  if (Array.isArray(game.htmlEntries)) {
    for (const entry of game.htmlEntries) {
      if (entry) prefixes.add(computeUnityEntryDirHash(entry, slug));
    }
  }
  return Array.from(prefixes);
}

async function renameIdbfsKeyPrefix(oldPrefixes, newPrefix) {
  const target = String(newPrefix || "").trim();
  if (!target) return 0;
  const sources = (Array.isArray(oldPrefixes) ? oldPrefixes : [oldPrefixes])
    .map((p) => String(p || "").trim())
    .filter((p) => p && p !== target);
  if (!sources.length) return 0;

  let db;
  try {
    db = await openIdbfsDb();
  } catch (e) {
    console.warn("Could not open /idbfs to rename save keys:", e);
    return 0;
  }

  try {
    if (!db.objectStoreNames.contains(IDBFS_STORE)) {
      return 0;
    }
    const allRecords = await readAllRecordsFromStore(db, IDBFS_STORE);
    if (!allRecords.length) {
      return 0;
    }

    const existingKeys = new Set(allRecords.map((r) => String(r.key)));
    const toWrite = [];
    const toDelete = [];

    for (const source of sources) {
      const srcRoot = "/idbfs/" + source;
      const srcSlash = srcRoot + "/";
      const dstRoot = "/idbfs/" + target;
      for (const rec of allRecords) {
        const key = String(rec.key);
        if (key === srcRoot || key.startsWith(srcSlash)) {
          const mappedKey = dstRoot + key.slice(srcRoot.length);
          toWrite.push({ key: mappedKey, value: rec.value });
          if (mappedKey !== key) {
            toDelete.push(key);
          }
        }
      }
    }

    if (!toWrite.length) {
      return 0;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDBFS_STORE, "readwrite");
      const store = tx.objectStore(IDBFS_STORE);
      for (const item of toWrite) {
        store.put(item.value, item.key);
        existingKeys.add(item.key);
      }
      for (const oldKey of toDelete) {
        if (!toWrite.some((w) => w.key === oldKey)) {
          store.delete(oldKey);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("renameIdbfsKeyPrefix aborted"));
    });

    return toWrite.length;
  } catch (e) {
    console.warn("Failed to rename /idbfs keys:", e);
    return 0;
  } finally {
    db.close();
  }
}

async function syncAllGameSaveAliases(options = {}) {
  if (!state || !state.gamesById || !state.gamesById.size) return;
  const migrateIdbfs = options.migrateIdbfs !== false;
  const persistGames = options.persistGames !== false;
  const aliasMap = computeGameSaveAliasesMap(state.gamesById.values());

  for (const [gameId, nextAlias] of aliasMap.entries()) {
    const game = state.gamesById.get(gameId);
    if (!game) continue;
    const prevAlias = typeof game.saveAlias === "string" ? game.saveAlias.trim() : "";
    if (migrateIdbfs) {
      const candidateSources = [];
      if (prevAlias && prevAlias !== nextAlias) {
        candidateSources.push(prevAlias);
      }
      const slug = zipSlugFromZipName(game.zipName || game.name || game.id);
      const legacySlugHash = computeUnityHash(slug);
      const entryDirHash = computeUnityEntryDirHash(game.entryPath, slug);
      if (legacySlugHash && legacySlugHash !== nextAlias) candidateSources.push(legacySlugHash);
      if (entryDirHash && entryDirHash !== nextAlias) candidateSources.push(entryDirHash);
      if (candidateSources.length) {
        await renameIdbfsKeyPrefix(candidateSources, nextAlias);
      }
    }
    if (game.saveAlias !== nextAlias) {
      game.saveAlias = nextAlias;
      state.gamesById.set(gameId, game);
      if (persistGames && state.db && typeof putGame === "function") {
        try {
          await putGame(game);
        } catch (e) {
          console.warn("Could not persist updated saveAlias for game", game.name || gameId, e);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-game IndexedDB namespaces
//
// Godot (and engines we do not know) name their databases after the page URL, so every game
// launched from the same player page would share one database. Each game gets a namespace that
// is written to the game record the first time it launches: renaming a game afterwards does
// nothing to the namespace, so the data stays reachable.
// ---------------------------------------------------------------------------
const IDB_NAMESPACE_SEPARATOR = ":";

function sanitizeIdbNamespaceBase(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function ensureGameIdbNamespace(game) {
  if (!game || !game.id) return "";
  if (typeof game.idbNamespace === "string" && game.idbNamespace.trim()) {
    return game.idbNamespace.trim();
  }
  const alias = (typeof getGameSaveAlias === "function" ? getGameSaveAlias(game) : "")
    || game.name
    || game.zipName
    || game.id;
  const base = sanitizeIdbNamespaceBase(alias) || "game";
  // The id tag keeps two games with the same name apart, and survives renames.
  const idTag = String(game.id).replace(/[^A-Za-z0-9]/g, "").slice(-8) || "0";
  const taken = new Set();
  if (state && state.gamesById && typeof state.gamesById.values === "function") {
    for (const other of state.gamesById.values()) {
      if (other && other.id !== game.id && typeof other.idbNamespace === "string" && other.idbNamespace) {
        taken.add(other.idbNamespace.toLowerCase());
      }
    }
  }
  let candidate = base + " [" + idTag + "]";
  let bump = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = base + " [" + idTag + "-" + bump + "]";
    bump += 1;
  }
  game.idbNamespace = candidate;
  return candidate;
}

// Which game, if any, owns a namespaced database name such as "Same Game [idone]:EM_FS_/x.html".
function findGameByIndexedDbNamespace(dbName) {
  const name = String(dbName || "");
  if (!name || !state || !state.gamesById || typeof state.gamesById.values !== "function") return null;
  for (const game of state.gamesById.values()) {
    const namespace = game && typeof game.idbNamespace === "string" ? game.idbNamespace.trim() : "";
    if (namespace && name.indexOf(namespace + IDB_NAMESPACE_SEPARATOR) === 0) {
      return { game, namespace, logicalName: name.slice(namespace.length + 1) };
    }
  }
  return null;
}

// The database name a game will actually read at launch: namespaced games see every name prefixed.
function resolveGameIdbTargetName(game, logicalName) {
  const logical = String(logicalName || "");
  if (!logical) return "";
  const namespace = game && typeof ensureGameIdbNamespace === "function" ? ensureGameIdbNamespace(game) : "";
  return namespace ? namespace + IDB_NAMESPACE_SEPARATOR + logical : logical;
}

function openIdbForCopy(name, storeDescriptors) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const descriptor of storeDescriptors) {
        if (!db.objectStoreNames.contains(descriptor.name)) {
          db.createObjectStore(descriptor.name, descriptor.keyPath ? { keyPath: descriptor.keyPath } : undefined);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked while preparing " + name));
  });
}

async function copyIdbDatabaseRecords(sourceName, targetName) {
  const source = await openAnyIdb(sourceName);
  const storeNames = Array.from(source.objectStoreNames);
  if (!storeNames.length) {
    source.close();
    return { copied: 0, stores: 0 };
  }
  const descriptors = storeNames.map((storeName) => ({
    name: storeName,
    keyPath: source.transaction(storeName, "readonly").objectStore(storeName).keyPath
  }));
  const snapshot = new Map();
  for (const storeName of storeNames) {
    snapshot.set(storeName, await readAllRecordsFromStore(source, storeName));
  }
  source.close();

  const target = await openIdbForCopy(targetName, descriptors);
  let copied = 0;
  await new Promise((resolve, reject) => {
    const tx = target.transaction(storeNames, "readwrite");
    for (const descriptor of descriptors) {
      const store = tx.objectStore(descriptor.name);
      for (const record of snapshot.get(descriptor.name) || []) {
        if (descriptor.keyPath) {
          store.put(record.value);
        } else {
          store.put(record.value, record.key);
        }
        copied += 1;
      }
    }
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("IndexedDB copy aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB copy failed"));
  });
  target.close();
  return { copied, stores: storeNames.length };
}

// One-time carry-over of Emscripten/Godot databases written before namespacing existed.
// Records are copied, never moved, so a failed or partial copy cannot destroy anything.
async function migrateLegacyGodotIdbIntoGame(game) {
  if (!game || !game.idbNamespace) return { migrated: [] };
  if (game.idbNamespaceMigrated) return { migrated: [], skipped: true };
  let names = [];
  try {
    names = (await indexedDB.databases()).map((entry) => entry && entry.name).filter(Boolean);
  } catch (_) {
    names = [];
  }
  // Only engine-native names: namespaced databases already carry the separator prefix.
  const legacyNames = names.filter((name) => /^EM_FS_/i.test(name) && name.indexOf(IDB_NAMESPACE_SEPARATOR) !== 0);
  const migrated = [];
  for (const name of legacyNames) {
    const targetName = game.idbNamespace + IDB_NAMESPACE_SEPARATOR + name;
    if (names.includes(targetName)) {
      continue;
    }
    try {
      const result = await copyIdbDatabaseRecords(name, targetName);
      if (result && result.copied) migrated.push(name);
    } catch (error) {
      console.warn("Could not carry over IndexedDB " + name, error);
      return { migrated };
    }
  }
  game.idbNamespaceMigrated = true;
  return { migrated };
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
        // Unity IDBFS — group records by /idbfs/<prefix> (either saveAlias or 32-char MD5 hash)
        if (!db.objectStoreNames.contains(IDBFS_STORE)) {
          db.close();
          continue;
        }
        const allRecords = await readAllRecordsFromStore(db, IDBFS_STORE);
        db.close();

        const byPrefix = new Map();
        for (const rec of allRecords) {
          const m = String(rec.key).match(/^\/idbfs\/([^/]+)(?:\/|$)/);
          if (!m) continue;
          const prefix = m[1];
          if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
          byPrefix.get(prefix).push(rec);
        }

        const prefixToGame = new Map();
        for (const game of state.gamesById.values()) {
          const knownPrefixes = getKnownUnityPrefixesForGame(game, state.gamesById.values());
          for (const p of knownPrefixes) {
            if (p && !prefixToGame.has(p)) {
              prefixToGame.set(p, game);
            }
            if (p && !prefixToGame.has(p.toLowerCase())) {
              prefixToGame.set(p.toLowerCase(), game);
            }
          }
        }

        const usedFileSlugs = new Set();
        for (const [prefix, records] of byPrefix) {
          const matchedGame = prefixToGame.get(prefix) || prefixToGame.get(prefix.toLowerCase()) || null;
          const saveAlias = matchedGame ? getGameSaveAlias(matchedGame) : prefix;
          const gameName = matchedGame ? String(matchedGame.name || "") : "";
          const rawSlug = matchedGame && matchedGame.zipName
            ? zipSlugFromZipName(matchedGame.zipName)
            : (matchedGame ? zipSlugFromZipName(saveAlias) : (/^[a-f0-9]{32}$/i.test(prefix) ? ("unknown-" + prefix.slice(0, 8)) : prefix));
          let fileSlug = zipSlugFromZipName(saveAlias || rawSlug);
          if (usedFileSlugs.has(fileSlug.toLowerCase())) {
            let n = 2;
            while (usedFileSlugs.has((fileSlug + "_" + n).toLowerCase())) n += 1;
            fileSlug = fileSlug + "_" + n;
          }
          usedFileSlugs.add(fileSlug.toLowerCase());

          const serialized = records.map((r) => ({ key: serializeValue(r.key), value: serializeValue(r.value) }));
          manifest.games.push({
            zipSlug: fileSlug,
            saveAlias,
            gameName: gameName || saveAlias,
            hash: prefix,
            fileCount: records.length
          });
          zipEntries.push({
            path: "idbfs/" + fileSlug + ".json",
            bytes: new TextEncoder().encode(JSON.stringify(serialized))
          });
        }
      } else {
        // Any other database — export every store. Games with an IndexedDB namespace are recorded
        // with their logical (unprefixed) name plus the owning game, so an import can put the
        // records back under the target game's namespace instead of a stale one.
        const storeNames = [...db.objectStoreNames];
        const owner = findGameByIndexedDbNamespace(dbName);
        const dbMeta = {
          dbName,
          logicalDbName: owner ? owner.logicalName : dbName,
          gameId: owner ? String(owner.game.id || "") : "",
          gameName: owner ? String(owner.game.name || "") : "",
          stores: []
        };

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
    a.download = "save-data-" + date + ".data";
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
    clearWorkProgress();
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
    const dbEntry = {
      dbName: dbMeta.dbName,
      logicalDbName: typeof dbMeta.logicalDbName === "string" ? dbMeta.logicalDbName : "",
      gameId: typeof dbMeta.gameId === "string" ? dbMeta.gameId : "",
      gameName: typeof dbMeta.gameName === "string" ? dbMeta.gameName : "",
      stores: []
    };
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
      let targetPrefixSegment = String(entry.sourceHash || "").trim();
      let legacyFallbackSegment = "";
      if (entry.action.startsWith("auto:") || entry.action.startsWith("map:")) {
        const gameId = entry.action.split(":")[1];
        const game = state.gamesById.get(gameId);
        if (game) {
          targetPrefixSegment = getGameSaveAlias(game);
          const slug = zipSlugFromZipName(game.zipName || game.name || game.id);
          legacyFallbackSegment = computeUnityEntryDirHash(game.entryPath, slug);
        }
      }
      const sourceRoot = "/idbfs/" + entry.sourceHash;
      const sourcePrefix = sourceRoot + "/";
      const targetRoot = "/idbfs/" + targetPrefixSegment;
      const targetPrefix = targetRoot + "/";
      // Write imported records. Do NOT clear existing keys. When a
      // `/PlayerPrefs` file is imported, also ensure a sibling parent entry
      // exists (same timestamp/mode but no contents) so Unity won't recreate
      // it. We attempt to create the parent only if it does not already exist.
      // Read existing keys first to know whether parent entries already exist.
      const existing = await readAllRecordsFromStore(db, IDBFS_STORE);
      const existingKeys = new Set(existing.map((r) => String(r.key)));

      const mapKeyToSegment = (rawKey, segment) => {
        const key = String(rawKey);
        if (key === sourceRoot) return "/idbfs/" + segment;
        if (key.startsWith(sourcePrefix)) return "/idbfs/" + segment + "/" + key.slice(sourcePrefix.length);
        const genericMatch = key.match(/^\/idbfs\/[^/]+(\/.*)?$/);
        if (genericMatch) return "/idbfs/" + segment + (genericMatch[1] || "");
        return key;
      };

      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDBFS_STORE, "readwrite");
        const store = tx.objectStore(IDBFS_STORE);
        const recs = Array.from(entry.records || []);
        // write parents before children by sorting by key length
        recs.sort((a, b) => {
          const ka = mapKeyToSegment(a.key, targetPrefixSegment);
          const kb = mapKeyToSegment(b.key, targetPrefixSegment);
          return ka.length - kb.length;
        });
        const targetSegments = [targetPrefixSegment];
        if (legacyFallbackSegment && legacyFallbackSegment !== targetPrefixSegment) {
          targetSegments.push(legacyFallbackSegment);
        }
        for (const segment of targetSegments) {
          for (const rec of recs) {
            const targetKey = mapKeyToSegment(rec.key, segment);
            const val = deserializeValue(rec.value);
            store.put(val, targetKey);

            // If this is a PlayerPrefs file, also ensure a parent metadata
            // entry exists at the containing path (without contents).
            if (targetKey.endsWith("/PlayerPrefs")) {
              const parentKey = targetKey.slice(0, targetKey.lastIndexOf("/PlayerPrefs"));
              if (!existingKeys.has(parentKey)) {
                const parentVal = {};
                if (val && typeof val === "object") {
                  if (val.timestamp) {
                    // Ensure timestamp is a Date instance (not a string/number)
                    try {
                      parentVal.timestamp = (val.timestamp instanceof Date)
                        ? new Date(val.timestamp.getTime())
                        : new Date(val.timestamp);
                    } catch (e) {
                      parentVal.timestamp = new Date();
                    }
                  } else {
                    parentVal.timestamp = new Date();
                  }
                } else {
                  parentVal.timestamp = new Date();
                }
                // Parent should be a directory-like entry — use directory mode 16877
                parentVal.mode = 16877;
                try { store.put(parentVal, parentKey); } catch (e) { /* ignore */ }
                existingKeys.add(parentKey);
              }
            }
          }
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
    // Map the exported database onto the target game's namespace when a game was chosen, so a save
    // still lands where the game reads after a rename or a re-import under a new game id.
    let targetDbName = String(dbEntry.dbName || "");
    const action = String(dbEntry.action || "");
    if (action.startsWith("auto:") || action.startsWith("map:")) {
      const targetGame = state.gamesById.get(action.split(":")[1]);
      if (targetGame) {
        const logicalName = dbEntry.logicalDbName || dbEntry.dbName;
        const previousNamespace = targetGame.idbNamespace;
        const mappedName = resolveGameIdbTargetName(targetGame, logicalName);
        if (mappedName) {
          targetDbName = mappedName;
        }
        if (targetGame.idbNamespace && targetGame.idbNamespace !== previousNamespace && typeof putGame === "function") {
          try {
            await putGame(targetGame);
          } catch (error) {
            console.warn("Could not persist the IndexedDB namespace for", targetGame.name || targetGame.id, error);
          }
        }
        if (targetDbName !== dbEntry.dbName) {
          log("Saved browser storage into " + targetDbName + ".");
        }
      }
    }
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(targetDbName);
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
      console.error("Could not open IDB for restore:", targetDbName, e);
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
      const message = "No save data found in this ZIP.";
      log(message, "error");
      openWrongZipTypeModal(message, "Save Import Failed");
      return;
    }
    openSaveImportModal(parsed);
  } catch (err) {
    console.error(err);
    const msg = err.message || String(err);
    if (isQuotaExceededError(err)) {
      const quotaMsg = "Storage Quota Exceeded: Your browser storage is full. Please delete some existing games or free up browser disk space before importing save data.";
      log("Save import failed: Storage quota exceeded.", "error");
      openWrongZipTypeModal(quotaMsg, "Storage Quota Exceeded");
    } else if (msg.startsWith("This looks like")) {
      openWrongZipTypeModal(msg);
    } else {
      log("Could not read save ZIP: " + msg, "error");
      openWrongZipTypeModal(msg, "Save Import Failed");
    }
  } finally {
    setActionButtonsDisabled(false);
    clearWorkProgress();
  }
}
