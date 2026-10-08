import { readdirSync, readFileSync, lstatSync } from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const files = [];
function visit(directory) {
  if (lstatSync(directory).isSymbolicLink())
    throw new Error("API dist contains a symlink");
  for (const name of readdirSync(directory).sort()) {
    const target = path.join(directory, name);
    const entry = lstatSync(target);
    if (entry.isSymbolicLink()) throw new Error("API dist contains a symlink");
    if (entry.isDirectory()) visit(target);
    else files.push(path.relative(root, target).replaceAll(path.sep, "/"));
  }
}

try {
  visit(root);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  throw new Error("API dist is missing; run npm run build first");
}
if (
  !files.includes("index.html") ||
  !files.some((file) => /^assets\/.+\.js$/i.test(file))
)
  throw new Error("API dist is incomplete");
if (
  files.some((file) =>
    /(^|\/)(fixtures|mock|reference|research|evidence|basic_design)([./_-]|$)|(^|\/)\.env(?:$|[._-])|\.map$|\.thumbnail$|\.(?:db|sqlite3?|age|bak|backup|old|orig|pem|key|p12|pfx|ts|tsx|jsx)(?:[./_-]|$)/i.test(
      file,
    ),
  )
) {
  throw new Error("API dist contains an excluded asset or source map");
}
const isAllowedOutput = (file) =>
  file === "index.html" ||
  file === "licenses/Pretendard-OFL.txt" ||
  /^assets\/[^/.][^/]*\.(?:css|js|woff2)$/i.test(file);
if (files.some((file) => !isAllowedOutput(file)))
  throw new Error("API dist contains an unexpected file");
const textAssets = files
  .filter((file) => /\.(?:css|html|js|svg|txt|xml)$/i.test(file))
  .map((file) => readFileSync(path.join(root, file), "utf8"))
  .join("\n");
for (const forbidden of [
  "분수 피자 가게",
  "교사김코딩",
  "INITIAL_APPS",
  "INITIAL_USERS",
  "simulatePing",
  "TweaksPanel",
  "mockMeta",
  "DEMO_ACCOUNTS",
  "TEMPORARY_DEMO_ACCOUNTS",
  "admin123",
  "Temporary Demo Password 38",
  "Temporary Admin Password 38",
  "list_failure",
  "list_delayed",
  "/__dev/mock-reset",
  "mock reset은 개발 모드에서만 사용할 수 있어요",
]) {
  if (textAssets.includes(forbidden))
    throw new Error(`API bundle includes mock-only content: ${forbidden}`);
}
if (/\bpassword["']?\s*:\s*["']1234["']/.test(textAssets))
  throw new Error("API bundle includes a demo password record");
process.stdout.write(
  `API dist contains ${files.length} files and no mock fixtures, Tweaks, references, or source maps.\n`,
);
