import http from 'node:http';
import assert from 'node:assert';
import { spawn, execSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';

const PORT = 8899;
const CDP_PORT = 9337;
const PROFILE_DIR = '/tmp/chrome_repro_profile_r3';

try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}
mkdirSync(PROFILE_DIR, { recursive: true });

let slowReqCount = 0;
let reqEvents = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const socket = req.socket;

  if (url.pathname === '/page.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Repro Tab</title></head>
<body>
<h1>Repro Page</h1>
<script>
window.__lockAcquired = false;
window.__lockAcquiredTime = null;

window.startLockHolder = (name) => {
  navigator.locks.request(name, async (lock) => {
    window.__lockAcquired = true;
    window.__lockAcquiredTime = performance.now();
    await new Promise(r => { window.__release = r; });
  });
  return true;
};

window.tryLock = async (name) => {
  let result = null;
  await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    result = lock !== null;
  });
  return result;
};

window.fireFetch = (url, options = {}) => {
  window.__fetchStatus = 'in-flight';
  window.__headersReceived = false;
  window.__responseStatus = null;
  fetch(url, options)
    .then(r => {
      window.__headersReceived = true;
      window.__responseStatus = r.status;
      return r.json();
    })
    .then(d => { window.__fetchStatus = 'success'; window.__fetchResult = d; })
    .catch(e => { window.__fetchStatus = 'error'; window.__fetchError = e.name; });
  return true;
};
</script>
</body>
</html>`);
    return;
  }

  if (url.pathname === '/clear_cookies') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'eduvibe_session_dev=; Path=/; Max-Age=0; HttpOnly'
    });
    res.end(JSON.stringify({ status: 'cleared' }));
    return;
  }

  // Pre-headers delay (Test 2A & Test 3 & Test 4)
  if (url.pathname === '/slow_auth_pre_headers') {
    const reqId = ++slowReqCount;
    const keepalive = url.searchParams.get('keepalive') === '1';
    const delay = parseInt(url.searchParams.get('delay') || '500', 10);
    const cookieVal = url.searchParams.get('cookie') || 'userA';

    reqEvents.push({ reqId, event: 'request_received_on_server', cookieVal, keepalive });

    socket.on('close', (hadError) => {
      reqEvents.push({
        reqId,
        event: 'socket_closed',
        hadError,
        writableEnded: res.writableEnded,
        destroyed: socket.destroyed
      });
    });

    setTimeout(() => {
      try {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `eduvibe_session_dev=${cookieVal}; Path=/; SameSite=Lax; HttpOnly`
        });
        res.end(JSON.stringify({ status: 'ok', reqId, cookieVal }));
        reqEvents.push({ reqId, event: 'server_res_end_called', cookieVal });
      } catch (err) {
        reqEvents.push({ reqId, event: 'server_res_write_failed', error: err.message });
      }
    }, delay);
    return;
  }

  // Headers flushed immediately, body delayed (Test 2B & Test 2C)
  if (url.pathname === '/headers_flushed_slow_body') {
    const reqId = ++slowReqCount;
    const cookieVal = url.searchParams.get('cookie') || 'user_flushed';
    const bodyDelay = parseInt(url.searchParams.get('delay') || '500', 10);

    reqEvents.push({ reqId, event: 'headers_flush_started', cookieVal });

    socket.on('close', (hadError) => {
      reqEvents.push({
        reqId,
        event: 'socket_closed_after_headers',
        hadError,
        writableEnded: res.writableEnded,
        destroyed: socket.destroyed
      });
    });

    // Flush headers immediately over wire
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `eduvibe_session_dev=${cookieVal}; Path=/; SameSite=Lax; HttpOnly`
    });
    res.flushHeaders();
    reqEvents.push({ reqId, event: 'headers_flushed_to_socket', cookieVal });

    setTimeout(() => {
      try {
        res.write(JSON.stringify({ status: 'ok', reqId, cookieVal }));
        res.end();
        reqEvents.push({ reqId, event: 'server_body_end_called', cookieVal });
      } catch (err) {
        reqEvents.push({ reqId, event: 'server_body_write_failed', error: err.message });
      }
    }, bodyDelay);
    return;
  }

  if (url.pathname === '/fast_auth') {
    const cookieVal = url.searchParams.get('cookie') || 'userB';
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `eduvibe_session_dev=${cookieVal}; Path=/; SameSite=Lax; HttpOnly`
    });
    res.end(JSON.stringify({ status: 'ok', cookieVal }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`[Harness] HTTP server listening on port ${PORT}`);
  
  // Spawn detached so we can cleanly kill the entire process group
  const chrome = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`
  ], { detached: true });

  await new Promise(r => setTimeout(r, 1000));
  
  let browserWs = null;
  try {
    const versionRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log('[Harness] Connected to Chrome:', versionData.Browser);

    browserWs = new WebSocket(versionData.webSocketDebuggerUrl);
    let msgId = 1;
    const pendingCalls = new Map();

    browserWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pendingCalls.has(msg.id)) {
        const { resolve, reject } = pendingCalls.get(msg.id);
        pendingCalls.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    await new Promise(r => browserWs.onopen = r);

    function sendCommand(method, params = {}, sessionId = undefined) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pendingCalls.set(id, { resolve, reject });
        browserWs.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }

    async function createTab(url) {
      const { targetId } = await sendCommand('Target.createTarget', { url });
      const { sessionId } = await sendCommand('Target.attachToTarget', { targetId, flatten: true });
      return { targetId, sessionId };
    }

    async function evaluateInTab(sessionId, expression, awaitPromise = false) {
      const res = await sendCommand('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true
      }, sessionId);
      return res.result?.value;
    }

    async function getCookies() {
      const res = await sendCommand('Storage.getCookies');
      return res.cookies || [];
    }

    async function clearCookies(tabSessionId) {
      if (tabSessionId) {
        await evaluateInTab(tabSessionId, `fetch('/clear_cookies')`, true);
      }
    }

    // -------------------------------------------------------------
    // TEST 1: Web Locks cross-tab mutual exclusion & tab close auto-release
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Web Locks cross-tab mutual exclusion & tab close release ---');
    const tab1 = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await evaluateInTab(tab1.sessionId, `window.startLockHolder('auth_lock')`);
    
    let t1Acquired = false;
    for (let i = 0; i < 20; i++) {
      t1Acquired = await evaluateInTab(tab1.sessionId, `window.__lockAcquired`);
      if (t1Acquired) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.strictEqual(t1Acquired, true, 'Tab 1 must acquire auth_lock');
    console.log('Tab 1 acquired "auth_lock": true');

    const tab2 = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    const tryTab2WhileT1Alive = await evaluateInTab(tab2.sessionId, `window.tryLock('auth_lock')`, true);
    assert.strictEqual(tryTab2WhileT1Alive, false, 'Tab 2 must not acquire lock while Tab 1 is holding it');
    console.log('Tab 2 tryLock while Tab 1 alive: false (Mutual exclusion verified)');

    await evaluateInTab(tab2.sessionId, `window.startLockHolder('auth_lock')`);
    const closeStart = Date.now();
    await sendCommand('Target.closeTarget', { targetId: tab1.targetId });

    let t2Acquired = false;
    let t2Elapsed = 0;
    while (!t2Acquired && t2Elapsed < 2000) {
      await new Promise(r => setTimeout(r, 5));
      t2Elapsed = Date.now() - closeStart;
      t2Acquired = await evaluateInTab(tab2.sessionId, `window.__lockAcquired`);
    }
    assert.strictEqual(t2Acquired, true, 'Tab 2 must acquire lock after Tab 1 closes');
    console.log(`Tab 2 acquired lock after Tab 1 closed: true (Latency: ${t2Elapsed}ms)`);
    await sendCommand('Target.closeTarget', { targetId: tab2.targetId });

    // -------------------------------------------------------------
    // TEST 2A: Tab close BEFORE headers sent (keepalive: false)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2A: Tab close BEFORE headers sent (keepalive: false) ---');
    reqEvents = [];
    const tab2A = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await clearCookies(tab2A.sessionId);

    await evaluateInTab(tab2A.sessionId, `window.fireFetch('/slow_auth_pre_headers?keepalive=0&delay=500&cookie=userA_pre_headers', { method: 'POST' })`);
    while (!reqEvents.some(e => e.event === 'request_received_on_server')) {
      await new Promise(r => setTimeout(r, 10));
    }
    console.log('Server received /slow_auth_pre_headers. Closing tab at 50ms (before headers)...');
    await new Promise(r => setTimeout(r, 50));
    await sendCommand('Target.closeTarget', { targetId: tab2A.targetId });

    await new Promise(r => setTimeout(r, 600));
    const socketCloseEvent2A = reqEvents.find(e => e.event === 'socket_closed');
    assert.ok(socketCloseEvent2A, 'Socket close event must be observed');
    assert.strictEqual(socketCloseEvent2A.writableEnded, false, 'Socket closed before response ended');

    let cookies = await getCookies();
    let sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieVal2A = sessionCookie ? sessionCookie.value : '';
    assert.strictEqual(cookieVal2A, '', 'No cookie must be saved when tab closed before headers');
    console.log(`Socket closed: true (writableEnded: ${socketCloseEvent2A.writableEnded}), Cookie: NONE (0 stored)`);

    // -------------------------------------------------------------
    // TEST 2B: Tab close AFTER browser confirms headers received, body pending (keepalive: false)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2B: Tab close AFTER browser confirms headers received, body pending ---');
    reqEvents = [];
    const tab2B = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await clearCookies(tab2B.sessionId);

    await evaluateInTab(tab2B.sessionId, `window.fireFetch('/headers_flushed_slow_body?delay=500&cookie=user_headers_flushed', { method: 'POST' })`);
    
    // Explicitly poll the renderer until the fetch promise resolves with headers!
    let headersReceivedInRenderer = false;
    for (let i = 0; i < 50; i++) {
      headersReceivedInRenderer = await evaluateInTab(tab2B.sessionId, `window.__headersReceived`);
      if (headersReceivedInRenderer) break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.strictEqual(headersReceivedInRenderer, true, 'Renderer MUST confirm receipt of response headers');
    console.log('Renderer confirmed receipt of HTTP response headers: true (Status: 200)');

    // Record cookie in CookieStore immediately BEFORE closing tab
    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieBeforeClose = sessionCookie ? sessionCookie.value : '';
    console.log(`Cookie in CookieStore BEFORE closing tab: "${cookieBeforeClose}"`);
    assert.strictEqual(cookieBeforeClose, 'user_headers_flushed', 'Cookie MUST be stored as soon as headers are received');

    // Now close tab while body is still pending on server
    console.log('Closing tab while body is still pending on server...');
    await sendCommand('Target.closeTarget', { targetId: tab2B.targetId });

    await new Promise(r => setTimeout(r, 600));
    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieAfterClose = sessionCookie ? sessionCookie.value : '';
    console.log(`Cookie in CookieStore AFTER tab closed: "${cookieAfterClose}"`);
    assert.strictEqual(cookieAfterClose, 'user_headers_flushed', 'Cookie persists in CookieStore after tab close');
    console.log('>>> [OBSERVED FACT] Cookie was stored upon header receipt and persists after tab closure.');

    // -------------------------------------------------------------
    // TEST 2C: AbortController.abort() AFTER browser confirms headers received, body pending
    // -------------------------------------------------------------
    console.log('\n--- TEST 2C: AbortController.abort() AFTER browser confirms headers received ---');
    reqEvents = [];
    const tab2C = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await clearCookies(tab2C.sessionId);

    await evaluateInTab(tab2C.sessionId, `
      window.__abortController = new AbortController();
      window.fireFetch('/headers_flushed_slow_body?delay=500&cookie=user_aborted_after_headers', {
        method: 'POST',
        signal: window.__abortController.signal
      });
    `);
    
    headersReceivedInRenderer = false;
    for (let i = 0; i < 50; i++) {
      headersReceivedInRenderer = await evaluateInTab(tab2C.sessionId, `window.__headersReceived`);
      if (headersReceivedInRenderer) break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.strictEqual(headersReceivedInRenderer, true, 'Renderer MUST confirm receipt of response headers');
    console.log('Renderer confirmed receipt of HTTP response headers: true');

    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieBeforeAbort = sessionCookie ? sessionCookie.value : '';
    console.log(`Cookie in CookieStore BEFORE calling abort(): "${cookieBeforeAbort}"`);
    assert.strictEqual(cookieBeforeAbort, 'user_aborted_after_headers');

    console.log('Calling abort() on fetch while body stream is pending...');
    await evaluateInTab(tab2C.sessionId, `window.__abortController.abort()`);
    const abortErr = await evaluateInTab(tab2C.sessionId, `window.__fetchError`);
    console.log(`Renderer fetch error: ${abortErr}`);
    assert.strictEqual(abortErr, 'AbortError');

    await new Promise(r => setTimeout(r, 600));
    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieAfterAbort = sessionCookie ? sessionCookie.value : '';
    console.log(`Cookie in CookieStore AFTER AbortController abort: "${cookieAfterAbort}"`);
    assert.strictEqual(cookieAfterAbort, 'user_aborted_after_headers', 'Cookie remains stored even after body stream aborted');
    console.log('>>> [OBSERVED FACT] AbortController aborted body stream, but Set-Cookie header was already committed.');
    await sendCommand('Target.closeTarget', { targetId: tab2C.targetId });

    // -------------------------------------------------------------
    // TEST 3: Tab close during in-flight fetch WITH keepalive: true -> Zombie Overwrite
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: In-flight fetch WITH keepalive: true -> Late Zombie Overwrite ---');
    reqEvents = [];
    const tab3A = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await clearCookies(tab3A.sessionId);

    await evaluateInTab(tab3A.sessionId, `window.fireFetch('/slow_auth_pre_headers?keepalive=1&delay=600&cookie=userA_zombie', { method: 'POST', keepalive: true })`);
    while (!reqEvents.some(e => e.event === 'request_received_on_server')) {
      await new Promise(r => setTimeout(r, 10));
    }
    console.log('Tab 1 sent keepalive fetch (delay: 600ms). Closing Tab 1 at 50ms...');
    await new Promise(r => setTimeout(r, 50));
    await sendCommand('Target.closeTarget', { targetId: tab3A.targetId });

    const tab3B = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await evaluateInTab(tab3B.sessionId, `window.fireFetch('/fast_auth?cookie=userB_fresh', { method: 'POST' })`);
    await new Promise(r => setTimeout(r, 100));

    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    assert.strictEqual(sessionCookie?.value, 'userB_fresh', 'Cookie must be userB_fresh after Tab 2 fast login');
    console.log(`Cookie at T=150ms (after Tab 2 login): ${sessionCookie?.value}`);

    console.log('Waiting for Tab 1 delayed keepalive response at T=600ms...');
    await new Promise(r => setTimeout(r, 650));

    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    console.log(`Cookie at T=800ms: ${sessionCookie?.value}`);
    assert.strictEqual(sessionCookie?.value, 'userA_zombie', 'Zombie cookie MUST overwrite newer session when keepalive: true');
    console.log('>>> [OBSERVED FACT] userA_zombie OVERWROTE userB_fresh in CookieStore!');
    await sendCommand('Target.closeTarget', { targetId: tab3B.targetId });

    // -------------------------------------------------------------
    // TEST 4: AbortController.abort() BEFORE headers sent
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: AbortController.abort() BEFORE headers sent ---');
    reqEvents = [];
    const tab4 = await createTab(`http://127.0.0.1:${PORT}/page.html`);
    await clearCookies(tab4.sessionId);

    await evaluateInTab(tab4.sessionId, `
      window.__abortController = new AbortController();
      window.fireFetch('/slow_auth_pre_headers?keepalive=0&delay=500&cookie=aborted_before_headers', {
        method: 'POST',
        signal: window.__abortController.signal
      });
    `);
    while (!reqEvents.some(e => e.event === 'request_received_on_server')) {
      await new Promise(r => setTimeout(r, 10));
    }
    console.log('Request received on server. Calling abort() immediately...');
    await evaluateInTab(tab4.sessionId, `window.__abortController.abort()`);

    await new Promise(r => setTimeout(r, 600));
    cookies = await getCookies();
    sessionCookie = cookies.find(c => c.name === 'eduvibe_session_dev');
    const cookieVal4 = sessionCookie ? sessionCookie.value : '';
    assert.strictEqual(cookieVal4, '', 'No cookie saved when abort occurs before headers');
    console.log(`Cookie after abort BEFORE headers: NONE (0 stored)`);
    await sendCommand('Target.closeTarget', { targetId: tab4.targetId });

    console.log('\n===============================================================');
    console.log('ALL ASSERTIONS PASSED (6/6 TESTS SUCCESSFUL). EXIT CODE: 0');
    console.log('===============================================================');

  } catch (err) {
    console.error('[Harness Failure] Test run failed with error:', err);
    process.exitCode = 1;
  } finally {
    try {
      if (browserWs) {
        await new Promise(resolve => {
          const id = msgId++;
          pendingCalls.set(id, { resolve, reject: resolve });
          browserWs.send(JSON.stringify({ id, method: 'Browser.close' }));
          setTimeout(resolve, 500);
        });
        browserWs.close();
      }
    } catch (e) {}

    try {
      if (chrome.pid) {
        process.kill(-chrome.pid, 'SIGKILL');
      }
    } catch (e) {}

    server.close();

    // Verify no leftover Chrome processes remain for PROFILE_DIR
    try {
      const psOut = execSync(`ps aux | grep -i "${PROFILE_DIR}" | grep -v grep || true`).toString().trim();
      if (psOut) {
        console.warn('[Cleanup Warning] Found leftover chrome processes:', psOut);
        const pids = psOut.split('\n').map(l => l.trim().split(/\s+/)[1]).filter(Boolean);
        for (const pid of pids) {
          try { process.kill(parseInt(pid, 10), 'SIGKILL'); } catch (e) {}
        }
      } else {
        console.log('[Cleanup] Verified: No orphan chrome processes remain for profile dir.');
      }
    } catch (e) {}
  }
});
