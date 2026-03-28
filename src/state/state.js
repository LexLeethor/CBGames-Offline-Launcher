"use strict";

const DB_NAME = "cbgamesOfflineZipDB";
const DB_VERSION = 2; // DONT CHANGE THE DB VERSION
const STORE_GAMES = "games";
const STORE_FILES = "files";
const STORE_SETTINGS = "settings";
const STORE_ERROR_LOGS = "errorLogs";
const SETTING_SELECTED_GAME = "selectedGameId";

const VFS_ORIGIN = "https://loader.invalid/";
const VFS_ORIGIN_URL = new URL(VFS_ORIGIN).origin;
const UNITY_GPU_SAFE_MODE = true;
const UNITY_FORCE_WEBGL1 = true;
const UNITY_CLAMP_DEVICE_PIXEL_RATIO = 1;

const BADGE_RESCAN_SECRET_PARAM = "__cbgames_rebadge";
const NETWORK_TRANSFER_DEFAULT_HOST_URL = "http://localhost:8941";

const reorderAnimations = new WeakMap();

const state = {
  db: null,
  gamesById: new Map(),
  selectedGameId: null,
  objectUrls: new Map(),
  objectUrlHost: window,
  activeEntryPath: null,
  playerWindow: null,
  dragDepth: 0,
  suppressCardClickUntil: 0,
  searchQuery: "",
  reorder: {
    active: false,
    pointerId: null,
    holdTimer: 0,
    holdMoveListener: null,
    startTarget: null,
    holdStartX: 0,
    holdStartY: 0,
    pointerX: 0,
    pointerY: 0,
    sourceGameId: "",
    sourceElement: null,
    placeholder: null,
    ghost: null,
    pointerOffsetX: 0,
    pointerOffsetY: 0
  },
  gameEditEditor: {
    gameId: null,
    image: null,
    sourceUrl: null,
    cropper: null,
    previewFrame: 0
  },
  actionInProgress: false,
  importConflictResolver: null,
  githubImportResolver: null,
  replaceTargetSelectedId: "",
  updatePromptResolver: null,
  bundlePreviewResolver: null,
  bundlePreviewDraft: null,
  saveImportDraft: null,
  networkTransfer: {
    hostUrl: NETWORK_TRANSFER_DEFAULT_HOST_URL,
    items: []
  },
  badgeRescanCompleted: false,
  gameCardsEntryAnimated: false,
  libraryChecked: false,
  storageUsedPctDisplay: 0,
  storagePctAnimationFrame: 0
};
