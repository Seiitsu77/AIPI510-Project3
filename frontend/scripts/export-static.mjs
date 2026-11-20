import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  { stdio: "inherit", env: { ...process.env, NEXT_STATIC_EXPORT: "1" } },
);
if (result.status !== 0) process.exit(result.status || 1);
await writeFile(
  "out/vercel.json",
  JSON.stringify({ framework: null, cleanUrls: true }, null, 2),
);
console.log(
  "Static Next.js export ready in out/. Deploy with: vercel deploy out --temporary --yes",
);
