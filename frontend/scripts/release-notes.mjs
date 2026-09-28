import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const file = (path) => resolve(root, path);
const read = (path) => readFileSync(file(path), "utf8");
const json = (path) => JSON.parse(read(path));
const releases = json("frontend/src/release-notes.json").releases;
const latest = releases[0];
const manifest = json("manifest.json");
const packageJson = json("package.json");
const packageLock = json("package-lock.json");
const store = json(".dbx-store.json");
const backend = read("backend/main.go");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(Array.isArray(releases) && releases.length > 0, "Add at least one release note entry.");
const versions = new Set();
for (const release of releases) {
  assert(typeof release.version === "string" && /^\d+\.\d+\.\d+$/.test(release.version), "Invalid release version.");
  assert(!versions.has(release.version), `Duplicate release ${release.version}.`);
  assert(typeof release.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(release.date), `Invalid date for ${release.version}.`);
  for (const language of ["zh", "en"]) {
    assert(Array.isArray(release[language]) && release[language].length > 0 && release[language].every((item) => typeof item === "string" && item.trim()), `Missing ${language} notes for ${release.version}.`);
  }
  versions.add(release.version);
}
assert(manifest.version === latest.version, "manifest.json version must match the latest release notes.");
assert(packageJson.version === latest.version, "package.json version must match the latest release notes.");
assert(packageLock.version === latest.version && packageLock.packages[""].version === latest.version, "package-lock.json version must match the latest release notes.");
assert(backend.includes(`Version: "${latest.version}"`), "Backend metadata version must match the latest release notes.");

const storeNotes = `v${latest.version}\n${latest.zh.map((item) => `- ${item}`).join("\n")}\n\nEnglish\n${latest.en.map((item) => `- ${item}`).join("\n")}`;
const changelog = `# 更新日志 / Changelog\n\n${releases.map((release) =>
  `## v${release.version} · ${release.date}\n\n### 中文\n\n${release.zh.map((item) => `- ${item}`).join("\n")}\n\n### English\n\n${release.en.map((item) => `- ${item}`).join("\n")}`
).join("\n\n")}\n`;

if (process.argv.includes("--write")) {
  store.releaseNotes = storeNotes;
  writeFileSync(file(".dbx-store.json"), JSON.stringify(store, null, 2) + "\n");
  writeFileSync(file("CHANGELOG.md"), changelog);
  console.log(`Synchronized v${latest.version} release notes.`);
} else {
  assert(store.releaseNotes === storeNotes, ".dbx-store.json releaseNotes are stale; run npm run notes:sync.");
  assert(read("CHANGELOG.md").replace(/\r\n/g, "\n") === changelog, "CHANGELOG.md is stale; run npm run notes:sync.");
  console.log(`Release notes match v${latest.version}.`);
}
