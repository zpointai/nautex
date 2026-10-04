import fs from "node:fs";
import path from "node:path";
import { importHsBuffer } from "@/lib/datasets/hs-codes";
import { prisma } from "@/lib/prisma";

const sourcePath = process.argv[2];

async function main() {
  if (!sourcePath) {
    throw new Error("Usage: npm run hs:import -- <path-to-hs-csv-or-xlsx> [system]");
  }

  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`HS source file not found: ${resolved}`);
  }

  const result = await importHsBuffer({
    buffer: fs.readFileSync(resolved),
    fileName: path.basename(resolved),
    sourcePath: resolved,
    system: process.argv[3] || "generic",
    source: "local_import",
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
