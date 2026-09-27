"use strict";

async function importFromGithub() {
    const input = await askGithubImportSource();
    if (!input) {
      log("GitHub import canceled.");
      return;
    }
    const repoRef = parseGithubRepoRef(input);
    const directUrl = toHttpUrl(input);
    setActionButtonsDisabled(true);
    try {
      let sourceMeta = null;
      let downloadUrl = "";
      if (repoRef) {
        setWorkProgress("Checking GitHub release", 0, 0);
        let releaseMeta = null;
        let releaseError = null;
        try {
          releaseMeta = await fetchLatestGithubReleaseInfo(repoRef.owner, repoRef.repo, "");
        } catch (error) {
          releaseError = error;
          const message = String(error && error.message ? error.message : error);
          const noRelease = /No latest release found|\/releases\/latest|no \.zip asset/i.test(message);
          if (!noRelease) {
            // API itself failed — still try the file-tree path below.
            log("GitHub release lookup failed; trying api.github.com file tree...");
          }
        }

        if (releaseMeta) {
          try {
            const download = await downloadGithubReleaseZip(releaseMeta, "Downloading ZIP");
            sourceMeta = {
              ...releaseMeta,
              etag: download.etag,
              lastModified: download.lastModified,
              lastCheckedAt: Date.now()
            };
            await importZipFile(download.file, {
              githubSource: sourceMeta,
              manageUi: false
            });
            log("Imported from GitHub source.");
            return;
          } catch (error) {
            console.error(error);
            log(
              "Release ZIP download failed (" +
              (error.message || String(error)) +
              "). Falling back to GitHub repo ZIP..."
            );
          }
        } else if (releaseError) {
          const message = String(releaseError && releaseError.message ? releaseError.message : releaseError);
          if (!/No latest release found|\/releases\/latest|no \.zip asset/i.test(message)) {
            // keep going to tree fallback
          } else {
            setWorkProgress("No release found, reading repo metadata", 0, 0);
          }
        }

        setWorkProgress("Reading GitHub repo metadata", 0, 0);
        const snapshot = await fetchGithubRepoTreeSnapshot(repoRef.owner, repoRef.repo, "");
        sourceMeta = {
          provider: "github-tree",
          owner: snapshot.owner,
          repo: snapshot.repo,
          branch: snapshot.branch,
          treeSha: snapshot.treeSha,
          lastCheckedAt: Date.now()
        };
        await importGithubTreeDirect(snapshot, (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")"), {
          streamDuringDownload: true,
          prioritizeSmallest: true,
          skipPatterns: [],
          manageUi: false,
          githubSource: sourceMeta
        });
        log("Imported from GitHub source.");
        return;
      } else if (directUrl && /\.zip(?:$|[?#])/i.test(directUrl)) {
        sourceMeta = {
          provider: "zip-url",
          url: directUrl,
          etag: "",
          lastModified: "",
          lastCheckedAt: Date.now()
        };
        downloadUrl = directUrl;
      } else {
        throw new Error("Input must be a GitHub repo or a .zip URL.");
      }
      const download = await downloadZipFromUrl(downloadUrl, "Downloading ZIP");
      sourceMeta.url = download.resolvedUrl || sourceMeta.url;
      sourceMeta.etag = download.etag;
      sourceMeta.lastModified = download.lastModified;
      sourceMeta.lastCheckedAt = Date.now();
      await importZipFile(download.file, {
        githubSource: sourceMeta,
        manageUi: false
      });
      log("Imported from GitHub source.");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function checkAllGithubUpdates() {
    const candidates = sortedGames().filter((game) => normalizeGithubSource(game.githubSource));
    if (!candidates.length) {
      log("No GitHub-linked games found in your library.", "error");
      setUpdateScanStatus("No GitHub-linked games found.");
      return;
    }

    let updatedCount = 0;
    let availableCount = 0;
    let noUpdateCount = 0;
    let stoppedByUser = false;

    setActionButtonsDisabled(true);
    try {
      setUpdateScanStatus("Checking " + candidates.length + " GitHub-linked game(s)...");
      for (let i = 0; i < candidates.length; i += 1) {
        const selected = candidates[i];
        const source = normalizeGithubSource(selected.githubSource);
        if (!source) {
          continue;
        }

        setWorkProgress("Checking updates (" + (i + 1) + "/" + candidates.length + ")", i + 1, candidates.length);

        let updateAvailable = false;
        let nextSource = source;
        let sourceLabel = "";

        if (source.provider === "github-release") {
          const latest = await fetchLatestGithubReleaseInfo(source.owner, source.repo, source.assetName);
          latest.etag = source.etag || "";
          latest.lastModified = source.lastModified || "";
          updateAvailable = githubReleaseHasUpdate(source, latest);
          nextSource = latest;
          sourceLabel = latest.releaseTag || latest.assetName || "latest release";
        } else if (source.provider === "zip-url") {
          let headInfo = null;
          try {
            headInfo = await fetchZipHeadInfo(source.url);
          } catch {
            headInfo = null;
          }
          if (headInfo) {
            updateAvailable = zipUrlHasUpdate(source, headInfo);
            nextSource = normalizeGithubSource({
              ...source,
              url: headInfo.url || source.url,
              etag: headInfo.etag || source.etag,
              lastModified: headInfo.lastModified || source.lastModified,
              lastCheckedAt: Date.now()
            }) || source;
          }
          sourceLabel = source.url;
        } else if (source.provider === "github-tree") {
          const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, source.branch);
          updateAvailable = latestTree.treeSha !== source.treeSha;
          nextSource = normalizeGithubSource({
            provider: "github-tree",
            owner: latestTree.owner,
            repo: latestTree.repo,
            branch: latestTree.branch,
            treeSha: latestTree.treeSha,
            lastCheckedAt: Date.now()
          }) || source;
          sourceLabel = source.owner + "/" + source.repo + "@" + latestTree.branch;
        }

        if (!updateAvailable) {
          noUpdateCount += 1;
          nextSource.lastCheckedAt = Date.now();
          selected.githubSource = nextSource;
          state.gamesById.set(selected.id, selected);
          await putGame(selected);
          continue;
        }

        availableCount += 1;
        const decision = await askUpdateInstallDecision(
          selected.name || "Selected game",
          sourceLabel,
          "Update " + (availableCount) + " found while checking " + (i + 1) + "/" + candidates.length + " games."
        );
        if (decision === "stop") {
          stoppedByUser = true;
          break;
        }
        if (decision !== "update") {
          log("Skipped update for \"" + (selected.name || selected.id) + "\".");
          continue;
        }

        if (source.provider === "github-tree") {
          const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, source.branch);
          const mergedSource = normalizeGithubSource({
            provider: "github-tree",
            owner: latestTree.owner,
            repo: latestTree.repo,
            branch: latestTree.branch,
            treeSha: latestTree.treeSha,
            lastCheckedAt: Date.now()
          });
          await importGithubTreeDirect(latestTree, selected.name || (String(latestTree.repo || "github-repo") + " (" + String(latestTree.branch || "main") + ")"), {
            streamDuringDownload: true,
            prioritizeSmallest: true,
            replaceGameId: selected.id,
            importMode: "replace",
            githubSource: mergedSource,
            manageUi: false
          });
        } else {
          const downloadUrl = source.provider === "github-release"
            ? String(nextSource.downloadUrl || source.downloadUrl || "")
            : String(source.url || "");
          let download = null;
          if (source.provider === "github-release") {
            try {
              download = await downloadGithubReleaseZip(nextSource, "Downloading update");
            } catch (error) {
              console.error(error);
              log(
                "Release ZIP download failed; falling back to GitHub repo ZIP for \"" +
                (selected.name || selected.id) + "\"..."
              );
              const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, "");
              const treeSource = normalizeGithubSource({
                provider: "github-tree",
                owner: latestTree.owner,
                repo: latestTree.repo,
                branch: latestTree.branch,
                treeSha: latestTree.treeSha,
                lastCheckedAt: Date.now()
              });
              await importGithubTreeDirect(latestTree, selected.name || (String(latestTree.repo || "github-repo") + " (" + String(latestTree.branch || "main") + ")"), {
                streamDuringDownload: true,
                prioritizeSmallest: true,
                replaceGameId: selected.id,
                importMode: "replace",
                githubSource: treeSource,
                manageUi: false
              });
              updatedCount += 1;
              log("Updated \"" + (selected.name || selected.id) + "\".");
              continue;
            }
          } else {
            download = await downloadZipFromUrl(downloadUrl, "Downloading update");
          }
          const mergedSource = normalizeGithubSource(
            source.provider === "github-release"
              ? {
                  ...nextSource,
                  etag: download.etag || nextSource.etag,
                  lastModified: download.lastModified || nextSource.lastModified,
                  lastCheckedAt: Date.now()
                }
              : {
                  ...nextSource,
                  url: download.resolvedUrl || source.url,
                  etag: download.etag || nextSource.etag,
                  lastModified: download.lastModified || nextSource.lastModified,
                  lastCheckedAt: Date.now()
                }
          );
          await importZipFile(download.file, {
            importMode: "replace",
            replaceGameId: selected.id,
            githubSource: mergedSource,
            manageUi: false
          });
        }
        updatedCount += 1;
        log("Updated \"" + (selected.name || selected.id) + "\".");
      }

      log(
        "GitHub update check complete. " +
        updatedCount + " updated, " +
        noUpdateCount + " already up to date, " +
        Math.max(0, availableCount - updatedCount) + " updates skipped." +
        (stoppedByUser ? " Stopped early." : "")
      );
      if (availableCount === 0) {
        setUpdateScanStatus("All checked games are already up to date.");
      } else {
        setUpdateScanStatus(
          updatedCount + " updated, " +
          Math.max(0, availableCount - updatedCount) + " skipped, " +
          noUpdateCount + " already up to date" +
          (stoppedByUser ? " (stopped early)." : ".")
        );
      }
    } finally {
      const updateResolver = closeUpdatePromptModal();
      if (updateResolver) {
        updateResolver("stop");
      }
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function cleanupInterruptedGithubImport(game) {
    if (!game || !game.id) {
      return;
    }
    const label = game.name || game.id;
    const notice = "Deleted unfinished GitHub import for \"" + label + "\".";
    try {
      log(notice);
    } catch (error) {
      console.warn("Failed to log removal notice", error);
    }
    try {
      if (typeof openWrongZipTypeModal === "function") {
        openWrongZipTypeModal(notice, "Import Cleaned Up");
      }
    } catch (error) {
      console.warn("Failed to show cleanup modal", error);
    }
    try {
      await deleteFilesByGameId(game.id);
    } catch (error) {
      console.warn("Failed to delete partial GitHub files", error);
    }
    try {
      await deleteGameRecord(game.id);
    } catch (error) {
      console.warn("Failed to delete partial GitHub game record", error);
    }
    state.gamesById.delete(game.id);
    if (state.selectedGameId === game.id) {
      state.selectedGameId = null;
      await putSetting(SETTING_SELECTED_GAME, "");
    }
  }

async function recoverInterruptedGithubImports() {
    const unfinished = Array.from(state.gamesById.values()).filter((game) => game && game.importInProgress);
    if (!unfinished.length) {
      return;
    }
    const stale = unfinished.filter((game) => {
      const importedAt = Number(game.importedAt) || 0;
      return importedAt > 0 && (Date.now() - importedAt) > 15000;
    });
    if (!stale.length) {
      return;
    }

    for (const game of stale) {
      await cleanupInterruptedGithubImport(game);
    }
  }

async function importGithubTreeDirect(snapshot, gameName, options) {
    const opts = options && typeof options === "object" ? options : {};
    const replaceGameIdOpt = typeof opts.replaceGameId === "string" ? opts.replaceGameId : "";
    try {
      setActionButtonsDisabled(true);
      const githubSource = normalizeGithubSource(opts.githubSource) || normalizeGithubSource({
        provider: "github-tree",
        owner: String(snapshot && snapshot.owner || ""),
        repo: String(snapshot && snapshot.repo || ""),
        branch: String(snapshot && snapshot.branch || ""),
        treeSha: String(snapshot && snapshot.treeSha || ""),
        lastCheckedAt: Date.now()
      });
      if (!githubSource) {
        throw new Error("GitHub repo metadata is incomplete.");
      }

      if (opts.streamDuringDownload) {
        // Persist binary assets immediately to cap peak memory; keep text buffered for rewriting.
        const expectedGameBytes = (Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries : [])
          .reduce((sum, entry) => addGameImportBytes(sum, Number(entry && entry.size) || 0), 0);
        let oversizedImportConfirmed = isGameImportOversized(expectedGameBytes);
        if (oversizedImportConfirmed) {
          oversizedImportConfirmed = await askLargeGameImportDecision(gameName, expectedGameBytes);
          if (!oversizedImportConfirmed) return;
        }
        let gameId = makeId();
        let preservedName = gameName || (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")");
        // If caller wants to replace an existing game, prefer that id and remove old files first
        if (replaceGameIdOpt && state.gamesById.has(replaceGameIdOpt)) {
          gameId = replaceGameIdOpt;
          try {
            await deleteFilesByGameId(gameId);
          } catch (e) {
            console.warn('Failed to delete existing files for replaceGameId', gameId, e);
          }
          const existing = state.gamesById.get(gameId);
          if (existing && existing.name) preservedName = existing.name;
        }
        const gameRecord = {
          id: gameId,
          name: preservedName,
          zipName: preservedName + ".zip",
          importedAt: Date.now(),
          extractorVersion: CURRENT_EXTRACTOR_VERSION,
          sortOrder: getNextSortOrder(),
          fileCount: 0,
          totalBytes: 0,
          htmlEntries: [],
          entryPath: "",
          thumbnailDataUrl: "",
          githubSource: githubSource,
          unityDetected: false,
          flashDetected: false,
          importInProgress: true
        };
        await putGame(gameRecord);
        state.gamesById.set(gameId, gameRecord);
        const pending = [];
        let downloadedGameBytes = 0;
        let largeImportCanceled = false;
        try {
        const onFile = async (fileMeta, bytes) => {
          if (largeImportCanceled) return;
          downloadedGameBytes = addGameImportBytes(downloadedGameBytes, bytes.byteLength);
          if (isGameImportOversized(downloadedGameBytes) && !oversizedImportConfirmed) {
            oversizedImportConfirmed = await askLargeGameImportDecision(gameName, downloadedGameBytes);
            if (!oversizedImportConfirmed) {
              largeImportCanceled = true;
              return;
            }
          }
          try {
            if (isStreamablePath(fileMeta.path)) {
              const blob = new Blob([bytes], { type: mimeFromPath(fileMeta.path) });
              const nextTotalBytes = addGameImportBytes(gameRecord.totalBytes || 0, blob.size);
              await putFileRecord({ gameId, path: fileMeta.path, size: blob.size, type: blob.type, blob, transformations: [] });
              gameRecord.fileCount = (gameRecord.fileCount || 0) + 1;
              gameRecord.totalBytes = nextTotalBytes;
              await putGame(gameRecord);
            } else {
              pending.push({ path: fileMeta.path, bytes });
            }
          } catch (error) {
            console.error("Stream import failed for " + fileMeta.path, error);
            pending.push({ path: fileMeta.path, bytes });
          }
        };

          await downloadGithubTreeEntries(snapshot, "Downloading " + (gameName || "repo"), { onFile, prioritizeSmallest: true, skipPatterns: opts.skipPatterns || [] });
          if (largeImportCanceled) {
            await cleanupInterruptedGithubImport(gameRecord);
            return;
          }

          if (pending.length) {
            try {
              await importEntriesDirectly(pending, {
                existingGameId: gameId,
                gameName: preservedName,
                githubSource: githubSource,
                importMode: "separate",
                baseGameBytes: gameRecord.totalBytes || 0,
                baseGameFileCount: gameRecord.fileCount || 0,
                skipLargeWarning: oversizedImportConfirmed,
                skipExistingFilePaths: (await getAllFilesForGame(gameId)).map((record) => normalizePath(record.path || "")),
                manageUi: true
              });
            } catch (error) {
              throw error;
            }
          }
          // finalize: recompute stored-file stats and mark complete
          try {
            const stored = await getAllFilesForGame(gameId);
            const metadataEntries = [];
            for (const f of Array.isArray(stored) ? stored : []) {
              let bytes = new Uint8Array();
              try {
                if (f && f.blob && typeof f.blob.arrayBuffer === "function") {
                  bytes = new Uint8Array(await f.blob.arrayBuffer());
                }
              } catch (err) {
                console.warn('Failed to read blob for launcher metadata detection', err);
              }
              metadataEntries.push({ path: f && f.path ? f.path : "", bytes });
            }
            const metadata = detectLauncherMetadata(metadataEntries);
            gameRecord.fileCount = Array.isArray(stored) ? stored.length : gameRecord.fileCount;
            gameRecord.totalBytes = Array.isArray(stored) ? stored.reduce((s, f) => s + (Number(f.size) || 0), 0) : gameRecord.totalBytes;
            if (gameRecord.totalBytes > 0) {
              await putGame(gameRecord);
              state.gamesById.set(gameId, gameRecord);
            }
            // compute html entries and best entryPath
            const paths = Array.isArray(stored) ? stored.map((f) => normalizePath(f.path || "")) : [];
            const htmlEntries = paths.filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.localeCompare(b));
            gameRecord.htmlEntries = htmlEntries;
            gameRecord.entryPath = chooseBestEntryPath(htmlEntries, "");
            if (metadata.name) {
              gameRecord.name = metadata.name;
            }
            if (metadata.thumbnailDataUrl) {
              gameRecord.thumbnailDataUrl = metadata.thumbnailDataUrl;
            }
            // detect Unity/Flash heuristics
            gameRecord.unityDetected = detectUnityByPaths(paths);
            gameRecord.flashDetected = detectFlashByPaths(paths);
            gameRecord.importInProgress = false;
            gameRecord.importedAt = Date.now();
            await putGame(gameRecord);
            state.gamesById.set(gameId, gameRecord);
            await loadLibrary(gameId);
            if (!(opts.importMode === "replace" && replaceGameIdOpt && state.gamesById.has(replaceGameIdOpt))) {
              openGameEditModal(gameId);
            }
          } catch (e) {
            console.error('Failed to finalize streamed game', e);
          }
          log("Imported from GitHub source.");
          return;
        } finally {
          // ensure importInProgress is cleared on error as well
          try {
            if (gameId && state.gamesById.has(gameId)) {
              const gr = state.gamesById.get(gameId);
              if (gr && gr.importInProgress) {
                gr.importInProgress = false;
                await putGame(gr);
                state.gamesById.set(gameId, gr);
              }
            }
          } catch (e) {
            // swallow
          }
        }
      }

      const entries = await downloadGithubTreeEntries(snapshot, "Downloading " + (gameName || "repo"));
      await importEntriesDirectly(entries, {
        gameName: gameName || (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")"),
        githubSource: githubSource,
        importMode: opts.importMode || "separate",
        replaceGameId: opts.replaceGameId || "",
        manageUi: true
      });
    } finally {
      setActionButtonsDisabled(false);
    }
  }
