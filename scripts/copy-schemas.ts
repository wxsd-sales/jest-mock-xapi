import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { pruneSchema, type SchemaDocument } from "./schema-utils.ts";

const sourceDir = fileURLToPath(new URL("../src/schemas", import.meta.url));
const distDir = fileURLToPath(new URL("../dist/schemas", import.meta.url));

function isSchemaDocument(value: unknown): value is SchemaDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { objects?: unknown }).objects)
  );
}

if (!existsSync(sourceDir)) {
  throw new Error("Schema source directory not found: src/schemas");
}

rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });

for (const file of readdirSync(sourceDir)) {
  const sourcePath = join(sourceDir, file);
  const distPath = join(distDir, file);

  if (!file.endsWith(".json")) {
    copyFileSync(sourcePath, distPath);
    continue;
  }

  const json = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;

  if (isSchemaDocument(json)) {
    writeFileSync(distPath, JSON.stringify(pruneSchema(json)));
  } else {
    writeFileSync(distPath, JSON.stringify(json, null, 2));
  }
}
