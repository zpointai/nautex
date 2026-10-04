import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function selectWorkspace({ defaultRoot, args, smokeRoot = "" }) {
  if (args.includes("--nautex-demo")) throw new Error("This community release contains no demo dataset. Create a fresh workspace and import authorised data.");
  const demonstration = false;
  const testRoot = args.find(value => value.startsWith("--nautex-test-profile="))?.split("=").slice(1).join("=");
  if (testRoot && (!path.isAbsolute(testRoot) || !path.basename(testRoot).startsWith("nautex-release-test-"))) throw new Error("Release tests require a dedicated absolute nautex-release-test-* profile.");
  const operationalRoot = path.resolve(testRoot || smokeRoot || defaultRoot);
  return { demonstration, root: demonstration ? `${operationalRoot}-demo` : operationalRoot };
}

export async function ensureWorkspace({ root, demonstration }) {
  await mkdir(root, { recursive: true });
  const markerPath = path.join(root, "nautex-workspace.json");
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const kind = demonstration ? "demonstration" : "operational";
  if (marker && (marker.formatVersion !== 1 || marker.kind !== kind)) {
    throw new Error("This profile belongs to a different Nautex workspace. No data was changed.");
  }
  if (!marker) {
    // Electron may have created its browser cache before this check. Existing
    // business runtime material must never be adopted as a demonstration.
    const entries = await readdir(root);
    if (demonstration && entries.some(name => ["postgres", "data", "runtime", "backups"].includes(name))) {
      throw new Error("The demonstration profile already contains unmarked runtime data. Choose a fresh profile; it will not be seeded.");
    }
    await writeFile(markerPath, `${JSON.stringify({ formatVersion: 1, kind }, null, 2)}\n`, { flag: "wx" });
  }
}

export function workspaceArguments(args, demonstration) {
  const clean = args.filter(value => value !== "--nautex-demo");
  return demonstration ? [...clean, "--nautex-demo"] : clean;
}
