import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("Windows command processor can launch the configured Node runtime", () => {
  if (process.platform !== "win32") return;
  const output = execFileSync("cmd.exe", ["/d", "/s", "/c", "node --version"], { encoding: "utf8", windowsHide: true });
  assert.match(output.trim(), /^v24\./);
});

test("PowerShell exposes the Windows notification primitives", () => {
  if (process.platform !== "win32") return;
  const command = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; if (-not ([System.Windows.Forms.NotifyIcon] -and [System.Drawing.SystemIcons]::Warning)) { exit 1 }";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "pipe", windowsHide: true });
});

test("Windows process-tree cleanup utility is available", () => {
  if (process.platform !== "win32") return;
  const output = execFileSync("taskkill.exe", ["/?"], { encoding: "utf8", windowsHide: true });
  assert.match(output, /\/PID/i);
});
