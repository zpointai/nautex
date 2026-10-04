import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const sourcePath = path.resolve("assets/brand/current/nautex-app-icon.svg");
const outputDirectory = path.resolve("build");
const publicDirectory = path.resolve("public");

await mkdir(outputDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });
const masterPath = path.join(outputDirectory, "nautex-icon-1024.png");
await sharp(sourcePath).resize(1024, 1024).png().toFile(masterPath);

for (const size of [512, 256]) {
  await sharp(masterPath).resize(size, size).png().toFile(path.join(outputDirectory, `nautex-icon-${size}.png`));
}

await sharp(masterPath).resize(256, 256).png().toFile(path.join(publicDirectory, "nautex-icon-256.png"));

await writeFile(path.join(outputDirectory, "nautex.ico"), await pngToIco(path.join(outputDirectory, "nautex-icon-256.png")));
console.log(`Generated Nautex desktop icons from the approved master at ${path.relative(process.cwd(), sourcePath)}.`);
