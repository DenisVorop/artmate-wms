import { readFileSync } from "node:fs";

// Keep clean CI/container installs independent of private developer registries.
const lock = readFileSync(new URL("../yarn.lock", import.meta.url), "utf8");
const references = [...lock.matchAll(/^\s+resolved "([^"\r\n]+)"$/gm)];
const allowed = new Set(["registry.npmjs.org", "registry.yarnpkg.com"]);
const invalid = references.some(([, value]) => {
  try {
    const url = new URL(value);
    return url.protocol !== "https:" || !allowed.has(url.hostname) ||
      Boolean(url.username || url.password || url.port);
  } catch {
    return true;
  }
});
if (!references.length || invalid) {
  console.error("Dependency sources must use public npm HTTPS URLs without credentials. Preserve versions and integrity hashes when repairing yarn.lock.");
  process.exitCode = 1;
} else {
  console.log(`Dependency sources OK: ${references.length} public HTTPS archives.`);
}
