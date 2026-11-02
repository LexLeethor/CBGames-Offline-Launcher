#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEV_HTML = resolve(ROOT, "index.html");

function minifyCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  css = css.replace(/\s+/g, " ");
  css = css.replace(/\s*([:{};,>])\s*/g, "$1");
  return css.trim() + "\n";
}

function parseArgs() {
  const args = process.argv.slice(2);
  let minify = false;
  let out = join(ROOT, "dist", "index.html");
  // GitHub API token to embed in the bundle (raises api.github.com rate limits).
  // The flag wins over the environment variable.
  let githubToken = String(process.env.GITHUB_API_TOKEN || "").trim();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--minify") {
      minify = true;
    } else if (args[i] === "--out" && args[i + 1]) {
      out = args[++i];
    } else if (args[i] === "--github-token" && args[i + 1]) {
      githubToken = String(args[++i] || "").trim();
    }
  }
  return { minify, out, githubToken };
}

function collectMatches(html, re) {
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

function main() {
  const { minify, out, githubToken } = parseArgs();

  if (githubToken && !/^[A-Za-z0-9_-]{8,255}$/.test(githubToken)) {
    console.error(
      "Error: GitHub token contains unexpected characters. " +
      "Expected letters, digits, underscores and dashes only."
    );
    process.exit(1);
  }

  if (!existsSync(DEV_HTML)) {
    console.error("Missing index.html");
    process.exit(1);
  }

  const outPath = resolve(out);
  if (outPath === DEV_HTML) {
    console.error(
      "Error: output path cannot be the same as the source index.html. " +
      "Use --out to specify a different path."
    );
    process.exit(1);
  }

  // HTML is always UTF-8 text — safe to decode.
  let html = readFileSync(DEV_HTML, "utf8");

  const linkRe    = /<link\s+rel="stylesheet"\s+href="(\.\/(?:src|lib)\/[^"]+)"\s*\/?>/g;
  const scriptRe  = /<script\s+src="(\.\/(?:src|lib)\/[^"]+)"\s*>\s*<\/script>/g;
  const faviconRe = /<link\s+rel="icon"\s+type="image\/[^"]+"\s+href="(\.\/[^"]+)"\s*\/?>/;

  // --- Inline CSS (always UTF-8 text) ---
  const cssHrefs = collectMatches(html, linkRe);
  if (!cssHrefs.length) {
    console.error("Could not find stylesheet link tags in index.html");
    process.exit(1);
  }
  const cssChunks = cssHrefs.map((href) => {
    const path = join(ROOT, href.replace("./", ""));
    if (!existsSync(path)) { console.error(`Missing ${path}`); process.exit(1); }
    return `/* ---- ${href} ---- */\n${readFileSync(path, "utf8").trimEnd()}\n`;
  });
  let css = cssChunks.join("\n").trimEnd() + "\n";
  if (minify) css = minifyCss(css);

  html = html.replace(/<link\s+rel="stylesheet"\s+href="(\.\/(?:src|lib)\/[^"]+)"\s*\/?>/g, "");
  html = html.replace("</head>", () => `<style>\n${css}</style>\n</head>`);

  // --- Inline JS as raw Buffers (some files may contain binary data) ---
  const scriptSrcs = collectMatches(html, scriptRe);
  if (!scriptSrcs.length) {
    console.error("Could not find script tags for ./src or ./lib in index.html");
    process.exit(1);
  }
  // --- Inline JS (handle encoding issues gracefully) ---
  const jsChunks = scriptSrcs.map((src) => {
    const path = join(ROOT, src.replace("./", ""));
    if (!existsSync(path)) { console.error(`Missing ${path}`); process.exit(1); }
    
    // Try to read as UTF-8; if it fails, encode as base64
    const buf = readFileSync(path);
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (e) {
      // Not valid UTF-8, encode as base64 and wrap in a way browsers can execute
      const b64 = buf.toString("base64");
      content = `// [Binary file - base64 encoded]\n(function(){ eval(atob('${b64}')); })();`;
    }
    content = content.replace(/<\/script/gi, "<\\/script");
    return `// ---- ${src} ----\n${content.trimEnd()}\n`;
  });
  let js = jsChunks.join("\n").trimEnd() + "\n";

  // --- Embed the GitHub API token placeholder replacement ---
  const TOKEN_PLACEHOLDER = "\"__GITHUB_TOKEN__\"";
  if (githubToken) {
    if (js.indexOf(TOKEN_PLACEHOLDER) === -1) {
      console.error("Warning: __GITHUB_TOKEN__ placeholder not found in bundle; token not embedded.");
    }
    js = js.split(TOKEN_PLACEHOLDER).join(JSON.stringify(githubToken));
    console.log("Embedded GitHub API token into bundle (value not printed).");
    console.log(
      "Warning: the token is readable by anyone who has this HTML file. " +
      "Use a dedicated minimal-scope token and rotate it if the file is shared."
    );
  }

  // Strip the script tags from the HTML text.
  html = html.replace(/<script\s+src="(\.\/(?:src|lib)\/[^"]+)"\s*>\s*<\/script>/g, "");

  // --- Embed favicon as data URL (text operation, safe) ---
  const faviconMatch = faviconRe.exec(html);
  if (faviconMatch) {
    const faviconRel = faviconMatch[1].replace("./", "");
    const faviconPath = join(ROOT, faviconRel);
    if (existsSync(faviconPath)) {
      const ext = extname(faviconPath).slice(1).toLowerCase() || "png";
      const dataUrl = `data:image/${ext};base64,${readFileSync(faviconPath).toString("base64")}`;
      html = html.replace(faviconRe, () => `<link rel="icon" type="image/${ext}" href="${dataUrl}">`);
    }
  }

  // Split HTML at </body> and inject the bundled script.
  const scriptTag = `<script>\n${js}</script>\n`;
  html = html.replace("</body>", () => `${scriptTag}</body>`);
  
  const output = Buffer.from(html, "utf8");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
  console.log(`Wrote ${outPath}`);
}

main();
