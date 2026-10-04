import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const PROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$inputBytes=[Convert]::FromBase64String($env:NAUTEX_DPAPI_INPUT)",
  "$outputBytes=[Security.Cryptography.ProtectedData]::Protect($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)",
  "[Console]::Out.Write([Convert]::ToBase64String($outputBytes))",
].join("; ");

const UNPROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$inputBytes=[Convert]::FromBase64String($env:NAUTEX_DPAPI_INPUT)",
  "$outputBytes=[Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)",
  "[Console]::Out.Write([Convert]::ToBase64String($outputBytes))",
].join("; ");

async function runDpapi(script, value) {
  if (process.platform !== "win32") throw new Error("Windows machine secret protection is only available on Windows.");
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, NAUTEX_DPAPI_INPUT: Buffer.from(value).toString("base64") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Windows secret protection failed: ${stderr.trim() || `exit code ${code}`}`));
      else resolve(Buffer.from(stdout.trim(), "base64"));
    });
  });
}

export function createWindowsMachineSecretStorage() {
  return {
    isEncryptionAvailable: () => process.platform === "win32",
    encryptString: async (value) => runDpapi(PROTECT_SCRIPT, Buffer.from(value, "utf8")),
    decryptString: async (value) => (await runDpapi(UNPROTECT_SCRIPT, value)).toString("utf8"),
  };
}

export async function readWindowsMachineProtectedString(filePath) {
  const encrypted = await readFile(filePath);
  return (await runDpapi(UNPROTECT_SCRIPT, encrypted)).toString("utf8");
}
