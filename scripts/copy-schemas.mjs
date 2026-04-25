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

const sourceDir = fileURLToPath(new URL("../src/schemas", import.meta.url));
const distDir = fileURLToPath(new URL("../dist/schemas", import.meta.url));
const valuespaceKeys = [
  "Max",
  "MaxLength",
  "Min",
  "MinLength",
  "Step",
  "Values",
  "type",
];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function keepValuespace(valuespace) {
  if (!valuespace) {
    return undefined;
  }

  const kept = {};

  for (const key of valuespaceKeys) {
    if (hasOwn(valuespace, key)) {
      kept[key] = valuespace[key];
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

function keepCommandParameter(parameter) {
  const kept = {
    name: parameter.name,
  };
  const valuespace = keepValuespace(parameter.valuespace);

  if (parameter.required === true) {
    kept.required = true;
  }

  if (valuespace) {
    kept.valuespace = valuespace;
  }

  return kept;
}

function keepAttributes(schemaObject) {
  const attributes = schemaObject.attributes ?? {};
  const kept = {};

  if (
    schemaObject.type === "Command" &&
    Array.isArray(attributes.params) &&
    attributes.params.length > 0
  ) {
    kept.params = attributes.params.map(keepCommandParameter);
  }

  if (schemaObject.type === "Configuration") {
    if (hasOwn(attributes, "default")) {
      kept.default = attributes.default;
    }

    const valuespace = keepValuespace(attributes.valuespace);
    if (valuespace) {
      kept.valuespace = valuespace;
    }
  }

  if (schemaObject.type === "Status") {
    const valuespace = keepValuespace(attributes.valuespace);
    if (valuespace) {
      kept.valuespace = valuespace;
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

function pruneSchema(schema) {
  return {
    objects: schema.objects.map((schemaObject) => {
      const kept = {
        path: schemaObject.path,
        type: schemaObject.type,
      };
      const attributes = keepAttributes(schemaObject);

      if (Array.isArray(schemaObject.products) && schemaObject.products.length > 0) {
        kept.products = schemaObject.products;
      }

      if (attributes) {
        kept.attributes = attributes;
      }

      return kept;
    }),
  };
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

  const schema = JSON.parse(readFileSync(sourcePath, "utf8"));
  writeFileSync(distPath, JSON.stringify(pruneSchema(schema)));
}
