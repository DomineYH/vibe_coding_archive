export async function pauseClockAtCurrentTime(page) {
  const time = await page.evaluate(async () => {
    const time = Date.now();
    // Playwright 1.63's injected controller stops real-time sync synchronously.
    // Reading and pausing in one page task consumes zero time, without a round trip.
    await window.__pwClock.controller.pauseAt(time);
    return time;
  });
  // Record the paused clock for later navigations while time is already stopped.
  await page.clock.pauseAt(time);
}
