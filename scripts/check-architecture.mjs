import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("apps/web/src");
const levels = {
  _app: 0,
  _pages: 1,
  widgets: 2,
  features: 3,
  entities: 4,
  shared: 5,
};
const aliases = {
  app: "_app",
  pages: "_pages",
  widgets: "widgets",
  features: "features",
  entities: "entities",
  shared: "shared",
};
let count = 0;
const errors = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "generated") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(p);
      continue;
    }
    if (!/\.tsx?$/.test(p)) continue;
    count++;
    const rel = path.relative(root, p);
    const [layer, slice] = rel.split(path.sep);
    const text = await readFile(p, "utf8");
    for (const match of text.matchAll(
      /(?:from\s*|import\s*)["']@\/(app|pages|widgets|features|entities|shared)\/([^"']+)["']/g,
    )) {
      const target = aliases[match[1]];
      const targetSlice = match[2].split("/")[0];
      if (levels[target] < levels[layer])
        errors.push(`${rel}: запрещён импорт вверх в ${target}`);
      if (
        target === layer &&
        ["features", "entities", "widgets"].includes(layer) &&
        targetSlice !== slice
      )
        errors.push(`${rel}: импорт соседнего слайса ${targetSlice}`);
      if (
        ["features", "entities", "widgets"].includes(target) &&
        targetSlice !== slice &&
        match[2].split("/").length > 1
      )
        errors.push(`${rel}: используй public API слайса ${targetSlice}`);
    }
  }
}
await visit(root);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`FSD boundaries OK: ${count} source files checked.`);
