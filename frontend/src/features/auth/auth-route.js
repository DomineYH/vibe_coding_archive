import catalog from "../../../../contracts/catalog.json";
import { normalizeSearch } from "../../services/apps-service";

const modes = new Set(["login", "signup", "password-change", "reauth"]);
const authKeys = new Set(["mode", "return_to"]);
const galleryKeys = new Set(["q", "subject", "grade"]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decode(value) {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return null;
  }
}

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point < 0x20 || (point >= 0x7f && point <= 0x9f);
  });
}

function readPairs(search, allowed) {
  if (!search) return {};
  const values = {};
  for (const pair of search.replace(/^\?/, "").split("&")) {
    if (!pair) return null;
    const separator = pair.indexOf("=");
    if (separator < 1) return null;
    const key = decode(pair.slice(0, separator));
    const value = decode(pair.slice(separator + 1));
    if (
      key === null ||
      value === null ||
      !allowed.has(key) ||
      Object.hasOwn(values, key)
    )
      return null;
    values[key] = value;
  }
  return values;
}

function validGalleryQuery(search) {
  const values = readPairs(search, galleryKeys);
  if (values === null) return false;
  const q = values.q === undefined ? undefined : normalizeSearch(values.q);
  return (
    (!q || Array.from(q).length <= 100) &&
    (!values.subject || catalog.subjects.includes(values.subject)) &&
    (!values.grade || catalog.grades.includes(values.grade))
  );
}

function validReturnTo(path) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    path.endsWith("?") ||
    hasControlCharacter(path)
  )
    return false;
  const parts = path.split("?");
  if (parts.length > 2 || parts[0].includes("%")) return false;
  const [pathname, query = ""] = parts;
  if (pathname === "/") return validGalleryQuery(query);
  if (pathname === "/admin") return query === "";
  return (
    pathname === `/apps/${pathname.slice(6)}` &&
    uuid.test(pathname.slice(6)) &&
    !query
  );
}

export function readAuthRoute(search) {
  const values = readPairs(search, authKeys);
  if (values === null) return { mode: "login", returnTo: "/", invalid: true };
  const mode = values.mode ?? "login";
  const returnTo = values.return_to ?? "/";
  if (!modes.has(mode) || !validReturnTo(returnTo))
    return { mode: "login", returnTo: "/", invalid: true };
  return { mode, returnTo, invalid: false };
}
