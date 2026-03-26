A launcher to load ZIP archives with wasm files and other CORS-protected files and convert them into blobs to launch on the file:// protocol.

Development entrypoint: `index.dev.html` (loads `src/styles.css` and the `src/` scripts).

Bundle to the single-file launcher:

`python scripts/build_bundle.py`

Minified single-file bundle:

`python scripts/build_bundle.py --minify --out dist/index.min.html`

The GitHub Actions workflow `Build Launcher Bundles` runs the same script, uploads both the debug and minified bundles, and attaches them to releases.
