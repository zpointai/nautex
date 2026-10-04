import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2.12.0";
const SOURCE_URL = `https://github.com/winsw/winsw/releases/download/v${VERSION}/WinSW.NET461.exe`;
const EXPECTED_SHA256 = "B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = path.resolve(process.env.NAUTEX_WINSW_BINARY
  || path.join(projectRoot, ".desktop-vendor", `WinSW.NET461-${VERSION}.exe`));
const outputRoot = path.join(projectRoot, ".desktop-build", "service-wrapper");

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex").toUpperCase();
}

try {
  await stat(sourcePath);
} catch {
  throw new Error(`WinSW ${VERSION} is missing at ${sourcePath}. Download it from ${SOURCE_URL}.`);
}
const actualSha256 = await sha256(sourcePath);
if (actualSha256 !== EXPECTED_SHA256) {
  throw new Error(`WinSW checksum mismatch. Expected ${EXPECTED_SHA256}, received ${actualSha256}.`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(sourcePath, path.join(outputRoot, "WinSW.exe"));
await cp(path.join(projectRoot, "third-party", "WinSW-LICENSE.txt"), path.join(outputRoot, "WinSW-LICENSE.txt"));
await writeFile(path.join(outputRoot, "nautex-service-wrapper-manifest.json"), `${JSON.stringify({
  formatVersion: 1,
  product: "WinSW",
  version: VERSION,
  sourceUrl: SOURCE_URL,
  sha256: EXPECTED_SHA256,
  license: "MIT",
}, null, 2)}\n`, "utf8");
if (!(await readFile(path.join(outputRoot, "WinSW-LICENSE.txt"), "utf8")).trim()) throw new Error("WinSW license is empty.");
console.log(`Prepared WinSW ${VERSION} service wrapper.`);
