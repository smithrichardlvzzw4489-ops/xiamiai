/* 删除本地构建缓存，缓解磁盘占满（ENOSPC）时无法写入的问题。 */
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const targets = [".next"];

for (const name of targets) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`Removed ${name}`);
  }
}
