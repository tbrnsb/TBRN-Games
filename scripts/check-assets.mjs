/**
 * Verify that every file under client/assets is covered by a row in ASSETS.md.
 * Run: npm run assets:check
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const assetsRoot = join(root, "client", "assets");
const manifest = readFileSync(join(root, "ASSETS.md"), "utf8");

const patterns = [...manifest.matchAll(/`([^`]+)`/g)]
  .map((m) => m[1])
  .map((p) => (p.endsWith(".woff2") ? `client/assets/fonts/${p}` : p))
  .filter((p) => p.startsWith("client/assets/") && !p.includes(" "));

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "{") {
      const end = glob.indexOf("}", i);
      const options = glob.slice(i + 1, end).split(",");
      out += `(?:${options.map(escapeRe).join("|")})`;
      i = end;
    } else if (c === "*") {
      out += ".*";
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(`^${out}$`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const regexes = patterns.map(globToRegExp);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(root, full).split("\\").join("/"));
  }
  return out;
}

const files = walk(assetsRoot);
const missing = files.filter((file) => !regexes.some((re) => re.test(file)));

if (missing.length) {
  console.error("[assets:check] files not listed in ASSETS.md:");
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`[assets:check] ${files.length} files covered by ${patterns.length} manifest patterns`);
