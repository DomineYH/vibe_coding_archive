#!/usr/bin/env python3
"""Capture unchanged basic_design with the already installed Python Playwright."""
import argparse
import functools
import hashlib
import http.server
import importlib.metadata
import json
import platform
import re
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "basic_design"
KEY = "eduvibe-archive-coty2026"
FIXED = datetime(2026, 9, 22, 0, 12, tzinfo=timezone.utc)
SIZES = [(1440, 1000), (1024, 900), (768, 1024), (390, 844), (360, 844)]
CDN = re.compile(r"^https://(?:cdn\.tailwindcss\.com|unpkg\.com|cdn\.jsdelivr\.net)/")
ROLES = {
    ".thumbnail": "640×358 WebP preview; incomplete historical image, not runtime",
    "EduVibe 아카이브.html": "Entry, CDN/SRI, font link, Tailwind config, global CSS, JSX order",
    "app.jsx": "Shell, state-only routing, localStorage, demo actions, tweak defaults",
    "data.jsx": "Ordered fixtures: 7 demo users, 17 apps; themes, classifications, random Ping",
    "ui.jsx": "Shared controls, LR fallback, badges, generated DeviceScreen/AppCard",
    "view-auth.jsx": "Login/signup and demo credentials",
    "view-gallery.jsx": "Visibility, filters, search and responsive grid",
    "view-detail.jsx": "Public/private detail, copy, edit/delete and simulated Ping",
    "view-submit.jsx": "Registration/edit, validation, preview, visibility and themes",
    "view-admin.jsx": "User management and Health Monitor tabs",
    "tweaks-panel.jsx": "Hidden developer panel and external editor postMessage protocol",
}


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sources():
    return [{"path": str(p.relative_to(ROOT)), "bytes": p.stat().st_size,
             "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "role": ROLES[p.name]}
            for p in sorted(SOURCE.iterdir()) if p.is_file()]


class SourceHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


METRICS = """() => {
  const bounds = e => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return {tag:e.tagName, text:e.textContent.trim().slice(0,100),
      class:e.className, left:r.left, right:r.right, width:r.width,
      clientWidth:e.clientWidth, scrollWidth:e.scrollWidth, overflowX:s.overflowX};
  };
  const all = [...document.querySelectorAll('[data-screen-label] *')];
  const visible = all.filter(e => e.getClientRects().length);
  const screen = document.querySelector('[data-screen-label]');
  const root = document.documentElement;
  return {screen:screen?.dataset.screenLabel, viewport:{width:innerWidth,height:innerHeight},
    dpr:devicePixelRatio, date:new Date().toISOString(),
    widths:{html:root.scrollWidth,body:document.body.scrollWidth,viewport:innerWidth},
    rootOverflowX:getComputedStyle(root).overflowX, bodyOverflowX:getComputedStyle(document.body).overflowX,
    outsideViewport:visible.filter(e => {const r=e.getBoundingClientRect();return r.left < -0.5 || r.right > innerWidth+0.5;}).map(bounds),
    internalOverflow:visible.filter(e=>e.scrollWidth>e.clientWidth+1).map(bounds),
    gridColumns:document.querySelector('[data-screen-label="갤러리"] > .grid') &&
      getComputedStyle(document.querySelector('[data-screen-label="갤러리"] > .grid')).gridTemplateColumns,
    text:screen?.innerText, inputValues:[...document.querySelectorAll('input,textarea')].map(e=>({placeholder:e.placeholder,type:e.type,value:e.value})),
    svgCount:document.querySelectorAll('svg').length, lucideLoaded:!!window.LucideReact?.Copy,
    LRMatchesGlobal:window.LR===window.LucideReact, fontStatus:document.fonts.status,
    fontFaces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,status:f.status,weight:f.weight,unicodeRange:f.unicodeRange})),
    fontFamily:getComputedStyle(document.body).fontFamily,
    colors:{body:getComputedStyle(document.body).backgroundColor,accent:getComputedStyle(root).getPropertyValue('--accent'),radius:getComputedStyle(root).getPropertyValue('--radius-card')},
    colorMixSupported:CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'),
    tweaksVisible:!!document.querySelector('.twk-panel'),
    state:JSON.parse(localStorage.getItem('eduvibe-archive-coty2026')),
    react:window.React?.version,babel:window.Babel?.version,userAgent:navigator.userAgent};
}"""


def capture_run(args):
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    assert not (out / "run.json").exists(), "Use a new output directory; preserve prior evidence."
    before = sources()
    dump(out / "sources.json", before)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(SourceHandler, directory=str(SOURCE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    url = origin + "/EduVibe%20%EC%95%84%EC%B9%B4%EC%9D%B4%EB%B8%8C.html"
    log = {"mode": args.mode, "startedUTC": datetime.now(timezone.utc).isoformat(),
           "origin": origin, "sourceRoot": str(SOURCE), "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
           "python": platform.python_version(), "playwright": importlib.metadata.version("playwright"),
           "os": platform.platform(), "osRelease": Path("/etc/os-release").read_text(),
           "console": [], "pageerrors": [], "network": [], "failed": [], "blockedRequests": [], "captures": [], "checks": []}
    baseline = args.mode == "live-baseline"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        log.update(browser=browser.version, executable=pw.chromium.executable_path)
        options = dict(viewport={"width": 1440, "height": 1000}, device_scale_factor=1, locale="ko-KR", timezone_id="Asia/Seoul", service_workers="block")
        if args.mode != "replay":
            options.update(record_har_path=str(out / "cdn.har.zip"), record_har_content="attach", record_har_url_filter=CDN)
        context = browser.new_context(**options)
        if not baseline:
            context.add_init_script(f"localStorage.removeItem('{KEY}'); Math.random = () => 0.5;")

        def guard(route):
            u = route.request.url
            if u.startswith(origin + "/") or CDN.match(u):
                route.continue_()
            else:
                log["blockedRequests"].append(u)
                route.abort()

        context.route("**/*", guard)
        if args.mode == "replay":
            assert args.har and args.har.is_file(), "Replay requires a captured CDN HAR."
            context.route_from_har(args.har, url=CDN, not_found="abort")
        try:
            for width, height in (SIZES[:1] if baseline else SIZES):
                tag = f"{width}x{height}"
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": height})
                page.on("console", lambda m: log["console"].append({"viewport": tag, "type": m.type, "text": m.text, "location": m.location}))
                page.on("pageerror", lambda e: log["pageerrors"].append({"viewport": tag, "error": str(e)}))
                page.on("response", lambda r: log["network"].append({"viewport": tag, "url": r.url, "status": r.status}))
                page.on("requestfailed", lambda r: log["failed"].append({"viewport": tag, "url": r.url, "error": r.failure}))
                if not baseline:
                    page.clock.install(time=FIXED)
                    page.clock.pause_at(FIXED)
                    page.clock.set_fixed_time(FIXED)
                page.goto(url, wait_until="networkidle", timeout=60000)
                expect(page.locator('[data-screen-label="갤러리"]')).to_be_visible()
                cdp = context.new_cdp_session(page)
                cdp.send("DOM.enable")
                cdp.send("CSS.enable")

                def step(ms=400):
                    if not baseline:
                        page.clock.run_for(ms)
                    page.evaluate("document.fonts.ready")

                def shot(name, component=None, keep_focus=False):
                    if not keep_focus:
                        page.evaluate("document.activeElement.blur()")
                    page.mouse.move(0, 0)
                    page.evaluate("window.scrollTo(0,0)")
                    step()
                    filename = f"{tag}/{name}.png"
                    (out / tag).mkdir(exist_ok=True)
                    page.screenshot(path=str(out / filename), full_page=True, animations="disabled", caret="hide")
                    m = page.evaluate(METRICS)
                    doc = cdp.send("DOM.getDocument")
                    node = cdp.send("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": "h1"})
                    m["actualHeadingFonts"] = cdp.send("CSS.getPlatformFontsForNode", {"nodeId": node["nodeId"]})["fonts"]
                    m.update(file=filename, stateName=name)
                    dump(out / tag / f"{name}.json", m)
                    log["captures"].append({"file": filename, "stateName": name, "viewport": tag})
                    if component and width == 1440:
                        page.locator(component).first.screenshot(path=str(out / tag / f"{name}-component.png"), animations="disabled", caret="hide")
                    print(f"{args.mode}: {filename}", flush=True)

                def click(name):
                    page.get_by_role("button", name=name, exact=True).click()

                def gallery():
                    page.locator("header button").first.click()

                def card(name):
                    page.locator("button.card-r").filter(has_text=name).click()

                def login(user, password):
                    page.locator('form input').nth(0).fill(user)
                    page.locator('form input').nth(1).fill(password)
                    page.locator('form button[type="submit"]').click()

                shot("01-gallery", "button.card-r")
                assert page.locator("button.card-r").count() == 16
                if baseline:
                    page.close()
                    continue
                page.get_by_placeholder("앱·작성자 검색").focus()
                shot("02-gallery-search-focus", keep_focus=True)
                page.get_by_placeholder("앱·작성자 검색").fill("없는앱-증거")
                expect(page.get_by_text("조건에 맞는 앱이 없어요")).to_be_visible()
                shot("03-gallery-empty")
                page.get_by_placeholder("앱·작성자 검색").fill("")
                card("분수 피자 가게")
                shot("04-detail-public", "aside")
                click("복사하기")
                expect(page.get_by_text("복사됨", exact=True)).to_be_visible()
                shot("05-copy-done")
                step(2000)
                gallery()
                card("전기회로 빌더")
                shot("06-detail-error-500")
                gallery()
                click("로그인")
                shot("07-login")
                page.locator('form button[type="submit"]').click()
                expect(page.get_by_text("아이디와 비밀번호를 모두 입력해 주세요.")).to_be_visible()
                shot("08-login-error")
                click("회원가입")
                shot("09-signup")
                page.locator('form input').nth(0).fill("admin")
                page.locator('form input').nth(1).fill("admin123")
                page.locator('form input').nth(2).fill("mismatch")
                click("가입 신청하기")
                expect(page.get_by_text("비밀번호 확인이 일치하지 않습니다.")).to_be_visible()
                shot("10-signup-error")
                page.locator('form input').nth(2).fill("admin123")
                click("가입 신청하기")
                expect(page.get_by_text("이미 사용 중인 아이디입니다.")).to_be_visible()
                page.locator('[data-screen-label="로그인"]').get_by_role("button", name="로그인", exact=True).first.click()
                login("비기너개발자", "1234")
                expect(page.get_by_text("관리자 승인 대기 중인 계정입니다.", exact=False)).to_be_visible()
                shot("11-login-pending")
                login("교사김코딩", "1234")
                step(2400)
                assert page.locator("button.card-r").count() == 17
                card("과학 수행평가 루브릭 채점기")
                shot("12-detail-private")
                click("편집")
                shot("13-edit", "aside")
                click("취소")
                assert page.locator('[data-screen-label^="상세:"]').count() == 1
                click("삭제")
                shot("14-delete-confirm")
                click("취소")
                expect(page.get_by_role("button", name="삭제 확인", exact=True)).to_have_count(0)
                shot("15-delete-cancel")
                gallery()
                click("내 앱 등록하기")
                shot("16-submit")
                click("아카이브에 등록")
                expect(page.get_by_text("필수 항목을 확인해 주세요:", exact=False)).to_be_visible()
                shot("17-submit-error")
                click("취소")
                assert page.locator("button.card-r").count() == 17
                page.get_by_title("로그아웃", exact=True).click()
                step(2400)
                click("로그인")
                login("admin", "admin123")
                step(2400)
                # The original hides admin navigation below 640px. Enter at 768px,
                # then resize; do not invent a mobile route or invoke React internals.
                if width < 640:
                    page.set_viewport_size({"width": 768, "height": 1024})
                click("관리자")
                page.set_viewport_size({"width": width, "height": height})
                shot("18-admin-users")
                row = page.locator("li").filter(has_text="비기너개발자")
                row.get_by_role("button", name="삭제", exact=True).click()
                shot("19-admin-user-confirm")
                click("취소")
                row.get_by_role("button", name="비밀번호 변경", exact=True).click()
                assert page.get_by_placeholder("새 비밀번호 (4자 이상)").get_attribute("type") == "text"
                shot("20-admin-password")
                click("취소")
                click("Health Monitor")
                shot("21-admin-health", "li")
                row = page.locator("li").filter(has_text="분수 피자 가게")
                row.get_by_role("button", name="삭제", exact=True).click()
                shot("22-admin-app-confirm")
                click("취소")
                row.get_by_role("button", name="즉시 재검사", exact=True).click()
                expect(page.get_by_text("검사중…", exact=True)).to_be_visible()
                shot("23-admin-checking")
                step(1200)
                state = page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")
                assert state["apps"][0]["status"] == 200 and state["apps"][0]["ms"] == 280
                assert state["apps"][0]["lastChecked"] == "09:12"
                shot("24-admin-checked")
                click("파닉스 사운드 랩")
                shot("25-admin-detail-404", "aside")
                # Complete one destructive DEMO action at the end of an isolated run.
                click("삭제")
                click("삭제 확인")
                assert page.locator("button.card-r").count() == 16
                expect(page.get_by_text("‘파닉스 사운드 랩’을 삭제했어요.", exact=True)).to_be_visible()
                shot("26-delete-complete")
                log["checks"].append({"viewport": tag, "publicCards": 16, "ownerCards": 17,
                    "signupMismatchAndDuplicate": "observed", "pendingLogin": "rejected",
                    "cancelPreservesApps": True, "adminPasswordType": "text",
                    "simulatedPing": {"status": 200, "ms": 280, "lastChecked": "09:12"},
                    "demoDeleteRemaining": 16, "mobileAdminEntry": "resize from 768px" if width < 640 else "visible navigation"})
                page.close()
        finally:
            context.close()
            browser.close()
            server.shutdown()
            server.server_close()
            log["sourcesUnchanged"] = before == sources()
            log["finishedUTC"] = datetime.now(timezone.utc).isoformat()
            dump(out / "run.json", log)
    assert log["sourcesUnchanged"] and not log["pageerrors"] and not log["failed"] and not log["blockedRequests"]
    print(f"PASS: {len(log['captures'])} states, unchanged source, no page/request failures", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["live-baseline", "record", "replay"])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--har", type=Path)
    capture_run(parser.parse_args())
