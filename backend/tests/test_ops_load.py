"""Tiny real-HTTP measurement and refusal checks, never the long load profile."""

import os

import pytest


def test_load_uses_real_api_and_measured_percentiles(
    tmp_path, migrate_test_database, password_blocklist
):
    from tests.auth_process import AuthProcess
    from tests.ops_load import measure, percentile, seed

    database = tmp_path / "load.sqlite3"
    migrate_test_database(database)
    seed(database, members=3, apps=4)
    server = AuthProcess(database, password_blocklist)
    try:
        server.start()
        output = measure(
            f"http://127.0.0.1:{server.port}", database, requests=6, concurrency=2
        )
        assert output["requests"] == 6 and output["errors"] == 0
        assert len(output["latencies_ms"]) == 6
        assert output["p95_ms"] >= 0
        assert percentile(list(range(1, 21))) == 19
    finally:
        server.close()


def test_load_refuses_nonisolated_or_nonloopback_target(
    tmp_path, monkeypatch, migrate_test_database
):
    from tests.ops_load import measure, seed

    database = tmp_path / "load.sqlite3"
    migrate_test_database(database)
    seed(database, members=2, apps=4)
    for url in (
        "https://example.test",
        "http://127.0.0.1.example.test",
        "http://user@127.0.0.1",
        "http://127.0.0.1/path",
    ):
        with pytest.raises(ValueError):
            measure(url, tmp_path / "load.sqlite3", requests=1, concurrency=1)
    with pytest.raises(ValueError):
        measure(
            "http://127.0.0.1:8000",
            os.getcwd() + "/load.sqlite3",
            requests=1,
            concurrency=1,
        )
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(ValueError):
        seed(tmp_path / "load.sqlite3", members=2, apps=4)
