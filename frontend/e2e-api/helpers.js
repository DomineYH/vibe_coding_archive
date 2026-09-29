export const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function blockExternalRequests(context) {
  return context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return loopbackHosts.has(url.hostname)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}
