"""Replay source CDN HAR and measure full-page source/product element contributions.

Run under the shared Playwright flock, with PLAYWRIGHT_CHROMIUM_EXECUTABLE and
FONTCONFIG_FILE set. Product mode starts and cleans its own Vite server.
"""
import argparse
import functools
import http.server
import json
import os
import re
import signal
import subprocess
import time
import urllib.request
import threading
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[5]
VIEWPORTS = [(1440, 1000), (1024, 900), (768, 1024), (390, 844), (360, 844)]
METRICS = """() => {
  const screen = document.querySelector('[data-screen-label]:not([data-screen-label="로그인"])');
  const bounds = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return {
    tag:e.tagName,text:e.textContent.trim().slice(0,90),class:e.className,
    x:r.x,y:r.y+scrollY,width:r.width,height:r.height,
    display:s.display,gap:s.gap,marginBottom:s.marginBottom,
    padding:s.padding,lineHeight:s.lineHeight,alignItems:s.alignItems,fontSize:s.fontSize,fontFamily:s.fontFamily,fontWeight:s.fontWeight,flexShrink:s.flexShrink,justifyContent:s.justifyContent,color:s.color}; };
  return {height:document.documentElement.scrollHeight,dpr:devicePixelRatio,
    fontStatus:document.fonts.status,screen:bounds(screen),
    elements:[...document.querySelectorAll('header,footer,[data-screen-label] h1,[data-screen-label] form,[data-screen-label] section,[data-screen-label] aside,[data-screen-label] label,[data-screen-label] input,[data-screen-label] textarea,[role="alert"],[id$="-error"], [data-screen-label] dl,[data-screen-label] aside p,[data-screen-label] > .mb-8 > button,[data-screen-label] > .mb-8 > a')].map(bounds)};
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['source', 'product'], required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--width', type=int, help='Limit a follow-up probe to one viewport width')
    parser.add_argument('--normalize', action='store_true', help='Diagnostic only: revert approved visible differences in DOM, never a baseline')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    server = None
    vite = None
    if args.mode == 'source':
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / 'basic_design'))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'
        url = origin + '/EduVibe%20%EC%95%84%EC%B9%B4%EC%9D%B4%EB%B8%8C.html'
    else:
        url = 'http://localhost:5173'
        log = (args.out / 'vite.log').open('w')
        vite = subprocess.Popen(['npm', 'run', 'dev'], cwd=ROOT / 'frontend', stdout=log, stderr=log, start_new_session=True)
        for _ in range(120):
            try:
                urllib.request.urlopen(url, timeout=1).close()
                break
            except OSError:
                time.sleep(0.5)
        else:
            os.killpg(vite.pid, signal.SIGTERM)
            raise RuntimeError('Own Vite server did not start')
    observations = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE'], args=['--force-color-profile=srgb', '--disable-partial-raster'])
            for width, height in VIEWPORTS:
                if args.width and args.width != width:
                    continue
                context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1, locale='ko-KR', timezone_id='Asia/Seoul', reduced_motion='reduce', color_scheme='light', service_workers='block')
                if args.mode == 'source':
                    context.route_from_har(str(ROOT / 'docs/evidence/basic-design-runtime-20260922/reference/cdn.har.zip'), url=re.compile(r'^https://(?:cdn\.tailwindcss\.com|unpkg\.com|cdn\.jsdelivr\.net)/'), not_found='abort')
                page = context.new_page()
                page.clock.install(time=datetime(2026, 9, 22, 0, 12, tzinfo=timezone.utc))
                page.goto(url)
                if args.mode == 'source':
                    page.get_by_role('button', name='로그인', exact=True).click()
                    page.locator('form input').nth(0).fill('교사김코딩')
                    page.locator('form input').nth(1).fill('1234')
                    page.locator('form button[type="submit"]').click()
                    expect(page.locator('button.card-r')).to_have_count(17)
                    page.clock.run_for(2400)
                    page.locator('button.card-r').filter(has_text='과학 수행평가 루브릭 채점기').click()
                else:
                    page.goto(url + '/auth?mode=login')
                    page.get_by_label('로그인 아이디', exact=True).fill('교사김코딩')
                    page.get_by_label('비밀번호', exact=True).fill('1234')
                    page.locator('form button[type="submit"]').click()
                    expect(page.get_by_role('button', name='로그아웃', exact=True)).to_be_visible()
                    page.goto(url + '/apps/00000000-0000-4000-8000-000000000091')
                    expect(page.locator('[data-screen-label="비공개 앱 상세"]')).to_be_visible()

                def shot(state):
                    page.evaluate('document.activeElement.blur()')
                    page.mouse.move(0, 0)
                    page.evaluate('window.scrollTo(0,0)')
                    page.evaluate('document.fonts.ready')
                    page.clock.run_for(400)
                    # Finish finite CSS transitions before saving source computed styles.
                    page.screenshot(animations='disabled', caret='hide')
                    metrics = page.evaluate(METRICS)
                    if args.mode == 'source':
                        metrics['fragments'] = page.evaluate("""() => {
                          const screen=document.querySelector('[data-screen-label]');
                          const aside=screen.querySelector('aside');
                          // Source-only Tailwind classes may be absent from the compiled product.
                          const rendered = element => {
                            if (!element) return null;
                            const copy=element.cloneNode(true);
                            const nodes=[element,...element.querySelectorAll('*')];
                            const copies=[copy,...copy.querySelectorAll('*')];
                            nodes.forEach((node,index) => {
                              const style=getComputedStyle(node);
                              for (const key of ['display','width','height','padding','background-color','color','font-size','line-height','gap','border-radius','border-width','border-color','font-weight','left','top','text-align','align-items','justify-content','box-sizing','flex-grow','flex-shrink','margin','border-style'])
                                copies[index].style.setProperty(key,style.getPropertyValue(key));
                            });
                            return copy.outerHTML;
                          };
                          return {header:rendered(document.querySelector('header')),
                            privacy:rendered(aside.querySelector(':scope > div.px-1')),
                            visibility:rendered(aside.querySelectorAll(':scope > section')[1]),
                            alert:rendered(screen.querySelector('form')?.previousElementSibling)};
                        }""")
                    filename = f'{state}-{width}x{height}.png'
                    page.screenshot(path=str(args.out / filename), full_page=True, animations='disabled', caret='hide')
                    observations.append({'mode': args.mode, 'state': state, 'viewport': {'width': width, 'height': height}, 'screenshot': filename, **metrics})
                    print(args.mode, state, width, metrics['height'], flush=True)
                    if args.normalize:
                        original = json.loads((args.out.parent / 'source/dom.json').read_text())
                        source = next(row for row in original if row['state'] == state and row['viewport'] == {'width': width, 'height': height})
                        page.evaluate("""({state, fragments}) => {
                          document.querySelector('header').outerHTML=fragments.header;
                          const screen=document.querySelector('[data-screen-label]'), aside=screen.querySelector('aside');
                          aside.querySelectorAll(':scope > section')[1].outerHTML=fragments.visibility;
                          if (state==='app-detail-private') {
                            aside.querySelector(':scope > div.px-1').outerHTML=fragments.privacy;
                          } else {
                            screen.querySelector('input').placeholder='예: 분수 피자 가게';
                            screen.querySelectorAll('[id$="-error"]').forEach(e=>e.remove());
                            if (state==='app-edit') screen.querySelector('button[type="submit"]').disabled=false;
                            if (state==='app-create-validation-error') screen.querySelector('[role="alert"]').outerHTML=fragments.alert;
                          }
                        }""", {'state': state, 'fragments': source['fragments']})
                        page.screenshot(path=str(args.out / ('normalized-' + filename)), full_page=True, animations='disabled', caret='hide')
                        # Restore React's route before the next interaction after DOM-only probing.
                        if state == 'app-detail-private':
                            page.goto(url + '/apps/00000000-0000-4000-8000-000000000091')
                            expect(page.locator('[data-screen-label="비공개 앱 상세"]')).to_be_visible()
                        elif state == 'app-edit':
                            page.reload()
                            expect(page.get_by_role('form', name='앱 수정 양식')).to_be_visible()
                        elif state == 'app-create':
                            page.reload()
                            expect(page.get_by_role('form', name='새 앱 등록 양식')).to_be_visible()

                shot('app-detail-private')
                if args.mode == 'source':
                    page.get_by_role('button', name='편집', exact=True).click()
                else:
                    page.get_by_role('link', name='앱 편집', exact=True).click()
                    expect(page.get_by_role('form', name='앱 수정 양식')).to_be_visible()
                shot('app-edit')
                page.get_by_role('button', name='취소', exact=True).click()
                if args.mode == 'source':
                    page.locator('header button').first.click()
                    page.get_by_role('button', name='내 앱 등록하기', exact=True).click()
                else:
                    page.goto(url + '/apps/new')
                    expect(page.get_by_role('form', name='새 앱 등록 양식')).to_be_visible()
                shot('app-create')
                page.get_by_role('button', name='아카이브에 등록', exact=True).click()
                expect(page.get_by_text('필수 항목을 확인해 주세요:' if args.mode == 'source' else '표시된 항목을 확인해 주세요', exact=False)).to_be_visible()
                shot('app-create-validation-error')
                context.close()
            browser.close()
    finally:
        if vite:
            os.killpg(vite.pid, signal.SIGTERM)
            vite.wait()
        if server:
            server.shutdown()
            server.server_close()
        if args.width and (args.out / 'dom.json').exists():
            previous = json.loads((args.out / 'dom.json').read_text())
            observations = [row for row in previous if row['viewport']['width'] != args.width] + observations
        (args.out / 'dom.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
