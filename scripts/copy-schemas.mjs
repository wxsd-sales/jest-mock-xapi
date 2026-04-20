import { cpSync, existsSync, mkdirSync } from "fs";

const sourceDir = new URL("../src/schemas", import.meta.url);
const distDir = new URL("../dist/schemas", import.meta.url);

if (!existsSync(sourceDir)) {
  throw new Error("Schema source directory not found: src/schemas");
}

mkdirSync(distDir, { recursive: true });
cpSync(sourceDir, distDir, { recursive: true });
