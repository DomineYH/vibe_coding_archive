import { isCancelledError } from "@tanstack/react-query";

export async function refreshAdminApps(queryClient, scopeKey) {
  const filters = {
    queryKey: [__DATA_MODE__, "admin", "apps", scopeKey],
    exact: true,
  };
  const query = queryClient.getQueryCache().find(filters);
  if (query?.state.fetchStatus === "fetching") {
    // Let pagination settle before refreshing health, but never revive a retired read.
    try {
      await query.promise;
    } catch (error) {
      if (isCancelledError(error)) return;
    }
    if (queryClient.getQueryCache().find(filters) !== query) return;
  }
  await queryClient.invalidateQueries(filters, { cancelRefetch: false });
}
