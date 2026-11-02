A launcher to load ZIP archives with wasm files and other CORS-protected files and convert them into blobs to launch on the file:// protocol.

Development entrypoint: `index.dev.html` (loads `src/styles.css` and the `src/` scripts).

Bundle to the single-file launcher:

`node scripts/build_bundle.mjs`

Minified single-file bundle:

`node scripts/build_bundle.mjs --minify --out dist/index.min.html`

The GitHub Actions workflow `Build Launcher Bundles` runs the same script, uploads both the debug and minified bundles, and attaches them to releases.

GitHub API token (higher rate limits)

GitHub's API allows only 60 unauthenticated requests per hour per IP, which runs out quickly when importing repos or checking updates. Embed a personal access token to raise the limit to 5,000 requests per hour:

`GITHUB_API_TOKEN=ghp_... node scripts/build_bundle.mjs`

or pass it as a flag: `node scripts/build_bundle.mjs --github-token ghp_...`

You can also hard-code one directly by editing `BUILD_GITHUB_TOKEN` in `src/network/github.js`.

For CI-built release bundles, add a repository secret named `GH_API_TOKEN` — the build workflows pass it to the bundle automatically (builds without it stay unauthenticated).

**Warning:** the token is embedded in plain text in the built HTML file, so anyone who has the file can use it. Use a dedicated token with minimal (ideally no) scopes, and rotate it if the file gets shared.

Tested Games (Working)

| Game | Status |
| :---: | :---: |
| Escape Road City 2 | ✓ |
| Burrito Bison | ✓ |
| 10 Minutes Till Dawn | ✓ |
| Happy Wheels | ✓ |
| Cookie Clicker | ✓ |
| Sandboxels | ✓ |
| n-gon | ✓ |
| Turbowarp | ✓ |
| Drift Hunters | ✓ |
| sm64 | ✓ |
| a dance of fire and ice | ✓ |
| crossyroad | ✓ |
| Drive Mad | ✓ |
| Polytrack | ✓ |
| rocketpult | ✓ |
| bitlife | ✓ |
| Escape Road City | ✓ |
| Ultrakill | ✓ |
| Bad Piggies | ✓ |
| Clover Pit | ✓ |

Known issues

None.

Unsolvable Issues

- **SharedArrayBuffer** Simply not supported in the context of the launcher. One game that I know uses this is Terraria WASM by MercuryWorkshop. https://github.com/MercuryWorkshop/terraria-wasm