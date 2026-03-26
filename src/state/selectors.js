"use strict";
function sortedGames() {
    return Array.from(state.gamesById.values()).sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return b.importedAt - a.importedAt;
    });
  }

function getNextSortOrder() {
    let maxOrder = -1;
    for (const game of state.gamesById.values()) {
      const value = Number(game.sortOrder);
      if (Number.isFinite(value) && value > maxOrder) {
        maxOrder = value;
      }
    }
    return maxOrder + 1;
  }

function filteredGames() {
    const query = state.searchQuery.trim().toLowerCase();
    const games = sortedGames();
    if (!query) {
      return games;
    }
    return games.filter((game) => {
      const name = String(game.name || "").toLowerCase();
      const zipName = String(game.zipName || "").toLowerCase();
      return name.includes(query) || zipName.includes(query);
    });
  }

function getBundleNameConflicts(name) {
    const normalized = normalizeGameIdentity(name);
    if (!normalized) {
      return [];
    }
    const matches = [];
    for (const game of state.gamesById.values()) {
      if (normalizeGameIdentity(game.name || "") === normalized) {
        matches.push(game);
      }
    }
    return matches;
  }

function chooseUniqueGameId(candidateId, reservedIds) {
    const fallbackBase = typeof candidateId === "string" && candidateId ? candidateId : makeId();
    if (!reservedIds.has(fallbackBase)) {
      reservedIds.add(fallbackBase);
      return fallbackBase;
    }
    let nextId = fallbackBase + "-imported";
    let counter = 2;
    while (reservedIds.has(nextId)) {
      nextId = fallbackBase + "-imported-" + counter;
      counter += 1;
    }
    reservedIds.add(nextId);
    return nextId;
  }

function chooseUniqueGameName(baseName, usedNameKeys) {
    const base = String(baseName || "").trim() || "Imported Game";
    const baseKey = normalizeGameIdentity(base);
    if (!baseKey || !usedNameKeys.has(baseKey)) {
      if (baseKey) {
        usedNameKeys.add(baseKey);
      }
      return base;
    }
    let index = 2;
    while (index < 10000) {
      const candidate = base + " (" + index + ")";
      const key = normalizeGameIdentity(candidate);
      if (!usedNameKeys.has(key)) {
        usedNameKeys.add(key);
        return candidate;
      }
      index += 1;
    }
    const fallback = base + "-" + Date.now();
    const fallbackKey = normalizeGameIdentity(fallback);
    if (fallbackKey) {
      usedNameKeys.add(fallbackKey);
    }
    return fallback;
  }
