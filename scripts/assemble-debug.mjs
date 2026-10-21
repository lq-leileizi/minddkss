import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(root, "android");
const isWin = process.platform === "win32";
const gradlew = join(androidDir, isWin ? "gradlew.bat" : "gradlew");

const env = { ...process.env };
if (!env.JAVA_HOME) {
  // best-effort on this machine; CI should set JAVA_HOME
}
if (!env.ANDROID_HOME && process.env.LOCALAPPDATA) {
  const sdk = join(process.env.LOCALAPPDATA, "Android", "Sdk");
  if (existsSync(sdk)) {
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
  }
}

const r = spawnSync(gradlew, ["assembleDebug", "--no-daemon"], {
  cwd: androidDir,
  env,
  stdio: "inherit",
  shell: isWin,
});
if (r.status !== 0) process.exit(r.status ?? 1);

const apk = join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const out1 = join(root, "poker-debug.apk");
const out2 = join(homedir(), "Desktop", "poker-debug.apk");
copyFileSync(apk, out1);
try {
  copyFileSync(apk, out2);
} catch {
  /* desktop optional */
}
console.log("APK ready:", out1);
