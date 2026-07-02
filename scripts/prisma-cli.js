import { spawnSync } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const prismaPkgDir = dirname(require.resolve("prisma/package.json"));
const prismaCli = join(prismaPkgDir, "build", "index.js");
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
