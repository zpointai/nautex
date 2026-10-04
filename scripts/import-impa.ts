import fs from "node:fs";
import path from "node:path";
import { importImpaBuffer } from "@/lib/datasets/impa";
import { prisma } from "@/lib/prisma";

const sourcePath = process.argv[2];
if (!sourcePath || sourcePath.startsWith("--")) throw new Error("Usage: npm run impa:import -- <authorised-catalogue.csv>");

async function main() {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`IMPA source file not found: ${resolved}`);
  }

  const result = await importImpaBuffer({
    buffer: fs.readFileSync(resolved),
    fileName: path.basename(resolved),
    sourcePath: resolved,
    includeChandlerCodes: process.argv.includes("--include-chandler"),
    includeDeleted: !process.argv.includes("--exclude-deleted"),
    edition: "User-authorised import",
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
