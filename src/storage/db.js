"use strict";

const GAME_METADATA_BACKUP_KEY = "cbgamesOfflineZipDB.gameMetadataBackup.v1";

function readGameMetadataBackup() {
    try {
      const raw = localStorage.getItem(GAME_METADATA_BACKUP_KEY);
      if (!raw) {
        return [];
      }
      const backup = JSON.parse(raw);
      if (!backup || backup.version !== 1 || !Array.isArray(backup.games)) {
        return [];
      }
      return backup.games.filter(isValidGameMetadataRecord);
    } catch {
      return [];
    }
  }

function isValidGameMetadataRecord(game) {
    return Boolean(
      game &&
      typeof game === "object" &&
      !Array.isArray(game) &&
      typeof game.id === "string" &&
      game.id.length > 0 &&
      typeof game.name === "string"
    );
  }

function gameMetadataWithoutThumbnail(game) {
    const { thumbnailDataUrl, ...metadata } = game;
    return metadata;
  }

function writeGameMetadataBackup(games) {
    try {
      const backup = {
        version: 1,
        games: games.filter(isValidGameMetadataRecord).map(gameMetadataWithoutThumbnail)
      };
      localStorage.setItem(GAME_METADATA_BACKUP_KEY, JSON.stringify(backup));
    } catch (error) {
      // The IndexedDB library remains authoritative during normal operation.
      // In particular, never let a full localStorage quota block game imports.
      console.warn("Could not update the game metadata backup in localStorage.", error);
    }
  }

function updateGameMetadataBackup(gameRecord) {
    if (!isValidGameMetadataRecord(gameRecord)) {
      return;
    }
    const games = new Map(readGameMetadataBackup().map((game) => [game.id, game]));
    games.set(gameRecord.id, gameMetadataWithoutThumbnail(gameRecord));
    writeGameMetadataBackup(Array.from(games.values()));
  }

function removeGameFromMetadataBackup(gameId) {
    try {
      const games = readGameMetadataBackup().filter((game) => game.id !== gameId);
      localStorage.setItem(GAME_METADATA_BACKUP_KEY, JSON.stringify({ version: 1, games }));
    } catch (error) {
      // A stale backup could otherwise resurrect a deliberately deleted game.
      try {
        localStorage.removeItem(GAME_METADATA_BACKUP_KEY);
      } catch {
        // Ignore unavailable localStorage.
      }
      console.warn("Could not remove deleted game from the localStorage metadata backup.", error);
    }
  }

function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }

function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_GAMES)) {
          db.createObjectStore(STORE_GAMES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          const filesStore = db.createObjectStore(STORE_FILES, { keyPath: ["gameId", "path"] });
          filesStore.createIndex("gameId", "gameId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
        if (!db.objectStoreNames.contains(STORE_ERROR_LOGS)) {
          const errorLogsStore = db.createObjectStore(STORE_ERROR_LOGS, { keyPath: "id" });
          errorLogsStore.createIndex("timestamp", "timestamp", { unique: false });
          errorLogsStore.createIndex("gameId", "gameId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

async function reopenDatabaseConnection() {
    if (state.db) {
      try {
        state.db.close();
      } catch {
        // ignore close errors
      }
    }
    state.db = await openDatabase();
  }

async function putGame(gameRecord) {
    const tx = state.db.transaction(STORE_GAMES, "readwrite");
    tx.objectStore(STORE_GAMES).put(gameRecord);
    await txDone(tx);
    updateGameMetadataBackup(gameRecord);
  }

async function deleteGameRecord(gameId) {
    const tx = state.db.transaction(STORE_GAMES, "readwrite");
    tx.objectStore(STORE_GAMES).delete(gameId);
    await txDone(tx);
    removeGameFromMetadataBackup(gameId);
  }

function readAllGameRecords() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_GAMES, "readonly");
      const request = tx.objectStore(STORE_GAMES).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

async function replaceAllGameRecords(games) {
    const tx = state.db.transaction(STORE_GAMES, "readwrite");
    const store = tx.objectStore(STORE_GAMES);
    store.clear();
    for (const game of games) {
      store.put(game);
    }
    await txDone(tx);
  }

async function getAllGames() {
    const backupGames = readGameMetadataBackup();
    let storedGames;
    try {
      storedGames = await readAllGameRecords();
    } catch (error) {
      console.warn(
        backupGames.length
          ? "Could not read game metadata from IndexedDB; restoring the localStorage backup."
          : "Could not read game metadata from IndexedDB; clearing the corrupted game metadata store.",
        error
      );
      await replaceAllGameRecords(backupGames);
      for (const game of backupGames) {
        if (!game.thumbnailDataUrl) {
          state.metadataRestoredGameIds.add(game.id);
        }
      }
      return backupGames;
    }

    const validGames = storedGames.filter(isValidGameMetadataRecord);
    const gamesById = new Map(validGames.map((game) => [game.id, game]));
    let needsRepair = validGames.length !== storedGames.length;
    for (const backupGame of backupGames) {
      if (!gamesById.has(backupGame.id)) {
        gamesById.set(backupGame.id, backupGame);
        needsRepair = true;
      }
    }

    const games = Array.from(gamesById.values());
    if (needsRepair) {
      console.warn("Repairing missing or invalid game metadata in IndexedDB.");
      await replaceAllGameRecords(games);
      for (const game of backupGames) {
        if (gamesById.get(game.id) === game && !game.thumbnailDataUrl) {
          state.metadataRestoredGameIds.add(game.id);
        }
      }
    }
    writeGameMetadataBackup(games);
    return games;
  }

function putFileRecord(record) {
    const tx = state.db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).put(record);
    return txDone(tx);
  }

function deleteFileRecord(gameId, path) {
    const tx = state.db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).delete([gameId, normalizePath(path)]);
    return txDone(tx);
  }

function putErrorLogRecord(record) {
    const tx = state.db.transaction(STORE_ERROR_LOGS, "readwrite");
    tx.objectStore(STORE_ERROR_LOGS).put(record);
    return txDone(tx);
  }

function getAllErrorLogRecords() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_ERROR_LOGS, "readonly");
      const request = tx.objectStore(STORE_ERROR_LOGS).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

function getAllFilesForGame(gameId) {
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = state.db.transaction(STORE_FILES, "readonly");
      const index = tx.objectStore(STORE_FILES).index("gameId");
      const request = index.openCursor(IDBKeyRange.only(gameId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          return;
        }
        out.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(out);
      tx.onabort = () => reject(tx.error || new Error("Failed to read files"));
    });
  }

function deleteFilesByGameId(gameId) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_FILES, "readwrite");
      const index = tx.objectStore(STORE_FILES).index("gameId");
      const request = index.openCursor(IDBKeyRange.only(gameId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Failed to delete files"));
    });
  }

function detectFlashFromStoredFiles(gameId) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_FILES, "readonly");
      const index = tx.objectStore(STORE_FILES).index("gameId");
      const request = index.openCursor(IDBKeyRange.only(gameId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(false);
          return;
        }
        const primaryKey = cursor.primaryKey;
        const pathFromKey = Array.isArray(primaryKey) ? primaryKey[1] : "";
        const path = normalizePath(pathFromKey || (cursor.value && cursor.value.path ? cursor.value.path : ""));
        if (/(^|\/)[^/]+\.swf$/i.test(path)) {
          resolve(true);
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

async function processFilesForGameInBatches(gameId, batchSize, onBatch) {
    return new Promise((resolve, reject) => {
      const batch = [];
      const tx = state.db.transaction(STORE_FILES, "readonly");
      const index = tx.objectStore(STORE_FILES).index("gameId");
      const request = index.openCursor(IDBKeyRange.only(gameId));
      
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          batch.push(cursor.value);
          if (batch.length >= batchSize) {
            await onBatch(batch.splice(0));
          }
          cursor.continue();
        }
      };
      
      tx.oncomplete = async () => {
        if (batch.length > 0) {
          await onBatch(batch);
        }
        resolve();
      };
      
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }

async function detectUnityFromStoredFiles(gameId) {
    const files = await getAllFilesForGame(gameId);
    const paths = files.map((file) => normalizePath(file.path || ""));
    if (detectUnityByPaths(paths)) {
      return true;
    }
    for (const file of files) {
      const path = normalizePath(file.path || "");
      if (!/\.html?$/i.test(path)) {
        continue;
      }
      try {
        const htmlText = await file.blob.text();
        if (detectUnityByHtmlText(htmlText)) {
          return true;
        }
      } catch {
        // ignore parse errors
      } finally {
        // Release blob reference after processing
        file.blob = null;
      }
    }
    return false;
  }
