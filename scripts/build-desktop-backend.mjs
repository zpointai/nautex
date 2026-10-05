import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const outputRoot = path.join(projectRoot, ".desktop-build", "backend");
if (path.dirname(path.resolve(outputRoot)) !== path.resolve(projectRoot, ".desktop-build")) {
  throw new Error("Refusing to replace a backend directory outside the desktop build workspace.");
}

async function requirePath(target, label) {
  try {
    await stat(target);
  } catch {
    throw new Error(`${label} is missing at ${target}. Run the Next.js production build first.`);
  }
}

await requirePath(path.join(standaloneRoot, "server.js"), "Standalone Nautex backend");
await requirePath(path.join(projectRoot, ".next", "static"), "Next.js static assets");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const standaloneEntries = new Set([".next", "node_modules", "package.json", "server.js"]);
await cp(standaloneRoot, outputRoot, {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const relative = path.relative(standaloneRoot, source);
    if (!relative) return true;
    const segments = relative.split(path.sep);
    // PDF text extraction uses a JavaScript DOMMatrix; no native Canvas/Skia
    // package is needed. Exclude all Canvas platform variants from the payload.
    if (segments.some((segment, index) => segment === "@napi-rs" && segments[index + 1]?.startsWith("canvas"))) return false;
    return standaloneEntries.has(segments[0]) && !segments.some((segment) => segment === ".git" || segment.startsWith(".env") || /\.node\.tmp\d+$/i.test(segment));
  },
});
await rm(path.join(outputRoot, ".env"), { force: true });
await rm(path.join(outputRoot, "releases"), { recursive: true, force: true });

// Next 16.3 records the build machine's repository root in standalone config.
// Relocate it before Next loads environment files: a desktop install must never
// read credentials or provider overrides from the developer checkout.
const standaloneServerPath = path.join(outputRoot, "server.js");
const standaloneServer = await readFile(standaloneServerPath, "utf8");
const standaloneConfigMarker = "process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)";
if (!standaloneServer.includes(standaloneConfigMarker)) throw new Error("Unrecognized Next standalone configuration; review backend relocation before packaging.");
await writeFile(standaloneServerPath, standaloneServer.replace(standaloneConfigMarker,
  `nextConfig.repoRoot = dir\nif (nextConfig.turbopack) nextConfig.turbopack.root = dir\n${standaloneConfigMarker}`), "utf8");
const requiredFilesPath = path.join(outputRoot, ".next", "required-server-files.json");
const requiredFiles = JSON.parse(await readFile(requiredFilesPath, "utf8"));
requiredFiles.appDir = ".";
requiredFiles.config.repoRoot = ".";
if (requiredFiles.config.turbopack) requiredFiles.config.turbopack.root = ".";
await writeFile(requiredFilesPath, JSON.stringify(requiredFiles), "utf8");

// Next traces pdf-parse into a hashed .next/node_modules directory but does
// not currently include its pdfjs-dist dependency. Because pdf-parse is ESM,
// NODE_PATH cannot repair that missing package at runtime. Place the traced
// dependencies in the package-local node_modules directory Node resolves.
const tracedPackagesRoot = path.join(outputRoot, ".next", "node_modules");
const tracedPackages = await readdir(tracedPackagesRoot, { withFileTypes: true });
for (const entry of tracedPackages) {
  if (!entry.isDirectory() || !entry.name.startsWith("pdf-parse-")) continue;
  const localDependencies = path.join(tracedPackagesRoot, entry.name, "node_modules");
  await mkdir(localDependencies, { recursive: true });
  await cp(path.join(projectRoot, "node_modules", "pdfjs-dist"), path.join(localDependencies, "pdfjs-dist"), { recursive: true });
}

// Next's tracing includes the Sharp addon but omits its dynamically loaded DLLs.
// This package targets Windows x64. Keep that entire package and its notices;
// exclude the unused static Wasm fallback to avoid distributing another image runtime.
await cp(path.join(projectRoot, "node_modules", "@img", "sharp-win32-x64"), path.join(outputRoot, "node_modules", "@img", "sharp-win32-x64"), { recursive: true });
await rm(path.join(outputRoot, "node_modules", "@img", "sharp-wasm32"), { recursive: true, force: true });

// electron-builder filters directories named node_modules from extraResources.
// Keep the generated standalone dependency tree intact under a neutral name;
// the managed backend subprocess receives this path through NODE_PATH.
await rename(path.join(outputRoot, "node_modules"), path.join(outputRoot, "packages"));
await mkdir(path.join(outputRoot, ".next"), { recursive: true });
await cp(path.join(projectRoot, ".next", "static"), path.join(outputRoot, ".next", "static"), { recursive: true });
await cp(path.join(projectRoot, "public"), path.join(outputRoot, "public"), { recursive: true });
await mkdir(path.join(outputRoot, "prisma"), { recursive: true });
await cp(path.join(projectRoot, "prisma", "schema.prisma"), path.join(outputRoot, "prisma", "schema.prisma"));
await cp(path.join(projectRoot, "prisma", "migrations"), path.join(outputRoot, "prisma", "migrations"), { recursive: true });
const demoSeed = await readFile(path.join(projectRoot, "prisma", "seed.ts"), "utf8");
await writeFile(path.join(outputRoot, "demo-seed.cjs"), ts.transpileModule(demoSeed, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const desktopPackageJson = JSON.parse(await readFile(path.join(projectRoot, "desktop", "package.json"), "utf8"));
const schema = await readFile(path.join(projectRoot, "prisma", "schema.prisma"));
const manifest = {
  formatVersion: 1,
  application: packageJson.name,
  applicationVersion: desktopPackageJson.version,
  releaseRevision: desktopPackageJson.nautexBuildRevision ?? desktopPackageJson.nautexReleaseRevision ?? 1,
  backendVersion: packageJson.version,
  nodeEnvironment: "production",
  entrypoint: "server.js",
  packageRoot: "packages",
  schemaSha256: createHash("sha256").update(schema).digest("hex"),
};
await writeFile(path.join(outputRoot, "nautex-backend-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Prepared packageable Nautex backend at ${path.relative(projectRoot, outputRoot)}.`);
