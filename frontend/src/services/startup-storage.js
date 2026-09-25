export function clearApiStartupStorage() {
  try {
    localStorage.removeItem("eduvibe-archive-coty2026");
    localStorage.removeItem("eduvibe-archive-mock-v1");
  } catch {
    // Browser policy can deny storage; the API app can still render.
  }
}
