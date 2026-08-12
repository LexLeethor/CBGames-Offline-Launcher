"use strict";
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

function putGame(gameRecord) {
    const tx = state.db.transaction(STORE_GAMES, "readwrite");
    tx.objectStore(STORE_GAMES).put(gameRecord);
    return txDone(tx);
  }

function deleteGameRecord(gameId) {
    const tx = state.db.transaction(STORE_GAMES, "readwrite");
    tx.objectStore(STORE_GAMES).delete(gameId);
    return txDone(tx);
  }

function getAllGames() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_GAMES, "readonly");
      const request = tx.objectStore(STORE_GAMES).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

function putFileRecord(record) {
    const tx = state.db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).put(record);
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
