import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = "js/modules/admin.js";
try {
  // 讀取檔案（使用 UTF-8，如果有亂碼會被解開）
  const content = readFileSync(filePath, "utf8");
  console.log("Read success, length:", content.length);
  
  // 以純 UTF-8 寫回
  writeFileSync(filePath, content, "utf8");
  console.log("Successfully rewrote js/modules/admin.js as UTF-8!");
} catch (err) {
  console.error("Error:", err);
}
