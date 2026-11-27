import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export function signalProcessTree(child, force = false, platform = process.platform) {
  if (!child?.pid) return;
  if (platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], {
      stdio: "ignore", windowsHide: true
    });
    killer.on("error", () => {});
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {} }
}

export async function terminateProcessTree(child, timeoutMs = 5000, platform = process.platform) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const waitForExit = () => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise(resolve => child.once("exit", resolve));
  const gracefulExit = waitForExit();
  signalProcessTree(child, false, platform);
  await Promise.race([gracefulExit, delay(timeoutMs)]);
  if (child.exitCode === null && child.signalCode === null) {
    const forcedExit = waitForExit();
    signalProcessTree(child, true, platform);
    await Promise.race([forcedExit, delay(2000)]);
  }
}
