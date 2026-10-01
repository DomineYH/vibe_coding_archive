# EduVibe Archive frontend

Run frontend commands from this directory. The pinned toolchain is Node 22.23.2 and npm 12.0.2.

```sh
npm ci
npm run dev
```

`dev` starts the deterministic, development-only mock at `http://localhost:5173`. The public gallery and detail use the same OpenAPI types and response mappers as the API build. The API build calls `/api/v1` and does not fall back to mock data; no backend is included in this phase.

```sh
npm run check
npm test -- tests/mappers.test.ts
npm test
npm run test:e2e
FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell-151 npm run test:visual
npm run build:mock
npm run build
npm run check:dist
npm run check:reference
```

`npm run build` creates the API-only `dist/`; `npm run build:mock` creates the development demo at `dist-mock/`. Neither command updates the visual reference files. `npm run mock:reset` prints the browser URL for the mock storage page. The mock state is reset only after the explicit button is used there.

The visual comparison uses the exact Chromium 151.0.7922.34 headless-shell binary used by the source evidence. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path and `FONTCONFIG_FILE` to the absolute path shown above; preflight fails if the browser or source font differs.

### T01 API preparation boundary

`npm run test:e2e:api` migrates one temporary SQLite database, inserts synthetic
fixtures once, then runs the ordinary API regressions and the prepared auth
boundary in separate server lifetimes against that same file. The prepared
factory is test-only (`APP_ENV=test`); member login remains unavailable and the
ordinary app's authentication capabilities remain false.

`npm run test:e2e:api -- e2e-api/auth-prepare.spec.js` runs only the prepared
boundary. Add `--auth-unavailable` to exercise the ordinary disabled boundary.
For fixed-renderer evidence, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the same
Chromium 151.0.7922.34 headless shell used by the visual suite and set
`FONTCONFIG_FILE` to `visual/fontconfig.conf`. New preparation/failure captures
are observations, not new or regenerated visual baselines.
