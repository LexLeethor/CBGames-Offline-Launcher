"use strict";

function replaceBrUrlsInObject(value, brMap) {
    if (!value) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/\.br$/i.test(trimmed)) {
        const decoded = trimmed.replace(/\.br$/i, "");
        if (!brMap || !brMap.size || brMap.has(decoded)) {
          return decoded;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => replaceBrUrlsInObject(item, brMap));
    }
    if (typeof value === "object") {
      const next = {};
      for (const [key, entry] of Object.entries(value)) {
        next[key] = replaceBrUrlsInObject(entry, brMap);
      }
      return next;
    }
    return value;
  }

function buildBrotliReplacementMap(decodedPaths) {
    const map = new Map();
    for (const decoded of decodedPaths) {
      map.set(decoded + ".br", decoded);
    }
    return map;
  }

function replaceBrReferencesInText(text, brMap) {
    if (!text || !brMap || !brMap.size) {
      return text;
    }
    let out = text;
    for (const [brPath, decodedPath] of brMap.entries()) {
      if (out.includes(brPath)) {
        out = out.split(brPath).join(decodedPath);
      }
    }
    return out;
  }

// Save reversible text edits so exports and extractor migrations can restore the imported bytes.
function addReplacementRecord(replacements, original, transformed) {
    if (!original || !transformed || original === transformed) {
      return;
    }
    if (replacements.some((item) => item.original === original && item.transformed === transformed)) {
      return;
    }
    replacements.push({ original, transformed });
  }

function replaceBrReferencesInTextWithRecords(text, brMap, replacements) {
    if (!text || !brMap || !brMap.size) {
      return text;
    }
    let out = text;
    for (const [brPath, decodedPath] of brMap.entries()) {
      if (out.includes(brPath)) {
        out = out.split(brPath).join(decodedPath);
        addReplacementRecord(replacements, brPath, decodedPath);
      }
    }
    return out;
  }

function stripGenericBrotliSuffixes(text) {
    if (!text) {
      return text;
    }
    return text
      .replace(/\.data\.br\b/gi, ".data")
      .replace(/\.wasm\.br\b/gi, ".wasm")
      .replace(/\.framework\.js\.br\b/gi, ".framework.js")
      .replace(/\.js\.br\b/gi, ".js")
      .replace(/\.mjs\.br\b/gi, ".mjs")
      .replace(/\.cjs\.br\b/gi, ".cjs")
      .replace(/\.css\.br\b/gi, ".css")
      .replace(/\.json\.br\b/gi, ".json");
  }

function stripGenericBrotliSuffixesWithRecords(text, replacements) {
    if (!text) {
      return text;
    }
    const patterns = [
      [/\.data\.br\b/gi, ".data"],
      [/\.wasm\.br\b/gi, ".wasm"],
      [/\.framework\.js\.br\b/gi, ".framework.js"],
      [/\.js\.br\b/gi, ".js"],
      [/\.mjs\.br\b/gi, ".mjs"],
      [/\.cjs\.br\b/gi, ".cjs"],
      [/\.css\.br\b/gi, ".css"],
      [/\.json\.br\b/gi, ".json"]
    ];
    let out = text;
    for (const [pattern, replacement] of patterns) {
      out = out.replace(pattern, (match) => {
        addReplacementRecord(replacements, match, replacement);
        return replacement;
      });
    }
    return out;
  }

function replaceBrUrlsInObjectWithRecords(value, brMap, replacements) {
    if (!value) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/\.br$/i.test(trimmed)) {
        const decoded = trimmed.replace(/\.br$/i, "");
        if (!brMap || !brMap.size || brMap.has(decoded)) {
          addReplacementRecord(replacements, value, decoded);
          return decoded;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => replaceBrUrlsInObjectWithRecords(item, brMap, replacements));
    }
    if (typeof value === "object") {
      const next = {};
      for (const [key, entry] of Object.entries(value)) {
        next[key] = replaceBrUrlsInObjectWithRecords(entry, brMap, replacements);
      }
      return next;
    }
    return value;
  }

function pushJsonRewriteTransformation(transformations, replacements, source) {
    if (!replacements.length) {
      return;
    }
    const existing = transformations.find((item) => item.type === "json_rewrite");
    if (existing) {
      existing.replacements = existing.replacements || [];
      for (const replacement of replacements) {
        addReplacementRecord(existing.replacements, replacement.original, replacement.transformed);
      }
      if (source) {
        existing.sources = Array.isArray(existing.sources) ? existing.sources : [];
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
      }
      return;
    }
    transformations.push({
      version: 1,
      type: "json_rewrite",
      source,
      replacements: replacements.slice()
    });
  }

function buildBrotliDecodedPathSetFromRecords(records) {
    const decodedPaths = new Set();
    for (const record of Array.isArray(records) ? records : []) {
      const path = normalizePath(record && record.path ? record.path : "");
      if (path) {
        decodedPaths.add(path);
      }
      const transformations = Array.isArray(record && record.transformations) ? record.transformations : [];
      for (const transform of transformations) {
        const replacements = Array.isArray(transform && transform.replacements) ? transform.replacements : [];
        for (const replacement of replacements) {
          const transformed = normalizePath(replacement && replacement.transformed ? replacement.transformed : "");
          if (transformed) {
            decodedPaths.add(transformed);
          }
        }
      }
    }
    return decodedPaths;
  }

function applyCurrentExtractorTransformations(path, bytes, context) {
    let entryBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const transformations = [];
    const decodedPaths = context && context.brotliDecodedPaths instanceof Set
      ? context.brotliDecodedPaths
      : new Set();
    const replacementMap = context && context.brotliReplacementMap instanceof Map
      ? context.brotliReplacementMap
      : buildBrotliReplacementMap(decodedPaths);
    const normalizedPath = normalizePath(path || "");
    const isTextFile = /\.(?:html?|js|mjs|cjs|css|json)$/i.test(normalizedPath);

    if (replacementMap.size && isTextFile) {
      try {
        const originalText = decodeUtf8(entryBytes);
        const replacements = [];
        const replacedText = stripGenericBrotliSuffixesWithRecords(
          replaceBrReferencesInTextWithRecords(originalText, replacementMap, replacements),
          replacements
        );
        if (replacedText !== originalText) {
          entryBytes = new TextEncoder().encode(replacedText);
          pushJsonRewriteTransformation(transformations, replacements, "text_brotli_reference");
        }
      } catch {
        // ignore decode failures
      }
    }

    if (decodedPaths.size && /\.json$/i.test(normalizedPath)) {
      try {
        const jsonText = decodeUtf8(entryBytes);
        const jsonValue = JSON.parse(jsonText);
        const replacements = [];
        const rewritten = replaceBrUrlsInObjectWithRecords(jsonValue, decodedPaths, replacements);
        const rewrittenText = JSON.stringify(rewritten);
        if (rewrittenText !== jsonText) {
          entryBytes = new TextEncoder().encode(rewrittenText);
          pushJsonRewriteTransformation(transformations, replacements, "json_brotli_url");
        }
      } catch {
        // ignore JSON rewrite failures
      }
    }

    return {
      bytes: entryBytes,
      transformations: transformations.length ? transformations : undefined
    };
  }

async function applyPreLaunchTransformations(entries) {
    if (!entries || !entries.length) return;

    // Build a shared lookup because patches may inline neighboring files and worker dependencies.
    const recordsByPath = new Map(entries.map(e => [e.path, {
      path: e.path,
      bytes: e.bytes,
      get blob() {
        return new Blob([this.bytes], { type: mimeFromPath(this.path) });
      }
    }]));
    const dataUrlCache = new Map();

    // 1. Collect worker paths (needs to scan JS files)
    const workerPaths = await collectWorkerScriptPaths(recordsByPath);

    // 2. Apply transformations
    for (const entry of entries) {
      const path = entry.path;
      const bytes = entry.bytes;
      let text = null;
      let changed = false;
      const transformations = entry.transformations || [];

      // Unity Web Config rewrite
      if (/\.json$/i.test(path)) {
        try {
          text = text || decodeUtf8(bytes);
          const { text: rewritten, changed: jsonChanged } = rewriteUnityWebConfigText(text, path);
          if (jsonChanged) {
            const replacements = [{ original: text, replacement: rewritten }];
            pushJsonRewriteTransformation(transformations, replacements, "unity_config_rewrite");
            text = rewritten;
            changed = true;
          }
        } catch (e) { /* ignore */ }
      }

      // JS / UnityWeb patching
      if (/\.(?:js|mjs|cjs|unityweb)$/i.test(path)) {
        try {
          text = text || decodeUtf8(bytes);
          let jsChanged = false;

          // Emscripten WASM inlining (mostly for workers)
          if (workerPaths.has(path)) {
            const patched = await patchEmscriptenWasmScriptText(text, path, recordsByPath, dataUrlCache);
            if (patched !== text) {
              text = patched;
              jsChanged = true;
            }
          }

          // importScripts inlining
          const rewrittenImport = await rewriteImportScriptsText(text, path, recordsByPath, dataUrlCache);
          if (rewrittenImport !== text) {
            text = rewrittenImport;
            jsChanged = true;
          }

          // Static patches (baseURI, GetDocumentURL)
          const staticPatched = applyStaticJsPatches(text, path);
          if (staticPatched !== text) {
            text = staticPatched;
            jsChanged = true;
          }

          // Dynamic import() patching
          if (!/^Build\//i.test(path)) {
            const dynamicPatched = await patchDynamicImportsInText(text, path, recordsByPath, dataUrlCache);
            if (dynamicPatched !== text) {
              text = dynamicPatched;
              jsChanged = true;
            }
          }

          if (jsChanged) {
            changed = true;
            // For now, we don't record complex JS transformations in transformations array 
            // because they are hard to revert perfectly with literal replacements.
            // But we still apply them for launch speed.
          }
        } catch (e) { /* ignore */ }
      }

      if (changed && text !== null) {
        entry.bytes = encodeUtf8(text);
        entry.transformations = transformations.length ? transformations : undefined;
      }
    }
  }
