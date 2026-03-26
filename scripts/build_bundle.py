#!/usr/bin/env python3
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEV_HTML = ROOT / "index.html"
CSS_PATH = ROOT / "src" / "styles.css"


def read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def minify_css(css: str) -> str:
    # Safe-ish CSS minification: strip comments and collapse whitespace.
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([:{};,>])\s*", r"\1", css)
    return css.strip() + "\n"


def minify_js(js: str) -> str:
    # JS minification is intentionally disabled because template literals and
    # embedded HTML rely on exact whitespace/newlines.
    return js


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bundle index.dev.html into a single-file launcher.")
    parser.add_argument("--minify", action="store_true", help="Minify CSS/JS when bundling.")
    parser.add_argument("--out", default=str(ROOT / "index.html"), help="Output HTML path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not DEV_HTML.exists():
        print("Missing index.html", file=sys.stderr)
        return 1
    if not CSS_PATH.exists():
        print("Missing src/styles.css", file=sys.stderr)
        return 1
    html = read_text(DEV_HTML)
    css = read_text(CSS_PATH).rstrip() + "\n"
    if args.minify:
        css = minify_css(css)

    link_pattern = r'<link\s+rel="stylesheet"\s+href="(\./(?:src/[^"]+|lib/[^"]+))"\s*/?>'
    script_pattern = r'<script\s+src="(\./(?:src|lib)/[^"]+)"\s*>\s*</script>'
    favicon_pattern = r'<link\s+rel="icon"\s+type="image/[^"]+"\s+href="(\./[^"]+)"\s*/?>'

    css_paths = re.findall(link_pattern, html)
    if not css_paths:
        print("Could not find stylesheet link tags in index.html", file=sys.stderr)
        return 1
    script_paths = re.findall(script_pattern, html)
    if not script_paths:
        print("Could not find script tags for ./src in index.html", file=sys.stderr)
        return 1

    css_chunks = []
    for href in css_paths:
        rel = href.replace("./", "")
        path = ROOT / rel
        if not path.exists():
            print(f"Missing {path}", file=sys.stderr)
            return 1
        css_chunks.append(f"/* ---- {href} ---- */\n" + read_text(path).rstrip() + "\n")
    css = "\n".join(css_chunks).rstrip() + "\n"
    if args.minify:
        css = minify_css(css)

    js_chunks = []
    for src in script_paths:
        rel = src.replace("./", "")
        path = ROOT / rel
        if not path.exists():
            print(f"Missing {path}", file=sys.stderr)
            return 1
        js_chunks.append(f"// ---- {src} ----\n" + read_text(path).rstrip() + "\n")
    js = "\n".join(js_chunks).rstrip() + "\n"

    html = re.sub(link_pattern, "", html)
    html = html.replace("</head>", "<style>\n" + css + "</style>\n</head>", 1)
    if args.minify:
        js = minify_js(js)
    html = re.sub(script_pattern, "", html)
    marker = "</body>"
    if marker not in html:
        print("Could not find </body> to inject bundled script", file=sys.stderr)
        return 1
    html = html.replace(marker, "<script>\n" + js + "</script>\n</body>", 1)

    favicon_match = re.search(favicon_pattern, html)
    if favicon_match:
        favicon_rel = favicon_match.group(1).replace("./", "")
        favicon_path = ROOT / favicon_rel
        if favicon_path.exists():
            data = favicon_path.read_bytes()
            ext = favicon_path.suffix.lower().lstrip(".") or "png"
            data_url = f"data:image/{ext};base64," + data.decode("latin1")
            import base64
            data_url = f"data:image/{ext};base64," + base64.b64encode(data).decode("ascii")
            html = re.sub(favicon_pattern, f'<link rel="icon" type="image/{ext}" href="{data_url}">', html, count=1)

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
