# Coding standards

Judgement rules a reviewer applies to a diff. Mechanical rules live in the linters and CI (`.routing/repo_checks.json`).

## Guard exceptions are defined by state

When a change exempts some case from an existing guard (a re-check, a concealment, a permission or deletion rule), define the exemption by the **state** the guard protects, not by a list of triggering events.

- Before writing the condition, enumerate every writer of that state (`grep` the setter, e.g. every `setAuth(` / `queueAuth(` call, every `revoked_at` write) and every path that starts or fails the guarded check. The plan or PR lists them.
- The exemption reads the latest value of that state at decision time — the value already queued, not the last rendered one.
- Each listed writer either keeps the guard or has a test showing why the exemption is safe there.

Why: #328 first exempted "the first window focus" by event type; review then found, one cycle at a time, a cross-tab notification, a 401 invalidation, a route re-check, a mock reset and a not-yet-rendered failure that all needed the guard (`frontend/src/app/app.jsx` `restoreOnReturn`, `queueAuth`).
