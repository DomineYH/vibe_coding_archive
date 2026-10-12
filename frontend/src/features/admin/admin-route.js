export function readAdminTab(search) {
  if (!search || search === "?") return { tab: "users", invalid: false };
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const value = params.get("tab");
  return keys.length === 1 &&
    keys[0] === "tab" &&
    ["users", "health"].includes(value)
    ? { tab: value, invalid: false }
    : { tab: "users", invalid: true };
}
