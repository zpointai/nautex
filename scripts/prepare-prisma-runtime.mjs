import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(projectRoot, "desktop-runtime");
const outputRoot = path.join(projectRoot, ".desktop-build", "prisma-runtime");
const prismaPackagePath = path.join(sourceRoot, "node_modules", "prisma", "package.json");

try {
  await stat(prismaPackagePath);
} catch {
  throw new Error("Desktop Prisma runtime dependencies are missing. Run npm ci --prefix desktop-runtime first.");
}

const prismaPackage = JSON.parse(await readFile(prismaPackagePath, "utf8"));
if (prismaPackage.version !== "6.19.3") throw new Error(`Unexpected Prisma runtime version ${prismaPackage.version}.`);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
// electron-builder intentionally filters directories named node_modules from
// extraResources. Use a neutral package root and expose it only to the Prisma
// migration subprocess through NODE_PATH.
await cp(path.join(sourceRoot, "node_modules"), path.join(outputRoot, "packages"), { recursive: true });
await cp(path.join(sourceRoot, "package.json"), path.join(outputRoot, "package.json"));
await cp(path.join(sourceRoot, "package-lock.json"), path.join(outputRoot, "package-lock.json"));
await writeFile(path.join(outputRoot, "nautex-prisma-runtime-manifest.json"), `${JSON.stringify({
  formatVersion: 1,
  prismaVersion: prismaPackage.version,
  dependencySha256: createHash("sha256").update(await readFile(path.join(sourceRoot, "package-lock.json"))).digest("hex"),
  entrypoint: "packages/prisma/build/index.js",
}, null, 2)}\n`, "utf8");

console.log(`Prepared Prisma ${prismaPackage.version} migration runtime at ${path.relative(projectRoot, outputRoot)}.`);
