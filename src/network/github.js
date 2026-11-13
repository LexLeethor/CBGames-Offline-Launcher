"use strict";

// ---- GitHub API authentication ----
// Build-time token. scripts/build_bundle.mjs replaces the quoted placeholder below when
// the bundle is built with --github-token <token> or with GITHUB_API_TOKEN set in the
// environment. You can also hard-code a token by editing this line directly.
// Unreplaced placeholder = unauthenticated api.github.com requests (60 req/hr per IP).
// With a token the limit rises (5,000 req/hr for a user token).
// NOTE: the token is embedded in the built HTML and is readable by anyone who gets that
// file. Use a dedicated token with minimal (ideally no) scopes.
const BUILD_GITHUB_TOKEN = "";

function getGithubApiToken() {
    const token = typeof BUILD_GITHUB_TOKEN === "string" ? BUILD_GITHUB_TOKEN.trim() : "";
    // Treat the unreplaced build placeholder (or anything malformed) as "no token".
    if (!token || token.indexOf("__") === 0 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return "";
    }
    return token;
  }

function githubApiHeaders(extraHeaders) {
    const headers = { Accept: "application/vnd.github+json" };
    if (extraHeaders && typeof extraHeaders === "object") {
      const keys = Object.keys(extraHeaders);
      for (let i = 0; i < keys.length; i += 1) {
        headers[keys[i]] = extraHeaders[keys[i]];
      }
    }
    const token = getGithubApiToken();
    if (token) {
      headers.Authorization = "Bearer " + token;
    }
    return headers;
  }

// ---- Git LFS sizing ----
// The git tree API reports a blob's own size, which for an LFS-tracked file is only the
// tiny pointer file (~130 bytes), not the object it stands for. Downloading such a repo
// with a byte-based progress bar therefore has a total far smaller than the real payload
// and kept growing mid-download. To keep the total stable we resolve the real object
// sizes up front: read .gitattributes to learn which paths are LFS-tracked, then fetch
// each pointer to read its "size" field.
const GITHUB_LFS_POINTER_SIGNATURE = "version https://git-lfs.github.com/spec/v1";
const GITHUB_LFS_MAX_TEXT_BYTES = 4096;
const GITHUB_LFS_LOOKUP_CONCURRENCY = 5;

function parseGithubLfsPointerText(text) {
    const source = String(text || "");
    if (source.indexOf(GITHUB_LFS_POINTER_SIGNATURE) !== 0) {
      return null;
    }
    const oidMatch = source.match(/oid sha256:([a-f0-9]{64})/i);
    const sizeMatch = source.match(/(?:^|\n)size (\d+)/);
    const oid = oidMatch ? oidMatch[1] : "";
    const size = sizeMatch ? Number(sizeMatch[1]) : 0;
    if (!oid || !(size > 0)) {
      return null;
    }
    return { oid, size };
  }

function gitAttributesGlobSource(pattern) {
    let out = "";
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern.charAt(i);
      if (ch === "*") {
        if (pattern.charAt(i + 1) === "*") {
          if (pattern.charAt(i + 2) === "/") {
            out += "(?:.*/)?";
            i += 2;
          } else {
            out += ".*";
            i += 1;
          }
        } else {
          out += "[^/]*";
        }
      } else if (ch === "?") {
        out += "[^/]";
      } else if ("\\^$.|+()[]{}".indexOf(ch) >= 0) {
        out += "\\" + ch;
      } else {
        out += ch;
      }
    }
    return out;
  }

function compileGitAttributesPattern(pattern) {
    let pat = String(pattern || "").trim();
    if (!pat) {
      return null;
    }
    let anchored = false;
    if (pat.charAt(0) === "/") {
      anchored = true;
      pat = pat.slice(1);
    }
    // Trailing-slash directory patterns do not match recursively in attributes files.
    if (pat.slice(-1) === "/") {
      pat = pat.slice(0, -1);
    }
    if (!pat) {
      return null;
    }
    // A separator in the middle anchors the pattern to the .gitattributes directory.
    if (pat.indexOf("/") >= 0) {
      anchored = true;
    }
    try {
      return { re: new RegExp("^" + gitAttributesGlobSource(pat) + "$"), anchored };
    } catch (error) {
      return null;
    }
  }

function parseGitAttributesLfsRules(text, dirPrefix) {
    const dir = String(dirPrefix || "");
    const rules = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.charAt(0) === "#") {
        continue;
      }
      const tokens = line.split(/\s+/);
      if (tokens.length < 2) {
        continue;
      }
      const pattern = tokens[0];
      // Negative patterns are not allowed in gitattributes files.
      if (!pattern || pattern.charAt(0) === "!") {
        continue;
      }
      let isLfs = null;
      for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token === "filter=lfs" || token === "diff=lfs" || token === "merge=lfs") {
          isLfs = true;
        } else if (token === "-filter" || token === "!filter" || token === "-diff" || token === "-merge") {
          if (isLfs === null) {
            isLfs = false;
          }
        }
      }
      const compiled = compileGitAttributesPattern(pattern);
      if (!compiled) {
        continue;
      }
      rules.push({ dir, anchored: compiled.anchored, re: compiled.re, isLfs });
    }
    return rules;
  }

function pathIsGithubLfsTracked(path, rules) {
    const target = String(path || "");
    let decision = null;
    for (const rule of rules) {
      if (rule.dir && target.indexOf(rule.dir) !== 0) {
        continue;
      }
      const relPath = target.slice(rule.dir.length);
      const candidate = rule.anchored ? relPath : (relPath.split("/").pop() || "");
      if (rule.re.test(candidate) && rule.isLfs !== null) {
        decision = rule.isLfs;
      }
    }
    return decision === true;
  }

async function fetchGithubRepoFileText(owner, repo, branch, fileMeta) {
    const path = String(fileMeta && fileMeta.path || "");
    const sha = String(fileMeta && fileMeta.sha || "");
    const readTruncated = async (response) => {
      if (!response || !response.ok) {
        return "";
      }
      const text = await response.text();
      return text.length <= GITHUB_LFS_MAX_TEXT_BYTES ? text : "";
    };
    if (owner && repo && branch && path) {
      const rawUrl =
        "https://raw.githubusercontent.com/" +
        encodeURIComponent(owner) + "/" +
        encodeURIComponent(repo) + "/" +
        encodeURIComponent(branch) + "/" +
        path.split("/").map(encodeURIComponent).join("/");
      try {
        const rawText = await readTruncated(await fetch(rawUrl, { cache: "no-store" }));
        if (rawText) {
          return rawText;
        }
      } catch (error) {
        // fall through to the blob API
      }
    }
    if (owner && repo && sha) {
      const blobApi =
        "https://api.github.com/repos/" +
        encodeURIComponent(owner) + "/" +
        encodeURIComponent(repo) +
        "/git/blobs/" + encodeURIComponent(sha);
      try {
        const blobText = await readTruncated(await fetch(blobApi, {
          cache: "no-store",
          headers: githubApiHeaders({ Accept: "application/vnd.github.raw+json" })
        }));
        if (blobText) {
          return blobText;
        }
      } catch (error) {
        // ignore: sizing is best-effort
      }
    }
    return "";
  }

async function resolveGithubLfsObjectSizes(snapshot, files, discoveryEntries) {
    const resolved = new Map();
    const owner = String(snapshot && snapshot.owner || "").trim();
    const repo = String(snapshot && snapshot.repo || "").trim();
    const branch = String(snapshot && snapshot.branch || "").trim();
    // Partial (incremental update) downloads only carry the changed files, so allow the
    // caller to hand over the full tree purely so .gitattributes can still be found.
    const allEntries = Array.isArray(discoveryEntries) && discoveryEntries.length
      ? discoveryEntries
      : (Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries : []);
    if (!owner || !repo || !branch || !allEntries.length || !Array.isArray(files) || !files.length) {
      return resolved;
    }
    const attributeEntries = allEntries
      .filter((entry) => entry && typeof entry.path === "string" && /(^|\/)\.gitattributes$/i.test(entry.path))
      .slice()
      .sort((a, b) => {
        const aDepth = (a.path.match(/\//g) || []).length;
        const bDepth = (b.path.match(/\//g) || []).length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });
    if (!attributeEntries.length) {
      return resolved;
    }

    const rules = [];
    for (const entry of attributeEntries) {
      const text = await fetchGithubRepoFileText(owner, repo, branch, entry);
      if (!text) {
        continue;
      }
      const dir = entry.path.replace(/[^/]*$/, "");
      for (const rule of parseGitAttributesLfsRules(text, dir)) {
        rules.push(rule);
      }
    }
    if (!rules.length) {
      return resolved;
    }

    const candidates = files.filter((file) => file && pathIsGithubLfsTracked(file.path, rules));
    if (!candidates.length) {
      return resolved;
    }

    let completed = 0;
    let next = 0;
    setWorkProgress("Checking LFS files", 0, candidates.length, {
      currentText: "0",
      totalText: String(candidates.length)
    });
    const worker = async () => {
      while (next < candidates.length) {
        const file = candidates[next];
        next += 1;
        const text = await fetchGithubRepoFileText(owner, repo, branch, file);
        const pointer = parseGithubLfsPointerText(text);
        if (pointer) {
          resolved.set(file.path, pointer);
        }
        completed += 1;
        setWorkProgress("Checking LFS files", completed, candidates.length, {
          currentText: String(completed),
          totalText: String(candidates.length)
        });
      }
    };
    const workers = [];
    const workerCount = Math.min(GITHUB_LFS_LOOKUP_CONCURRENCY, candidates.length);
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    if (resolved.size) {
      console.info("LFS: resolved object sizes for " + resolved.size + " file(s) before download");
    }
    return resolved;
  }

// Binary media can be persisted as soon as it downloads; text stays pending for patching.
function isStreamablePath(path) {
    return /\.(?:mp4|webm|ogg|ogv|mov|mkv|png|jpe?g|gif|webp|avif|mp3|wav|flac|m4a)$/i.test(String(path || ""));
}

async function fetchLatestGithubReleaseInfo(owner, repo, preferredAssetName) {
    const apiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/releases/latest";
    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: githubApiHeaders()
    });
    const releaseRateLimitErr = checkGithubResponseRateLimit(response);
    if (releaseRateLimitErr) {
      throw releaseRateLimitErr;
    }
    if (!response.ok) {
      const extra = response.status === 404 ? " No latest release found for this repo." : "";
      throw new Error("GitHub release lookup failed (" + response.status + ")." + extra);
    }
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const preferredName = String(preferredAssetName || "").trim();
    let asset = null;
    if (preferredName) {
      asset = assets.find((entry) => String(entry && entry.name || "") === preferredName) || null;
    }
    if (!asset) {
      asset = assets.find((entry) => /\.zip$/i.test(String(entry && entry.name || ""))) || null;
    }
    if (!asset || !asset.browser_download_url) {
      throw new Error("Latest release has no .zip asset.");
    }
    const downloadUrl = toHttpUrl(asset.browser_download_url);
    if (!downloadUrl) {
      throw new Error("Latest release ZIP URL is invalid.");
    }
    return {
      provider: "github-release",
      owner,
      repo,
      releaseTag: String(release.tag_name || ""),
      releaseId: Number(release.id) || 0,
      assetId: Number(asset.id) || 0,
      assetName: String(asset.name || ""),
      assetUpdatedAt: Number(Date.parse(asset.updated_at || "")) || 0,
      downloadUrl,
      etag: "",
      lastModified: "",
      lastCheckedAt: Date.now()
    };
  }

async function fetchGithubRepoTreeSnapshot(owner, repo, branchHint) {
    const branchCandidate = String(branchHint || "").trim();
    let branch = branchCandidate;
    if (!branch) {
      const repoApiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
      const repoResponse = await fetch(repoApiUrl, {
        cache: "no-store",
        headers: githubApiHeaders()
      });
      const repoRateLimitErr = checkGithubResponseRateLimit(repoResponse);
      if (repoRateLimitErr) {
        throw repoRateLimitErr;
      }
      if (!repoResponse.ok) {
        throw new Error("GitHub repo lookup failed (" + repoResponse.status + ").");
      }
      const repoInfo = await repoResponse.json();
      branch = String(repoInfo.default_branch || "").trim();
      if (!branch) {
        throw new Error("Could not determine repo default branch.");
      }
    }
    const treeApiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/git/trees/" + encodeURIComponent(branch) + "?recursive=1";
    const treeResponse = await fetch(treeApiUrl, {
      cache: "no-store",
      headers: githubApiHeaders()
    });
    const treeRateLimitErr = checkGithubResponseRateLimit(treeResponse);
    if (treeRateLimitErr) {
      throw treeRateLimitErr;
    }
    if (!treeResponse.ok) {
      throw new Error("GitHub tree lookup failed (" + treeResponse.status + ").");
    }
    const tree = await treeResponse.json();
    const treeSha = String(tree.sha || "").trim();
    const rawEntries = Array.isArray(tree.tree) ? tree.tree : [];
    const fileEntries = rawEntries
      .filter((entry) => entry && entry.type === "blob" && typeof entry.path === "string" && entry.path)
      .map((entry) => {
        const sha = String(entry.sha || "").trim();
        const apiBlobUrl = sha
          ? (
              "https://api.github.com/repos/" +
              encodeURIComponent(owner) + "/" +
              encodeURIComponent(repo) +
              "/git/blobs/" +
              encodeURIComponent(sha)
            )
          : "";
        return {
          path: normalizePath(entry.path),
          url: toHttpUrl(entry.url || "") || toHttpUrl(apiBlobUrl),
          sha,
          size: Number(entry.size) || 0
        };
      })
      .filter((entry) => entry.path && entry.url);
    if (!treeSha) {
      throw new Error("GitHub tree response missing SHA.");
    }
    if (!fileEntries.length) {
      throw new Error("Repository has no file blobs to import.");
    }
    return {
      owner,
      repo,
      branch,
      treeSha,
      fileEntries
    };
  }

async function buildZipFileFromGithubTree(snapshot, labelPrefix) {
    const entries = await downloadGithubTreeEntries(snapshot, labelPrefix);
    const zipBlob = createZipStoreArchive(entries);
    const fileName = String(snapshot.repo || "github-repo") + ".zip";
    return new File([zipBlob], fileName, { type: "application/zip" });
  }

async function downloadGithubTreeEntries(snapshot, labelPrefix) {
  // third arg may be a function or an options object:
  // downloadGithubTreeEntries(snapshot, label, onFile)
  // or downloadGithubTreeEntries(snapshot, label, { onFile, prioritizeSmallest, skipPatterns })
  const third = arguments.length >= 3 ? arguments[2] : null;
  let onFile = null;
  let prioritizeSmallest = false;
  let skipPatterns = [];
  let lfsDiscoveryEntries = null;
  let presetLfsSizes = null;
  if (typeof third === 'function') {
    onFile = third;
  } else if (third && typeof third === 'object') {
    onFile = typeof third.onFile === 'function' ? third.onFile : null;
    prioritizeSmallest = !!third.prioritizeSmallest;
    skipPatterns = Array.isArray(third.skipPatterns) ? third.skipPatterns.slice() : [];
    lfsDiscoveryEntries = Array.isArray(third.lfsEntries) ? third.lfsEntries : null;
    // A caller may have resolved LFS sizes already (e.g. to size the large-import warning).
    presetLfsSizes = third.lfsSizes instanceof Map ? third.lfsSizes : null;
  }

  const entries = [];
  const filesOrig = Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries.slice() : [];
  const owner = String(snapshot && snapshot.owner || "").trim();
  const repo = String(snapshot && snapshot.repo || "").trim();
  const branch = String(snapshot && snapshot.branch || "").trim();
  const progressLabel = String(labelPrefix || "Downloading repo files");

  const defaultSkipNames = {".gitignore": true, ".gitattributes": true, ".gitmodules": true};
  const shouldSkip = (p) => {
    const parts = String(p || "").split('/');
    const base = parts[parts.length - 1] || "";
    if (defaultSkipNames[base]) return true;
    for (const pat of skipPatterns) {
      try {
        const re = (pat instanceof RegExp) ? pat : new RegExp(pat);
        if (re.test(p)) return true;
      } catch (e) {}
    }
    return false;
  };

  let files = filesOrig.filter(f => !shouldSkip(f.path));

  // LFS files ship a ~130 byte pointer in the tree, so the sizes above are far smaller than
  // the payload. Resolve the real object sizes first so the progress total is correct and
  // stable from the first byte instead of growing as pointers are discovered.
  let lfsObjects = new Map();
  if (presetLfsSizes) {
    // Reuse the caller's resolution instead of probing every pointer file a second time.
    lfsObjects = presetLfsSizes;
  } else {
    try {
      lfsObjects = await resolveGithubLfsObjectSizes(snapshot, files, lfsDiscoveryEntries);
    } catch (error) {
      console.warn("LFS: size pre-check failed; progress sizes may adjust during download", error);
      lfsObjects = new Map();
    }
  }
  const sizeFor = (file) => {
    const lfs = lfsObjects.get(file && file.path);
    if (lfs && lfs.size > 0) {
      return lfs.size;
    }
    const declared = Number(file && file.size);
    return Number.isFinite(declared) && declared >= 0 ? declared : null;
  };

  if (prioritizeSmallest) {
    const INF = Number.MAX_SAFE_INTEGER;
    files.sort((a, b) => {
      const as = sizeFor(a);
      const bs = sizeFor(b);
      return (as === null ? INF : as) - (bs === null ? INF : bs);
    });
  }

  const hasKnownSizes = files.every((file) => sizeFor(file) !== null);
  // Bytes the progress total accounts for, per file. Corrections rewrite a file's budget
  // rather than adding to the total, so the same file can never be counted twice.
  const budgetedSizes = new Map();
  let totalBytes = 0;
  if (hasKnownSizes) {
    for (const file of files) {
      const size = sizeFor(file);
      budgetedSizes.set(file.path, size);
      totalBytes += size;
    }
  }
  let downloadedBytes = 0;
  const setFileBudget = (path, size) => {
    const actual = Number(size || 0);
    if (!(actual > 0)) {
      return;
    }
    const previous = budgetedSizes.get(path) || 0;
    if (previous === actual) {
      return;
    }
    budgetedSizes.set(path, actual);
    totalBytes += actual - previous;
  };
  const updateProgress = (fileIndex) => {
    if (downloadedBytes > totalBytes) {
      totalBytes = downloadedBytes;
    }
    const fileSuffix = files.length > 0
      ? " (" + (fileIndex + 1) + "/" + files.length + ")"
      : "";
    if (totalBytes > 0) {
      setWorkProgress(
        progressLabel + fileSuffix,
        downloadedBytes,
        totalBytes,
        {
          currentText: formatBytes(downloadedBytes),
          totalText: formatBytes(totalBytes)
        }
      );
    } else {
      setWorkProgress(progressLabel + fileSuffix + " (" + formatBytes(downloadedBytes) + ")", 0, 0);
    }
  };
  updateProgress(0);
  setWorkProgressTree(0, files.length, "", files.map(function(f) { return f.path; }));

    const fetchBytesStreaming = async (fileMeta, fileIndex) => {
      const rawUrl = owner && repo && branch
        ? "https://raw.githubusercontent.com/" +
          encodeURIComponent(owner) + "/" +
          encodeURIComponent(repo) + "/" +
          encodeURIComponent(branch) + "/" +
          fileMeta.path.split("/").map(encodeURIComponent).join("/")
        : "";

      if (!rawUrl) {
        throw new Error("Cannot build raw URL for " + fileMeta.path);
      }

      const streamResponseToUint8Array = async (response, fileIndex) => {
        if (!response || !response.body || typeof response.body.getReader !== "function") {
          const buf = await response.arrayBuffer();
          const bytes = new Uint8Array(buf);
          downloadedBytes += bytes.length;
          updateProgress(fileIndex);
          return bytes;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            totalLength += value.byteLength;
            downloadedBytes += value.byteLength;
            updateProgress(fileIndex);
          }
        }
        const out = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return out;
      };

      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          // raw.githubusercontent.com first: it does not spend the anonymous API quota, so a repo
          // import costs one tree request instead of one request per file. The blob API stays as the
          // retry path, which also covers files raw declines to serve. Repo archives are not an
          // option: codeload only allows https://render.githubusercontent.com to read them, so a
          // zipball download always fails from this page.
          if (fileMeta && fileMeta.sha && attempt > 1) {
            try {
              const blobApi =
                "https://api.github.com/repos/" + encodeURIComponent(owner) +
                "/" + encodeURIComponent(repo) +
                "/git/blobs/" + encodeURIComponent(fileMeta.sha);
              const blobResp = await fetch(blobApi, {
                cache: "no-store",
                headers: githubApiHeaders({ Accept: "application/vnd.github.raw+json" })
              });
              if (blobResp && blobResp.ok) {
                const blobBytes = await streamResponseToUint8Array(blobResp, fileIndex);
                const probeText = (() => {
                  try {
                    return new TextDecoder().decode(blobBytes.slice(0, 256));
                  } catch {
                    return "";
                  }
                })();

                if (probeText.startsWith("version https://git-lfs.github.com/spec/v1")) {
                  // The pointer file is not part of the payload; the object budget covers this file.
                  downloadedBytes = Math.max(0, downloadedBytes - blobBytes.length);
                  const oidMatch = probeText.match(/oid sha256:([a-f0-9]{64})/i);
                  const sizeMatch = probeText.match(/size (\d+)/i);
                  const oid = oidMatch ? oidMatch[1] : "";
                  const size = sizeMatch ? Number(sizeMatch[1]) : (fileMeta.size || 0);
                  console.info("LFS: pointer detected via raw blob API for", fileMeta.path, { oid, size });

                  try {
                    const mediaUrl = owner && repo && branch
                      ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                      : null;
                    if (mediaUrl) {
                      console.debug("LFS: attempting media.githubusercontent.com fallback", mediaUrl);
                      const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                      if (mediaResp && mediaResp.ok) {
                        const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                        if (mediaLength > 0) {
                          setFileBudget(fileMeta.path, mediaLength);
                          updateProgress(fileIndex);
                        }
                        const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                        console.info("LFS: media.githubusercontent.com returned object for", fileMeta.path);
                        setFileBudget(fileMeta.path, mediaBytes.length);
                        updateProgress(fileIndex);
                        return mediaBytes;
                      }
                    }
                  } catch (mediaErr) {
                    console.debug("LFS: media fallback failed", mediaErr);
                  }

                  const batchJson = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                  const curlCmd = "curl -s -X POST 'https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch' -H 'Accept: application/vnd.git-lfs+json' -H 'Content-Type: application/json' -d '" + batchJson.replace(/'/g, "'\\''") + "'" + " | jq -r '.objects[0].actions.download.href'";
                  throw new Error(
                    "Git LFS pointer detected for '" + fileMeta.path + "' (oid=" + oid + ", size=" + size + ").\n" +
                    "CORS prevents the browser from calling the Git LFS batch API.\n" +
                    "You can run this command locally to get the presigned download URL:\n" +
                    curlCmd
                  );
                }

                // Non-LFS raw blob: this is the true file bytes. Avoid the extra raw.githubusercontent.com fetch.
                return blobBytes;
              }
            } catch (e) {
              // ignore API errors and fall back to raw fetch
            }
          }

          const res = await fetch(rawUrl, { cache: "no-store" });
          const rateLimitErr = checkGithubResponseRateLimit(res);
          if (rateLimitErr) {
            throw rateLimitErr;
          }
          if (!res.ok) {
            throw new Error("HTTP " + res.status + " for " + fileMeta.path);
          }
          if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            // Probe the first chunk to detect LFS pointer
            const firstRead = await reader.read();
            if (firstRead && !firstRead.done && firstRead.value) {
              try {
                const probeBytes = firstRead.value;
                const contentType = String(res.headers.get("content-type") || "").toLowerCase();
                // GitHub types a raw response from the file extension, so an LFS pointer for a .zip
                // comes back as application/zip while a .pck pointer comes back as text/plain. A
                // type-only gate therefore stored whole classes of LFS-tracked files as their ~130
                // byte pointer. Pointers are tiny, so probe any small first chunk whatever the type.
                const mayBePointer =
                  probeBytes.byteLength <= 1024 ||
                  contentType.includes("text") ||
                  contentType.includes("application/octet-stream") ||
                  contentType.includes("application/x-git-lfs");
                if (mayBePointer) {
                  const probeText = (() => {
                    try { return new TextDecoder().decode(probeBytes); } catch { return ""; }
                  })();
                  if (probeText.startsWith("version https://git-lfs.github.com/spec/v1")) {
                    // Parse pointer
                    const oidMatch = probeText.match(/oid sha256:([a-f0-9]{64})/i);
                    const sizeMatch = probeText.match(/size (\d+)/i);
                    if (oidMatch) {
                      const oid = oidMatch[1];
                      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
                      console.info("LFS: detected pointer in repo file", fileMeta.path, { oid, size });
                      if (size > 0) {
                        setFileBudget(fileMeta.path, size);
                        updateProgress(fileIndex);
                      }

                      // derive owner/repo/branch from snapshot
                      const rawUrl = owner && repo && branch
                        ? "https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                        : null;
                      if (rawUrl) {
                        // Try media.githubusercontent.com before calling batch API (some media URLs serve real object)
                        try {
                          const mediaUrl = "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/");
                          console.debug("LFS: attempting media.githubusercontent.com fallback for repo file", mediaUrl);
                          const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                          if (mediaResp && mediaResp.ok) {
                            const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                            if (mediaLength > 0) {
                              setFileBudget(fileMeta.path, mediaLength);
                              updateProgress(fileIndex);
                            }
                            const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                            console.info("LFS: media.githubusercontent.com returned object for repo file", fileMeta.path);
                            setFileBudget(fileMeta.path, mediaBytes.length);
                            updateProgress(fileIndex);
                            return mediaBytes;
                          }
                        } catch (mediaErr) {
                          console.debug("LFS: media fallback failed for repo file", mediaErr);
                        }

                        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
                        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                        try {
                          console.debug("LFS: calling batch API for repo file", batchUrl);
                          const batchResp = await fetch(batchUrl, {
                            method: "POST",
                            headers: { Accept: "application/vnd.git-lfs+json", "Content-Type": "application/json" },
                            body: batchBody
                          });
                          if (batchResp && batchResp.ok) {
                            const batchJson = await batchResp.json();
                            const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
                            const downloadAction = actions && (actions.download || actions.get);
                            if (downloadAction && downloadAction.href) {
                              console.info("LFS: obtained download href for repo file", downloadAction.href);
                              const objResp = await fetch(downloadAction.href, { cache: "no-store", redirect: "follow" });
                              if (objResp && objResp.ok) {
                                const objBytes = await streamResponseToUint8Array(objResp, fileIndex);
                                setFileBudget(fileMeta.path, objBytes.length);
                                updateProgress(fileIndex);
                                return objBytes;
                              }
                            }
                          }
                        } catch (e) {
                          console.error("LFS batch/download failed for repo file", e);
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("LFS probe error for", fileMeta.path, e);
              }
            }

            // No LFS pointer handling or failed — continue streaming including first chunk
            const chunks = [];
            let fileBytes = 0;
            if (firstRead && firstRead.value) {
              chunks.push(firstRead.value);
              fileBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              downloadedBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              updateProgress(fileIndex);
            }
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                chunks.push(value);
                fileBytes += value.byteLength;
                downloadedBytes += value.byteLength;
                updateProgress(fileIndex);
              }
            }
            const out = new Uint8Array(fileBytes);
            let offset = 0;
            for (const chunk of chunks) {
              out.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return out;
          }
          const buf = await res.arrayBuffer();
          downloadedBytes += buf.byteLength;
          updateProgress(fileIndex);
          return new Uint8Array(buf);
        } catch (err) {
          lastError = err;
          if (isGithubRateLimitError(err)) {
            throw err;
          }
          // undo any bytes counted before the retry
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
      }
      throw lastError || new Error("Failed to download file " + fileMeta.path);
    };

    for (let i = 0; i < files.length; i += 1) {
      const fileMeta = files[i];
      setWorkProgressTree(i, files.length, fileMeta.path);
      const bytes = await fetchBytesStreaming(fileMeta, i);
      if (onFile) {
        try {
          await onFile(fileMeta, bytes, i);
        } catch (e) {
          // ensure failures in a user callback don't break the overall download loop
          console.error('onFile callback failed for', fileMeta.path, e);
        }
      } else {
        entries.push({
          path: fileMeta.path,
          bytes
        });
      }
      setWorkProgressTree(i + 1, files.length, fileMeta.path);
    }
    setWorkProgressTree(files.length, files.length, "");
    return entries;
  }

async function downloadGithubRepoSnapshotZip(snapshot, label) {
    return buildZipFileFromGithubTree(snapshot, label || "Downloading repo files");
  }

async function downloadGithubReleaseZip(sourceMeta, label) {
    const source = sourceMeta && typeof sourceMeta === "object" ? sourceMeta : null;
    const primaryUrl = toHttpUrl(source && source.downloadUrl ? source.downloadUrl : "");
    let primaryError = null;
    if (primaryUrl) {
      try {
        return await downloadZipFromUrl(primaryUrl, label);
      } catch (error) {
        primaryError = error;
        console.error(error);
      }
    }
    const owner = String(source && source.owner || "").trim();
    const repo = String(source && source.repo || "").trim();
    const assetId = Number(source && source.assetId) || 0;
    if (!owner || !repo || !assetId) {
      throw primaryError || new Error("Release ZIP download failed and no api.github.com asset id is available.");
    }
    log("Direct github.com download failed; retrying release asset via api.github.com...");
    const apiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/releases/assets/" +
      encodeURIComponent(String(assetId));
    return downloadZipFromUrl(apiUrl, label, {
      headers: githubApiHeaders({
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28"
      }),
      skipHead: true,
      fileNameHint: String(source.assetName || "") || (repo + "-release.zip")
    });
  }

async function fetchZipHeadInfo(url, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const headers = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    const response = await fetch(normalizedUrl, {
      method: "HEAD",
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      throw new Error("HEAD request failed (" + response.status + ").");
    }
    return {
      url: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || ""),
      contentLength: Number(response.headers.get("content-length")) || 0
    };
  }

async function downloadZipFromUrl(url, label, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const requestHeaders = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    let expectedTotal = 0;
    if (!opts.skipHead) {
      try {
        const head = await fetchZipHeadInfo(normalizedUrl, { headers: requestHeaders });
        expectedTotal = Number(head.contentLength) || 0;
      } catch {
        expectedTotal = 0;
      }
    }
    const response = await fetch(normalizedUrl, {
      cache: "no-store",
      headers: requestHeaders,
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error("Download failed (" + response.status + ").");
    }
    const contentLength = Number(response.headers.get("content-length")) || 0;
    const total = contentLength || expectedTotal;
    const fileNameHint = String(opts.fileNameHint || "").trim();
    const reader = response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
    // Try LFS pointer handling before streaming the whole response
    if (reader) {
      const lfsResult = await tryHandleLfsPointer();
      if (lfsResult && lfsResult.file) {
        // We obtained the real object packaged as a file/zip
        return lfsResult;
      }
      var probeChunk = lfsResult && lfsResult.probeChunk ? lfsResult.probeChunk : null;
    }
    // Detect Git LFS pointer files served from raw.githubusercontent.com and
    // automatically fetch the real object via the Git LFS batch API when possible.
    async function tryHandleLfsPointer() {
      try {
        console.debug("LFS: trying to detect pointer for", normalizedUrl);
        // Only attempt when response looks textual or small
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text") && !contentType.includes("application/octet-stream") && !contentType.includes("application/x-git-lfs")) {
          console.debug("LFS: skipping due to content-type", contentType);
          return null;
        }
        // Read a small prefix to detect pointer
        const probe = reader ? await reader.read() : null;
        if (!probe || probe.done || !probe.value) {
          if (probe && probe.done) {
            console.debug("LFS: stream ended before probe");
            return null;
          }
          console.debug("LFS: no probe data available");
          return null;
        }
        const firstBytes = probe.value;
        const text = (() => {
          try {
            return new TextDecoder().decode(firstBytes);
          } catch (e) {
            console.debug("LFS: decode error", e && e.message);
            return "";
          }
        })();
        if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) {
          // Not an LFS pointer, push the chunk back to stream by returning it
          console.debug("LFS: not a pointer; first bytes:", text.slice(0, 200));
          return { probeChunk: firstBytes };
        }

        // Parse pointer
        const oidMatch = text.match(/oid sha256:([a-f0-9]{64})/i);
        const sizeMatch = text.match(/size (\d+)/i);
        if (!oidMatch) {
          console.debug("LFS: pointer missing oid");
          return null;
        }
        const oid = oidMatch[1];
        const size = sizeMatch ? Number(sizeMatch[1]) : 0;
        console.info("LFS: detected pointer", { oid, size });

        // Attempt to extract owner/repo from raw.githubusercontent.com URL
        const rawMatch = normalizedUrl.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
        if (!rawMatch) {
          console.debug("LFS: could not parse owner/repo from URL");
          return null;
        }
        const owner = rawMatch[1];
        const repo = rawMatch[2];
        const branch = rawMatch[3];

        const branchUrl = owner && repo && branch
          ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + normalizedUrl.split("/").slice(5).map(encodeURIComponent).join("/")
          : null;
        if (branchUrl) {
          try {
            console.debug("LFS: attempting media.githubusercontent.com fallback for direct URL", branchUrl);
            const mediaResp = await fetch(branchUrl, { cache: "no-store", redirect: "follow" });
            if (mediaResp && mediaResp.ok) {
              const mediaSize = Number(mediaResp.headers.get("content-length")) || size || 1;
              setWorkProgress("Downloading LFS object", 0, mediaSize);
              const mediaBuf = await mediaResp.arrayBuffer();
              console.info("LFS: media.githubusercontent.com returned object for direct URL");
              const mediaBytes = new Uint8Array(mediaBuf);
              if (mediaBytes.length > size) {
                setWorkProgress("Downloading LFS object", mediaBytes.length, mediaSize);
              }
              const pathParts = normalizedUrl.split("/");
              const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");
              if (mediaBytes.length >= 4 && mediaBytes[0] === 0x50 && mediaBytes[1] === 0x4b && mediaBytes[2] === 0x03 && mediaBytes[3] === 0x04) {
                return {
                  file: new File([mediaBytes], fileName, { type: "application/zip" }),
                  resolvedUrl: branchUrl,
                  etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                  lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
                };
              }
              const zipBytes = createZipStoreArchive([{ path: fileName, bytes: mediaBytes }]);
              return {
                file: new File([zipBytes], fileName + ".zip", { type: "application/zip" }),
                resolvedUrl: branchUrl,
                etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
              };
            }
          } catch (mediaErr) {
            console.debug("LFS: direct media fallback failed", mediaErr);
          }
        }

        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
        console.debug("LFS: calling batch API", batchUrl);
        const batchResp = await fetch(batchUrl, {
          method: "POST",
          headers: {
            Accept: "application/vnd.git-lfs+json",
            "Content-Type": "application/json"
          },
          body: batchBody
        });
        if (!batchResp.ok) {
          console.debug("LFS: batch API failed", batchResp.status);
          return null;
        }
        const batchJson = await batchResp.json();
        const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
        const downloadAction = actions && (actions.download || actions.get);
        if (!downloadAction || !downloadAction.href) {
          console.debug("LFS: no download action in batch response");
          return null;
        }
        const downloadHref = downloadAction.href;
        console.info("LFS: obtained download href", downloadHref);

        const objResp = await fetch(downloadHref, { cache: "no-store", redirect: "follow" });
        if (!objResp.ok) throw new Error("LFS object download failed (" + objResp.status + ")");
        const objSize = Number(objResp.headers.get("content-length")) || size || 1;
        setWorkProgress("Downloading LFS object", 0, objSize);
        const objBuf = await objResp.arrayBuffer();
        const objBytes = new Uint8Array(objBuf);

        if (objBytes.length !== objSize) {
          setWorkProgress("Downloading LFS object", objBytes.length, objSize);
        }

        // Determine filename from original path
        const pathParts = normalizedUrl.split("/");
        const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");

        // If the object is already a ZIP, return it; otherwise package into a ZIP
        if (objBytes.length >= 4 && objBytes[0] === 0x50 && objBytes[1] === 0x4b && objBytes[2] === 0x03 && objBytes[3] === 0x04) {
          console.info("LFS: downloaded zip object, returning as zip");
          return {
            file: new File([objBytes], fileName, { type: "application/zip" }),
            resolvedUrl: downloadHref,
            etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""),
            lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "")
          };
        }

        // Create a simple zip with the single file using createZipStoreArchive
        console.info("LFS: wrapping object into zip", fileName);
        const zipBytes = createZipStoreArchive([{ path: fileName, bytes: objBytes }]);
        const zipFile = new File([zipBytes], fileName + ".zip", { type: "application/zip" });
        return { file: zipFile, resolvedUrl: downloadHref, etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""), lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "") };
      } catch (error) {
        // If anything fails, don't block normal download flow
        console.error("LFS detection/fetch failed:", error);
        return null;
      }
    }
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      setWorkProgress(label || "Downloading ZIP", bytes.byteLength, bytes.byteLength || 1);
      let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
      if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
        fileName = fileNameHint;
      }
      const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
      return {
        file: new File([bytes], outName, { type: "application/zip" }),
        resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
        etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
        lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
      };
    }

    let loaded = 0;
    let lastReported = 0;
    const chunks = [];
    if (probeChunk) {
      chunks.push(probeChunk);
      loaded += probeChunk.byteLength || probeChunk.length || 0;
    }
    setWorkProgress(label || "Downloading ZIP", 0, total > 0 ? total : 0);
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      const chunk = part.value;
      if (!chunk) {
        continue;
      }
      chunks.push(chunk);
      loaded += chunk.byteLength;
      if (loaded - lastReported >= 262144 || (total > 0 && loaded >= total)) {
        if (total > 0) {
          setWorkProgress(label || "Downloading ZIP", loaded, total);
        } else {
          setWorkProgress((label || "Downloading ZIP") + " (" + formatBytes(loaded) + ")", 0, 0);
        }
        lastReported = loaded;
      }
    }
    if (total > 0) {
      setWorkProgress(label || "Downloading ZIP", loaded, total);
    } else {
      setWorkProgress(label || "Download complete", loaded || 1, loaded || 1);
    }
    const blob = new Blob(chunks, { type: "application/zip" });
    let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
    if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
      fileName = fileNameHint;
    }
    const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
    return {
      file: new File([blob], outName, { type: "application/zip" }),
      resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
    };
  }

function githubReleaseHasUpdate(previousSource, latestSource) {
    const prev = normalizeGithubSource(previousSource);
    const next = normalizeGithubSource(latestSource);
    if (!prev || !next || prev.provider !== "github-release" || next.provider !== "github-release") {
      return false;
    }
    if (prev.assetId && next.assetId) {
      return prev.assetId !== next.assetId;
    }
    if (prev.releaseTag && next.releaseTag) {
      return prev.releaseTag !== next.releaseTag;
    }
    if (prev.assetUpdatedAt && next.assetUpdatedAt) {
      return next.assetUpdatedAt > prev.assetUpdatedAt;
    }
    return prev.downloadUrl !== next.downloadUrl;
  }

function zipUrlHasUpdate(previousSource, remoteHeadInfo) {
    const prev = normalizeGithubSource(previousSource);
    if (!prev || prev.provider !== "zip-url") {
      return false;
    }
    const nextEtag = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.etag ? remoteHeadInfo.etag : "");
    const nextLastModified = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.lastModified ? remoteHeadInfo.lastModified : "");
    if (prev.etag && nextEtag) {
      return prev.etag !== nextEtag;
    }
    if (prev.lastModified && nextLastModified) {
      return prev.lastModified !== nextLastModified;
    }
    return false;
  }
