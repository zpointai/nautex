import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnvironment(directory = process.cwd()) {
  const envPath = path.resolve(directory, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}
