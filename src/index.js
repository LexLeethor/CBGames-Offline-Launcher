"use strict";

if (networkHostUrlInput && !networkHostUrlInput.value) {
    networkHostUrlInput.value = state.networkTransfer.hostUrl || NETWORK_TRANSFER_DEFAULT_HOST_URL;
  }
  setNetworkTransferStatus("Enter a host URL, then click Load Shared.");
  renderNetworkTransferList();

  setEmptyEntryState("Loading...");

  // =============================================================================
  // SECTION: Boot sequence
  // =============================================================================
  // App boot: open DB, load saved library, restore selection, then handle optional ?load=.
  (async () => {
    try {
      state.db = await openDatabase();
      const savedGameId = await getSetting(SETTING_SELECTED_GAME);
      await loadLibrary(savedGameId || "");
      log("Ready. Import a ZIP game to begin.");

      const hostSetup = window.__CBGAMES_HOST_SETUP__;
      if (hostSetup && Array.isArray(hostSetup.bundles) && hostSetup.bundles.length > 0) {
        await runAutoImport(hostSetup);
      } else if (typeof maybeStartTutorial === "function") {
        await maybeStartTutorial();
      }

      const urlParams = new URLSearchParams(window.location.search);
      const loadParam = urlParams.get('load');
      if (loadParam) {
        const lower = loadParam.toLowerCase();
        const match =
          state.gamesById.get(loadParam) ||
          Array.from(state.gamesById.values()).find(
            g => g.name.toLowerCase() === lower ||
                 g.name.toLowerCase().replace(/\s+/g, '') === lower.replace(/\s+/g, '')
          );
        if (match) {
          await selectGameById(match.id);
          await launchSelectedGame();
        } else {
          log('No saved game found matching "' + loadParam + '".', "error");
        }
      }
    } catch (error) {
      console.error(error);
      setEmptyEntryState("Initialization failed");
      log("Initialization failed: " + (error.message || String(error)), "error");
      setActionButtonsDisabled(true);
    }
  })();
