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
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-151 npm run test:visual
npm run build:mock
npm run build
npm run check:dist
npm run check:reference
```

`npm run build` creates the API-only `dist/`; `npm run build:mock` creates the development demo at `dist-mock/`. Neither command updates the visual reference files. `npm run mock:reset` prints the browser URL for the mock storage page. The mock state is reset only after the explicit button is used there.

The visual comparison uses the exact Chromium 151.0.7922.34 binary required by the source evidence. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its full `chrome` executable path; the test fails if the browser version differs.
