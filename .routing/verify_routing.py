#!/usr/bin/env python3
"""Verify a jev_task_routing installation in a project.

Usage:  python3 .routing/verify_routing.py [--project DIR] [--ping] [--quiet]

Exit codes: 0 all checks passed (warnings allowed), 1 at least one check failed.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

RULE_PAT = r"(?:AUTH|MODEL|ROLE|ORDER|Q|EVID|CLS|WF|MOD|VER|SAFE|ENF|VAL)-\d+[a-z]?"
MARK_START = "<!-- jev-routing:start"
MARK_END = "<!-- jev-routing:end -->"


class Report:
    def __init__(self, quiet=False):
        self.fail = 0
        self.warn = 0
        self.quiet = quiet

    def ok(self, msg):
        if not self.quiet:
            print(f"  [OK]   {msg}")

    def warning(self, msg):
        self.warn += 1
        print(f"  [WARN] {msg}")

    def error(self, msg):
        self.fail += 1
        print(f"  [FAIL] {msg}")


def load_json(path, rep):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        rep.error(f"missing file: {path}")
    except json.JSONDecodeError as e:
        rep.error(f"invalid JSON in {path}: {e}")
    return None


def check_files(routing, rep):
    required = ["jev_task_routing.json", "jev_task_routing.schema.json", "models.json", "models.schema.json", "resolve_models.py", "ROUTING_POLICY.md", "verify_routing.py"]
    for name in required:
        p = routing / name
        if p.is_file():
            rep.ok(f"present: .routing/{name}")
        else:
            rep.error(f"missing: .routing/{name}")
    for d in ("tasks", "evidence"):
        if (routing / d).is_dir():
            rep.ok(f"present: .routing/{d}/")
        else:
            rep.error(f"missing directory: .routing/{d}/")
    legacy = sorted(p.name for p in routing.glob("jev_task_routing_v*.json"))
    if legacy:
        rep.warning(f"legacy versioned config present and ignored: {legacy} (rename to .bak or delete)")
    rc = routing / "repo_checks.json"
    if rc.is_file():
        rep.ok("present: .routing/repo_checks.json")
        data = load_json(rc, rep)
        sch = load_json(routing / "repo_checks.schema.json", rep) if (routing / "repo_checks.schema.json").is_file() else None
        if data is not None and sch:
            try:
                from jsonschema import Draft202012Validator, FormatChecker
                errs = list(Draft202012Validator(sch, format_checker=FormatChecker()).iter_errors(data))
                if errs:
                    rep.error(f"repo_checks.json violates repo_checks.schema.json ({len(errs)} error(s))")
                    for e in errs[:6]:
                        print("         - /" + "/".join(map(str, e.path)) + ": " + e.message[:160])
            except ImportError:
                pass
        if data is not None:
            missing_cmd = [c for c in data.get("required_ci", []) if c not in (data.get("commands") or {})]
            if missing_cmd:
                rep.error(f"repo_checks.json: required_ci entries without a commands entry: {missing_cmd}")
            if not data.get("generated_by") and not data.get("sources"):
                rep.warning("repo_checks.json looks unedited (no generated_by/sources) — fill it with the prompt in README '설치 후 해야 할 것'")
            if data.get("unknowns"):
                rep.warning(f"repo_checks.json has {len(data['unknowns'])} unknown(s) for a human to resolve")
    else:
        rep.warning("missing .routing/repo_checks.json (copy repo_checks.example.json and edit)")


def check_schema(cfg, schema, rep):
    try:
        import jsonschema  # noqa: F401
    except ImportError:
        rep.warning("python package 'jsonschema' not installed; skipping schema validation (pip install jsonschema)")
        return
    from jsonschema import Draft202012Validator, FormatChecker

    v = Draft202012Validator(schema, format_checker=FormatChecker())
    errs = sorted(v.iter_errors(cfg), key=lambda e: list(e.path))
    if errs:
        rep.error(f"config violates schema ({len(errs)} error(s))")
        for e in errs[:10]:
            print("         - /" + "/".join(map(str, e.path)) + ": " + e.message[:160])
    else:
        rep.ok("config validates against schema")


def check_models(routing, cfg, rep):
    models = load_json(routing / "models.json", rep)
    mschema = load_json(routing / "models.schema.json", rep)
    if not models or not mschema:
        return None
    try:
        from jsonschema import Draft202012Validator, FormatChecker
        errs = list(Draft202012Validator(mschema, format_checker=FormatChecker()).iter_errors(models))
        if errs:
            rep.error(f"models.json violates models.schema.json ({len(errs)} error(s))")
            for e in errs[:8]:
                print("         - /" + "/".join(map(str, e.path)) + ": " + e.message[:160])
        else:
            rep.ok("models.json validates against models.schema.json")
    except ImportError:
        rep.warning("jsonschema missing; models.json not schema-validated")
    # every policy role must resolve (MODEL-5)
    prof = models.get("active_profile")
    if prof not in models.get("profiles", {}):
        rep.error(f"models.active_profile '{prof}' is not defined in models.profiles")
    prof_roles = models.get("profiles", {}).get(prof, {}).get("roles", {})
    unresolved = []
    for rid, role in cfg.get("roles", {}).items():
        ref = role.get("settings", "")
        if ref != f"models.json#/roles/{rid}":
            rep.error(f"policy role '{rid}' settings ref is '{ref}', expected 'models.json#/roles/{rid}'")
        for f in ("harness", "model", "effort"):
            v = None
            for layer in (prof_roles.get(rid, {}), models.get("roles", {}).get(rid, {}), models.get("default", {})):
                x = layer.get(f)
                if x is not None and str(x).strip():
                    v = x
                    break
            if v is None:
                unresolved.append(f"{rid}.{f}")
    if unresolved:
        rep.warning(f"fields unset in models.json (will fall back to request.runtime_defaults or verified launch defaults): {unresolved}")
    else:
        rep.ok(f"all {len(cfg.get('roles', {}))} policy roles resolve harness/model/effort from models.json (profile '{prof}')")
    extra = set(models.get("roles", {})) - set(cfg.get("roles", {}))
    if extra:
        rep.warning(f"models.json defines roles not registered in the policy (ignored): {sorted(extra)}")
    # static adapter preflight (MODEL-3)
    for rid in cfg.get("roles", {}):
        merged = dict(models.get("default", {}))
        merged.update({k: v for k, v in models.get("roles", {}).get(rid, {}).items() if v})
        merged.update({k: v for k, v in prof_roles.get(rid, {}).items() if v})
        h, e, m = merged.get("harness"), merged.get("effort"), merged.get("model")
        ad = models.get("adapters", {}).get(h)
        if ad:
            if e and e not in ad.get("efforts", []):
                rep.error(f"{rid}: effort '{e}' not allowed by adapters.{h}.efforts {ad.get('efforts')} (MODEL-3)")
            if ad.get("models") and m not in ad["models"]:
                rep.error(f"{rid}: model '{m}' not in adapters.{h}.models (MODEL-3)")
        elif h:
            rep.warning(f"{rid}: harness '{h}' has no adapters entry; effort/model cannot be preflighted statically")
    # launch channel (ORDER-9)
    for h, ad in models.get("adapters", {}).items():
        lc = ad.get("launch_channels")
        if lc != ["herdr_pane"]:
            rep.error(f"adapters.{h}.launch_channels must be ['herdr_pane'] (ORDER-9), got {lc}")
    used_harnesses = {(prof_roles.get(r, {}).get("harness") or models.get("roles", {}).get(r, {}).get("harness")) for r in cfg.get("roles", {})}
    missing_ad = sorted(h for h in used_harnesses if h and h not in models.get("adapters", {}))
    if missing_ad:
        rep.warning(f"harnesses used by roles without an adapters entry (launch channel unconstrained): {missing_ad}")
    else:
        rep.ok("every role harness has an adapters entry with launch_channels=[herdr_pane]")
    router = models.get("router", {})
    if router.get("model"):
        rep.ok(f"router: {router.get('provider')} {router.get('model')} via {router.get('api_key_env')}")
    return models


def check_cross_refs(cfg, policy_md, rep):
    stages = set(cfg.get("stages", {}))
    roles = set(cfg.get("roles", {}))
    for wid, wf in cfg.get("workflows", {}).items():
        missing = [s for s in wf.get("stages", []) if s not in stages]
        bad_roles = [r for r in wf.get("base_worker_roles", []) if r not in roles]
        if missing or bad_roles:
            rep.error(f"workflow '{wid}': unknown stages {missing} / roles {bad_roles}")
    used = {s for wf in cfg.get("workflows", {}).values() for s in wf.get("stages", [])}
    unused = stages - used
    if unused:
        rep.warning(f"stages defined but unused by any workflow: {sorted(unused)}")
    rep.ok("workflow -> stage/role references resolve")

    qs = set(cfg.get("jev", {}).get("questions", {}))
    if len(qs) != 14:
        rep.error(f"expected 14 Jev questions, found {len(qs)}")
    else:
        rep.ok("14 Jev questions present")
    for key in ("risk_question_ids", "required_choice_ids"):
        ids = set(cfg.get("jev", {}).get(key, []))
        if not ids <= qs:
            rep.error(f"jev.{key} not a subset of questions: {sorted(ids - qs)}")

    # rule IDs referenced from JSON must exist in the policy document
    defined = set(re.findall(r"\*\*(" + RULE_PAT + r")\b", policy_md))
    defined |= set(re.findall(r"\((" + RULE_PAT + r")\)", policy_md))
    for grp in re.findall(r"\(JSON: ([^)]+)\)", policy_md):
        defined |= {x.strip() for x in grp.split(",")}
    text = json.dumps(cfg)
    referenced = set(re.findall(r'"(' + RULE_PAT + r')"', text)) | set(re.findall(r"\((" + RULE_PAT + r")\)", text))
    referenced -= {r for r in referenced if re.match(r"VER-3[a-e]$", r)}  # defined inline in JSON tdd_guards
    missing = sorted(referenced - defined)
    if missing:
        rep.error(f"rule IDs referenced in config but not defined in ROUTING_POLICY.md: {missing}")
    else:
        rep.ok(f"all {len(referenced)} referenced rule IDs defined in ROUTING_POLICY.md")

    eo = cfg.get("evidence_orders", {})
    ins, res = eo.get("inspector_triggers", []), eo.get("researcher_triggers", [])
    if not ins or not res:
        rep.error("evidence_orders must define non-empty inspector_triggers and researcher_triggers (EVID-6); without them these roles are never dispatched")
    else:
        rep.ok(f"evidence orders: {len(ins)} inspector triggers, {len(res)} researcher triggers, skip record {'required' if eo.get('skip_record', {}).get('required') else 'NOT required'}")
    budget = cfg.get("decision", {}).get("budgets", {}).get("max_semantic_calls_per_task_revision")
    if budget is None or budget < 1:
        rep.error("decision.budgets.max_semantic_calls_per_task_revision missing")
    else:
        rep.ok(f"Jev call budget per task revision: {budget}")

    wo = cfg.get("templates", {}).get("work_order", {})
    if wo.get("launch_channel") != "herdr_pane" or "pane_id" not in wo:
        rep.error("templates.work_order must carry launch_channel='herdr_pane' and pane_id (ORDER-9)")
    else:
        rep.ok("work order template fixes launch_channel=herdr_pane")

    flags = cfg.get("decision", {}).get("trusted_flags", {})
    noeffect = [k for k, v in flags.items() if not v.get("effect")]
    if noeffect:
        rep.error(f"trusted flags without consumption rule: {noeffect}")
    else:
        rep.ok("every trusted flag has a consumption rule")


def _iter_orders(items):
    """Yield (label, order_dict) from role_work_items in any shape the host may have written:
    {id: order}, {role: [order, ...]}, [order, ...]. Non-dict leaves are yielded with order=None."""
    if isinstance(items, dict):
        for k, v in items.items():
            if isinstance(v, dict):
                yield str(k), v
            elif isinstance(v, list):
                for i, o in enumerate(v):
                    yield f"{k}[{i}]", (o if isinstance(o, dict) else None)
            else:
                yield str(k), None
    elif isinstance(items, list):
        for i, o in enumerate(items):
            yield f"[{i}]", (o if isinstance(o, dict) else None)


def check_task_records(routing, rep, schema=None):
    """Surface EVID-7 / ORDER-9 violations in recorded tasks without ever crashing on a malformed record."""
    recs = sorted((routing / "tasks").glob("*.json"))
    if not recs:
        rep.ok("no task records yet (shadow mode not started)")
        return
    validator = None
    if schema and "taskRecord" in schema.get("$defs", {}):
        try:
            from jsonschema import Draft202012Validator
            validator = Draft202012Validator({"$ref": "#/$defs/taskRecord", "$defs": schema["$defs"]})
        except ImportError:
            pass
    violations = 0
    for r in recs:
        try:
            t = json.loads(r.read_text(encoding="utf-8"))
        except Exception as e:
            violations += 1
            rep.error(f"{r.name}: unreadable task record ({e})")
            continue
        if not isinstance(t, dict):
            violations += 1
            rep.error(f"{r.name}: task record must be a JSON object (templates.task_record), got {type(t).__name__}")
            continue
        try:
            if validator is not None:
                errs = sorted(validator.iter_errors(t), key=lambda e: list(e.path))
                if errs:
                    violations += 1
                    rep.error(f"{r.name}: does not match templates.task_record schema ({len(errs)} error(s)); the host must write records in that shape")
                    for e in errs[:4]:
                        got = type(e.instance).__name__ if e.validator == "type" else e.message[:100]
                        print("         - /" + "/".join(map(str, e.path)) + f": {e.validator} — " + (f"expected {e.validator_value}, got {got}" if e.validator == "type" else got))
            items = t.get("role_work_items") or {}
            if items and not isinstance(items, dict):
                rep.warning(f"{r.name}: role_work_items should be an object keyed by order id, got {type(items).__name__}")
            for label, order in _iter_orders(items):
                if order is None:
                    violations += 1
                    rep.error(f"{r.name}: role_work_items[{label}] is not a work-order object")
                    continue
                if order.get("order_id") and order.get("launch_channel") != "herdr_pane":
                    violations += 1
                    rep.error(f"{r.name}: order {label} launched via {order.get('launch_channel')!r}, not herdr_pane (ORDER-9)")
            ev = t.get("evidence_orders_evaluated") or {}
            if not isinstance(ev, dict):
                violations += 1
                rep.error(f"{r.name}: evidence_orders_evaluated must be an object")
                continue
            fired = set(ev.get("inspector_triggers") or []) | set(ev.get("researcher_triggers") or [])
            if not fired:
                continue
            issued = set(ev.get("issued") or [])
            skipped = {tid for s_ in (ev.get("skipped") or []) if isinstance(s_, dict) for tid in (s_.get("trigger_ids") or [])}
            if not (issued or fired <= skipped):
                violations += 1
                rep.error(f"{r.name}: triggers {sorted(fired)} fired but no evidence order issued and no skip record (EVID-7)")
        except Exception as e:  # never crash the whole verification on one bad record
            violations += 1
            rep.error(f"{r.name}: could not audit record ({type(e).__name__}: {e})")
    if not violations:
        rep.ok(f"{len(recs)} task record(s): schema-conformant; every fired evidence trigger has an order or a skip record; all issued orders use herdr_pane")


def check_agent_block(project, rep):
    found = []
    for name in ("CLAUDE.md", "AGENTS.md"):
        p = project / name
        if p.is_file():
            t = p.read_text(encoding="utf-8")
            if MARK_START in t and MARK_END in t:
                found.append(name)
    if found:
        rep.ok(f"routing block present in: {', '.join(found)}")
    else:
        rep.error("routing block (jev-routing markers) not found in CLAUDE.md or AGENTS.md")


def check_hook(project, routing, rep):
    """ORDER-9 guard registration in Claude Code settings (user / project / local)."""
    if not (project / "CLAUDE.md").is_file():
        rep.ok("no CLAUDE.md: Claude Code hook not required for this harness")
        return
    candidates = [Path(os.path.expanduser("~/.claude/settings.json")), project / ".claude" / "settings.json", project / ".claude" / "settings.local.json"]
    found = []
    for p in candidates:
        if p.is_file() and "jev_order9_guard" in p.read_text(encoding="utf-8", errors="ignore"):
            found.append(str(p))
    if found:
        rep.ok(f"ORDER-9 guard hook registered in: {', '.join(found)}")
        if len(found) > 1:
            rep.warning("guard registered in more than one scope; it will run twice (harmless but noisy)")
    else:
        rep.warning("Claude Code project but no ORDER-9 guard hook registered — run init_routing.sh --hooks user|project|local")
    hcfg = routing / "hooks.json"
    if hcfg.is_file():
        cfg = load_json(hcfg, rep) or {}
        if cfg.get("mode") not in ("deny", "ask", "log"):
            rep.error(f"hooks.json mode must be deny|ask|log, got {cfg.get('mode')!r}")
        elif cfg.get("mode") != "deny":
            rep.warning(f"hooks.json mode={cfg.get('mode')}: subagent role launches are not blocked, only {cfg.get('mode')}ed")
    if (routing / "hooks" / "jev_order9_guard.py").is_file():
        rep.ok("guard script present in .routing/hooks/")
    else:
        rep.warning("guard script missing from .routing/hooks/")


def check_installed_marker(routing, cfg, rep):
    p = routing / "INSTALLED.json"
    if not p.is_file():
        rep.warning("no .routing/INSTALLED.json (install not recorded)")
        return
    meta = load_json(p, rep) or {}
    if meta.get("policy_version") != cfg.get("version"):
        rep.warning(f"INSTALLED.json version {meta.get('policy_version')} != config version {cfg.get('version')}")
    else:
        rep.ok(f"installed policy version {cfg.get('version')}")


def check_env(cfg, rep, models=None):
    var = (models or {}).get("router", {}).get("api_key_env") or cfg.get("jev", {}).get("api_key_env", "TYPESAFE_API_KEY")
    if os.environ.get(var):
        rep.ok(f"env {var} is set")
    else:
        rep.warning(f"env {var} is not set (required before any Jev call)")


def ping(cfg, rep, models):
    jc = dict(models["router"])
    jc["questions"] = cfg["jev"]["questions"]
    cfg = {"jev": jc}
    var = cfg["jev"]["api_key_env"]
    key = os.environ.get(var)
    if not key:
        rep.error(f"--ping requested but {var} is not set")
        return
    try:
        import requests
    except ImportError:
        rep.warning("python package 'requests' not installed; skipping --ping")
        return
    url = cfg["jev"]["base_url"].rstrip("/") + cfg["jev"]["endpoint"]
    qid = "task_type"
    payload = {
        "model": cfg["jev"]["model"],
        "state": {"task": "Fix a typo in README.md", "context": {}},
        "questions": {qid: cfg["jev"]["questions"][qid]},
    }
    try:
        r = requests.post(url, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=30)
    except requests.RequestException as e:
        rep.error(f"ping failed: {e}")
        return
    if r.status_code in (401, 403):
        rep.error(f"ping: authentication rejected (HTTP {r.status_code}); check {var}")
    elif 200 <= r.status_code < 300:
        try:
            body = r.json()
        except ValueError:
            body = {}
        model = body.get("model") or body.get("response", {}).get("model")
        rep.ok(f"ping: HTTP {r.status_code}; response.model={model!r} (expected {cfg['jev']['model']!r})")
        if model and model != cfg["jev"]["model"]:
            rep.warning("router model differs from pinned jev.model; revalidate thresholds before use (VAL-3)")
    else:
        rep.warning(f"ping: endpoint reachable, HTTP {r.status_code}. Payload shape may differ from the current TypeSafe API; this is a smoke test only, not an API-contract check.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=".", help="project root (default: cwd)")
    ap.add_argument("--ping", action="store_true", help="send one smoke request to the Jev endpoint")
    ap.add_argument("--quiet", action="store_true", help="print only warnings/failures")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    routing = project / ".routing"
    rep = Report(quiet=a.quiet)
    print(f"verify_routing: {project}")

    print("[1/9] files")
    check_files(routing, rep)
    cfg = load_json(routing / "jev_task_routing.json", rep)
    schema = load_json(routing / "jev_task_routing.schema.json", rep)
    policy_path = routing / "ROUTING_POLICY.md"
    policy_md = policy_path.read_text(encoding="utf-8") if policy_path.is_file() else ""
    if not cfg or not schema or not policy_md:
        print(f"\nRESULT: FAIL ({rep.fail} failure(s))")
        return 1

    print("[2/9] schema")
    check_schema(cfg, schema, rep)
    print("[3/9] models (MODEL-1/3/5)")
    models = check_models(routing, cfg, rep)
    print("[4/9] cross references")
    check_cross_refs(cfg, policy_md, rep)
    print("[5/9] agent instructions")
    check_agent_block(project, rep)
    print("[6/9] task records (EVID-7 / ORDER-9)")
    check_task_records(routing, rep, schema)
    print("[7/9] ORDER-9 guard hook")
    check_hook(project, routing, rep)
    print("[8/9] install record")
    check_installed_marker(routing, cfg, rep)
    print("[9/9] environment")
    check_env(cfg, rep, models)
    if a.ping:
        print("[+]   jev endpoint ping")
        if models:
            ping(cfg, rep, models)
        else:
            rep.error("--ping needs a valid models.json#/router")

    status = "FAIL" if rep.fail else "PASS"
    print(f"\nRESULT: {status} ({rep.fail} failure(s), {rep.warn} warning(s))")
    return 1 if rep.fail else 0


if __name__ == "__main__":
    sys.exit(main())
