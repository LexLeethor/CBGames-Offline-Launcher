"use strict";
function putSetting(key, value) {
    const tx = state.db.transaction(STORE_SETTINGS, "readwrite");
    tx.objectStore(STORE_SETTINGS).put(value, key);
    return txDone(tx);
  }

function getSetting(key) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE_SETTINGS, "readonly");
      const request = tx.objectStore(STORE_SETTINGS).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
