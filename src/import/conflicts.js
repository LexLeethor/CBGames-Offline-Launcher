"use strict";
function findExistingGameMatchForImport(fileName) {
    const zipName = String(fileName || "");
    const zipNorm = normalizeGameIdentity(zipName);
    const derivedNorm = normalizeGameIdentity(deriveGameName(zipName));
    for (const game of state.gamesById.values()) {
      const gameZipNorm = normalizeGameIdentity(game.zipName || "");
      const gameNameNorm = normalizeGameIdentity(game.name || "");
      if (zipNorm && (zipNorm === gameZipNorm || zipNorm === gameNameNorm)) {
        return game;
      }
      if (derivedNorm && derivedNorm === gameNameNorm) {
        return game;
      }
    }
    return null;
  }
