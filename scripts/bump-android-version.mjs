import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gradlePath = join(root, "android", "app", "build.gradle");
const pkgPath = join(root, "package.json");

let gradle = readFileSync(gradlePath, "utf8");
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
if (!codeMatch || !nameMatch) {
  console.error("versionCode/versionName not found");
  process.exit(1);
}

const nextCode = Number(codeMatch[1]) + 1;
const parts = nameMatch[1].split(".").map((n) => Number(n) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1;
if (parts[2] >= 100) {
  parts[2] = 0;
  parts[1] += 1;
}
const nextName = parts.join(".");

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`);
writeFileSync(gradlePath, gradle);

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = nextName;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Android version -> ${nextName} (versionCode ${nextCode})`);
