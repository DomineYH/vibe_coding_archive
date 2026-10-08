# Same-origin Nginx static serving (T01 / #196)

This is a local implementation handoff, not permission to publish. The production
API authentication gate remains #144; public TLS, HTTP/2, devices and host UID
proof belong to T12. Health execution stays disabled. T06 owns sanitized request
logging and retention; this initial template disables access logs and sends error
logs to `/dev/null`.

## Release and serving boundaries

Build in `frontend/` with `npm run build && npm run check:dist`. Copy **only** the
checked API `dist/` into a new immutable, physical release directory outside the
repository. Do not serve `dist-mock`, repository source, references, evidence,
DBs, backup files, operator configuration, blocklists or TLS private keys.
The checker rejects symlinks (including the dist root), mock/demo/Tweaks markers
and demo password records; it permits index.html, the Pretendard license and flat
CSS/JS/WOFF2 assets. Nginx also denies symlinks, dotfiles, operational suffixes,
source suffixes and mock/reference/evidence names before static/SPA regex rules.
Directory listings and arbitrary-route fallback are disabled.

| Path                                                                    | Handling                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/`, `/index.html`                                                      | Release index, `Cache-Control: no-store`                                                      |
| `/auth`, `/admin`, `/apps/new`, `/apps/:segment`, `/apps/:segment/edit` | Release index, optional trailing slash, no-store; existing UI/API authorization still applies |
| `/assets/<flat-name>.css`, `.js`, `.woff2`                              | Existing checked file only; missing file is 404                                               |
| `/licenses/Pretendard-OFL.txt`                                          | Exact existing license file                                                                   |
| `/api`, `/api/…`, `/healthz`, `/readyz`                                 | Upstream API, no URI replacement or HTML fallback                                             |
| `/docs`, `/redoc`, `/openapi.json`, unknown routes                      | 404                                                                                           |

A route segment is not restricted to UUID syntax. Dot/forbidden segments are
blocked; other malformed IDs reach the existing application error screen.
Nginx passes separate Set-Cookie fields, auth observation headers and API
Cache-Control unchanged, without proxy caching or cookie rewriting. An upstream
failure remains 502/504; it never selects mock data or release HTML for API paths.

## Render and validate

The template is `deploy/nginx/eduvibe.conf.template`. It is a complete standalone
configuration, independent of the distribution's default site. Prerequisites:
Node, Nginx with SSL support and `/etc/nginx/mime.types`; the test harness also
requires OpenSSL. CI installs Ubuntu 24.04 packages and records their versions.
Do not reload the apt-installed system service to run the isolated smoke.

Prepare a private JSON file with exactly these deployment values (paths are
examples, not operating values or new application environment settings):

```json
{
  "RELEASE_ROOT": "/srv/eduvibe/releases/release-196",
  "API_UPSTREAM": "127.0.0.1:8000",
  "SERVER_NAME": "archive.example.org",
  "HTTPS_AUTHORITY": "archive.example.org",
  "HTTP_PORT": "80",
  "HTTPS_PORT": "443",
  "TLS_CERTIFICATE": "/private/tls/fullchain.pem",
  "TLS_CERTIFICATE_KEY": "/private/tls/key.pem",
  "RUNTIME_ROOT": "/private/nginx/release-196"
}
```

Values are strings. The renderer accepts absolute normalized paths with ASCII
letters/numbers, `_`, `.`, `/`, `-`; quotes, whitespace, shell/config punctuation,
relative paths and traversal are rejected. The upstream must be loopback. The
HTTPS authority must match the configured server name and HTTPS port (omit the
port for 443). Missing/unknown/unresolved tokens fail; Nginx `$variables` survive.
The renderer refuses to overwrite an existing configuration.

```sh
# From frontend/, with private release/config/certificate paths already prepared:
node scripts/nginx-serving.mjs --render /private/nginx/release-196.conf < /private/deployment-values.json
mkdir -m 700 /private/nginx/release-196
nginx -p /private/nginx/release-196/ -c /private/nginx/release-196.conf -t
nginx -p /private/nginx/release-196/ -c /private/nginx/release-196.conf -g 'daemon off;'
```

Run the service under a dedicated host UID with read/traverse permission on the
release and no permission on the DB, deletion ledger, backups or other secrets.
Give the Nginx master only the required private-key access; keep the key outside
the release at mode 0600. Binding 80/443 and master/worker UID separation require
the host service's reviewed configuration. This same-user local harness does not
prove that separation. Release files must not be writable by the web service.
Do not use a symlink root or introduce aliases into the repository.

Validate a fresh immutable release and fresh config with `nginx -t` before
switching the host service. A failed check leaves the previous release/config
selected. Roll back only the compatible static/config selection; this procedure
does not migrate, seed, restore, downgrade or replace the database. Inspect
startup failures privately; do not publish raw configurations or diagnostics.

## Trusted proxy and Host boundary

Run the API on loopback only, with:

```sh
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1 --no-access-log
```

Use the already approved environment/DB/origin settings; set PUBLIC_ORIGIN to the
exact external HTTPS origin. Secure `__Host-` cookies and Origin/CSRF enforcement
remain backend policy. Do not expose port 8000 externally or allow untrusted
local processes into the trusted proxy boundary. Never trust `*` for forwarded
peers or teach backend rate limiting to parse arbitrary forwarded headers.

Unknown HTTP/TLS hosts receive 421. A recognized HTTP host redirects to the fixed
configured HTTPS authority, including its port, rather than reflecting Host.
The proxy fixes upstream Host, overwrites X-Forwarded-For/X-Real-IP with the direct
peer and X-Forwarded-Proto with the actual scheme, and removes incoming Forwarded.
The template uses a 2 s connect / 5 s read timeout; actual-host timing still needs
operating review.

## Header budget semantics

HTTP/1.1 uses `client_header_buffer_size 1` and
`large_client_header_buffers 2 8k` in all virtual hosts. The one-byte initial
buffer forces the request line into the counted large buffers. The request line,
complete field lines and unused packing tails share at most 16384 bytes. A field
line includes its name, colon, space, value and CRLF. Near 8192 bytes, parser and
final-CRLF space can cause rejection before the nominal boundary. Packing can
also reject an aggregate slightly below 16384. Fields are not split across
buffers. This is a fail-closed native-buffer limit, not an exact sum-of-values
quota. The default 1 KiB initial buffer plus two 8 KiB large buffers would leave
extra uncounted capacity, so that candidate is not used.

These conclusions follow the [Nginx buffer documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html#large_client_header_buffers)
and [1.24 request buffer allocation](https://github.com/nginx/nginx/blob/release-1.24.0/src/http/ngx_http_request.c).
They require CI wire confirmation against the recorded distribution version.
The smoke includes ordinary product cookies, an accepted ~12 KiB request with
four fields smaller than 4 KiB, single-field 8 KiB boundaries, aggregate 16 KiB
boundaries, varied order/count, fragmented writes, GET and side-effecting POST.
Rejections must carry the native Nginx error body (upstream errors are not intercepted); rejected POSTs must leave the flow count unchanged. Backend HeadersTooLarge is
an outbound health-probe response limit and does not limit these inbound headers.
HTTP/2 is deliberately not enabled or claimed by this template/harness.

## Verification and limits

```sh
cd frontend
npm test -- tests/check-dist.test.js tests/nginx-serving.test.js
npm run check
npm run build && npm run check:dist && npm run check:reference
npm run build:mock
# Explicitly provision the verified R15 blocklist first; no network acquisition here.
npm run test:e2e:api -- --nginx e2e-api/static-serving.spec.js
```

The runner checks tools and free ports (API 8000, HTTP 8080, HTTPS 8443), builds
and checks dist before copying, and creates a private temporary tree, test-only
DB/fixtures and one-day localhost SAN certificate. The key is 0600 and the tree 0700. Sentinel files/escaping links are added only to the copied release after
its byte-for-byte serving check. Normal API E2E excludes this spec; `--nginx`
refuses mixed fault/health/unavailable modes. Missing tools, startup failure and
zero selected tests fail the CI step loudly; no Vite fallback or skip-green.
Auth smoke records no traces/HAR/video/screenshots and removes only rate-limit
events absent from each test's prior snapshot. It starts no health worker and
creates no activation record. The final outage drill suspends/resumes only its
owned upstream process, and checks that the UI reports failure without
mock cards. Teardown stops owned processes before deleting temporary files.

| Evidence                                                                                        | Local/CI scope                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Dist exclusions and render/startup cleanup                                                      | Targeted Vitest, no nginx required                           |
| Built direct routes/reload/history, anonymous denial, byte serving, API/probes                  | Explicit HTTPS Nginx Playwright run in backend-api CI        |
| Raw forbidden targets, symlink/listing, Host/forwarded identity, cookies, header limits, outage | Same real-API Nginx run; never inferred from Vite            |
| Existing auth/create/edit/admin flows                                                           | Existing affected API E2E; full API regression remains in CI |
| Existing visual baselines                                                                       | Existing pinned CI visual suite, no baseline regeneration    |
| Public TLS, HTTP/2, devices, production UID/ingress isolation                                   | NOT RUN here; #144/T12                                       |

The work-order WSL has no nginx. Local Nginx execution is **NOT RUN**, with a
nonzero missing-tool diagnostic. Runtime RED/GREEN and release acceptance stay
pending actual CI execution; implemented assertions are not PASS evidence.

T06's [safe logging and local retention contract](logging-retention.md) supersedes the disabled-access-log and raw Uvicorn examples above: deployment render values now require private `LOG_ROOT`, and the supported API entrypoint is `python -m app.api`.
