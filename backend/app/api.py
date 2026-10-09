"""Supported API launcher: install the output boundary before loading the app."""

import sys

from app.safe_logging import SafeParser, emit, install


def run(app="app.main:app", *, host="127.0.0.1", port=8000):
    install()
    try:
        import uvicorn

        uvicorn.run(
            app,
            host=host,
            port=port,
            access_log=False,
            log_config=None,
            proxy_headers=True,
            forwarded_allow_ips="127.0.0.1",
        )
    except Exception:  # noqa: BLE001 - Uvicorn/import/config errors can contain secrets.
        emit("API_FAILED")
        return 1
    return 0


def main():
    install()
    parser = SafeParser(prog="python -m app.api", allow_abbrev=False)
    parser.add_argument("--host", default="127.0.0.1", choices=("127.0.0.1", "::1"))
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port")
    return run(**vars(args))


if __name__ == "__main__":
    sys.exit(main())
