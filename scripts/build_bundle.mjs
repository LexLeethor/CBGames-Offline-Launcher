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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--minify") {
      minify = true;
    } else if (args[i] === "--out" && args[i + 1]) {
      out = args[++i];
    }
  }
  return { minify, out };
}

function collectMatches(html, re) {
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

function main() {
  const { minify, out } = parseArgs();

  if (!existsSync(DEV_HTML)) {
    console.error("Missing index.html");
    process.exit(1);
  }

  const outPath = resolve(out);
  if (outPath === DEV_HTML) {
    console.error(
      "Error: output path cannot be the same as the source index.html. Use --out to specify a different path."
    );
    process.exit(1);
  }

  let html = readFileSync(DEV_HTML, "utf8");

  const linkRe   = /<link\s+rel="stylesheet"\s+href="(\.\/(?:src|lib)\/[^"]+)"\s*\/?>/g;
  const scriptRe = /<script\s+src="(\.\/(?:src|lib)\/[^"]+)"\s*>\s*<\/script>/g;
  const faviconRe = /<link\s+rel="icon"\s+type="image\/[^"]+"\s+href="(\.\/[^"]+)"\s*\/?>/;

  // --- Inline CSS ---
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

  // --- Inline JS ---
  const scriptSrcs = collectMatches(html, scriptRe);
  if (!scriptSrcs.length) {
    console.error("Could not find script tags for ./src or ./lib in index.html");
    process.exit(1);
  }
  const jsChunks = scriptSrcs.map((src) => {
    const path = join(ROOT, src.replace("./", ""));
    if (!existsSync(path)) { console.error(`Missing ${path}`); process.exit(1); }
    return `// ---- ${src} ----\n${readFileSync(path, "utf8").trimEnd()}\n`;
  });
  const js = jsChunks.join("\n").trimEnd() + "\n";

  // --- Apply substitutions ---
  html = html.replace(/<link\s+rel="stylesheet"\s+href="(\.\/(?:src|lib)\/[^"]+)"\s*\/?>/g, "");
  html = html.replace("</head>", `<style>\n${css}</style>\n</head>`);

  html = html.replace(/<script\s+src="(\.\/(?:src|lib)\/[^"]+)"\s*>\s*<\/script>/g, "");
  if (!html.includes("</body>")) {
    console.error("Could not find </body> to inject bundled script");
    process.exit(1);
  }
  html = html.replace("</body>", `<script>\n${js}</script>\n</body>`);

  // --- Embed favicon as data URL ---
  const faviconMatch = faviconRe.exec(html);
  if (faviconMatch) {
    const faviconRel = faviconMatch[1].replace("./", "");
    const faviconPath = join(ROOT, faviconRel);
    if (existsSync(faviconPath)) {
      const ext = extname(faviconPath).slice(1).toLowerCase() || "png";
      const dataUrl = `data:image/${ext};base64,${readFileSync(faviconPath).toString("base64")}`;
      html = html.replace(faviconRe, `<link rel="icon" type="image/${ext}" href="${dataUrl}">`);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  console.log(`Wrote ${outPath}`);
}

main();
