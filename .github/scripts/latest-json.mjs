// Updater manifest for .github/workflows/release.yml (same as monti-git's release.mjs latest-json):
//   node .github/scripts/latest-json.mjs > latest.json   (from the repo root, with the .sig files in ./sigs)
// The build jobs run in parallel and don't upload latest.json themselves, so they can't race to rewrite it.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const tag = process.env.GITHUB_REF_NAME;
const repo = process.env.GITHUB_REPOSITORY;
const platforms = {};
// Notes: commit subjects between the previous tag and this one (the "vX.Y.Z" bump commit is left out).
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
let notes = "";
try {
  const prev = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${tag}^`);
  notes = git("log", `${prev}..${tag}`, "--format=%s").split("\n").filter((s) => s && !/^v\d+\.\d+\.\d+$/.test(s)).map((s) => `- ${s}`).join("\n");
} catch { /* first release or no previous tag: empty notes */ }
for (const sig of readdirSync("sigs")) {
  const asset = sig.slice(0, -".sig".length);
  const entry = { signature: readFileSync(`sigs/${sig}`, "utf8").trim(), url: `https://github.com/${repo}/releases/download/${tag}/${asset}` };
  // Mac: one archive per chip (2026-11-17, each bundles its mpv); a universal one (older releases) serves both.
  // Windows: the -setup.exe installer.
  if (asset.endsWith(".app.tar.gz")) {
    const archs = asset.includes("aarch64") ? ["aarch64"] : asset.includes("x64") ? ["x86_64"] : ["aarch64", "x86_64"];
    for (const a of archs) platforms[`darwin-${a}`] = platforms[`darwin-${a}-app`] = entry;
  }
  else if (asset.endsWith("-setup.exe")) platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"] = entry;
}
if (!platforms["darwin-aarch64"] || !platforms["darwin-x86_64"] || !platforms["windows-x86_64"]) throw new Error(`missing updater files, found: ${Object.keys(platforms)}`);
console.log(JSON.stringify({ version: tag.replace(/^v/, ""), notes, pub_date: new Date().toISOString(), platforms }, null, 2));
