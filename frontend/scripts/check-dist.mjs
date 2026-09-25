import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const files = [];
function visit(directory) {
  for (const name of readdirSync(directory).sort()) {
    const target = path.join(directory, name);
    if (statSync(target).isDirectory()) visit(target);
    else files.push(path.relative(root, target).replaceAll(path.sep, "/"));
  }
}

try {
  visit(root);
} catch {
  throw new Error("API dist is missing; run npm run build first");
}
if (
  !files.includes("index.html") ||
  !files.some((file) => file.startsWith("assets/"))
)
  throw new Error("API dist is incomplete");
if (
  files.some((file) =>
    /(^|\/)(fixtures|mock|reference|research|evidence)(\/|$)|\.map$|\.thumbnail$|\.db(?:-wal|-shm)?$|\.bak$/i.test(
      file,
    ),
  )
) {
  throw new Error("API dist contains an excluded asset or source map");
}
const bundle = files
  .filter((file) => file.endsWith(".js"))
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
  "list_failure",
]) {
  if (bundle.includes(forbidden))
    throw new Error(`API bundle includes mock-only content: ${forbidden}`);
}
process.stdout.write(
  `API dist contains ${files.length} files and no mock fixtures, Tweaks, references, or source maps.\n`,
);
