import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { pruneSchema, type SchemaDocument } from "./schema-utils.ts";

interface SchemaIndexEntry {
  lastUpdated?: string;
  name: string;
}

interface SelectedSchema {
  majorVersion: number;
  schema: SchemaIndexEntry;
}

export const SCHEMAS_INDEX_URL =
  "https://raw.githubusercontent.com/cisco-ce/roomos.cisco.com/master/schemas/schemas.json";
export const SCHEMA_BASE_URL =
  "https://raw.githubusercontent.com/cisco-ce/roomos.cisco.com/master/schemas";

const schemaOutputPath = fileURLToPath(
  new URL("../src/schemas/schema.json", import.meta.url),
);
const schemaMetaOutputPath = fileURLToPath(
  new URL("../src/schemas/schema.meta.json", import.meta.url),
);

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function getSchemaDownloadUrl(schemaName: string) {
  return `${SCHEMA_BASE_URL}/${encodeURIComponent(schemaName)}.json`;
}

function getVersionParts(schemaName: string) {
  const versionMatch = schemaName.match(/^(\d+(?:\.\d+)*)/);

  if (!versionMatch) {
    return [];
  }

  return versionMatch[1].split(".").map((part) => Number.parseInt(part, 10));
}

function getMajorVersion(schemaName: string) {
  return getVersionParts(schemaName)[0];
}

function compareSchemasByVersion(
  left: SchemaIndexEntry,
  right: SchemaIndexEntry,
) {
  const leftVersion = getVersionParts(left.name);
  const rightVersion = getVersionParts(right.name);
  const versionLength = Math.max(leftVersion.length, rightVersion.length);

  for (let index = 0; index < versionLength; index += 1) {
    const leftPart = leftVersion[index] ?? 0;
    const rightPart = rightVersion[index] ?? 0;

    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }

  return (
    new Date(right.lastUpdated ?? 0).getTime() -
    new Date(left.lastUpdated ?? 0).getTime()
  );
}

function getLatestSchemasByMajor(index: SchemaIndexEntry[]): SelectedSchema[] {
  const latestSchemasByMajor = new Map<number, SchemaIndexEntry>();

  for (const schema of index) {
    const majorVersion = getMajorVersion(schema.name);

    if (typeof majorVersion !== "number" || !Number.isInteger(majorVersion)) {
      continue;
    }

    const existingSchema = latestSchemasByMajor.get(majorVersion);

    if (!existingSchema || compareSchemasByVersion(schema, existingSchema) < 0) {
      latestSchemasByMajor.set(majorVersion, schema);
    }
  }

  return [...latestSchemasByMajor.entries()]
    .sort(([leftMajor], [rightMajor]) => rightMajor - leftMajor)
    .map(([majorVersion, schema]) => ({
      majorVersion,
      schema,
    }));
}

function getSelectedSchemas(index: SchemaIndexEntry[]): SelectedSchema[] {
  const requestedSchemaName = process.env.ROOMOS_SCHEMA_NAME;

  if (requestedSchemaName) {
    const requestedSchema = index.find((schema) => schema.name === requestedSchemaName);

    if (!requestedSchema) {
      throw new Error(
        `ROOMOS_SCHEMA_NAME="${requestedSchemaName}" was not found in ${SCHEMAS_INDEX_URL}`,
      );
    }

    const majorVersion = getMajorVersion(requestedSchema.name);

    if (typeof majorVersion !== "number" || !Number.isInteger(majorVersion)) {
      throw new Error(
        `ROOMOS_SCHEMA_NAME="${requestedSchemaName}" does not begin with a major version.`,
      );
    }

    return [
      {
        majorVersion,
        schema: requestedSchema,
      },
    ];
  }

  return getLatestSchemasByMajor(index);
}

export async function updateSchema() {
  const index = await fetchJson<SchemaIndexEntry[]>(SCHEMAS_INDEX_URL);

  if (!Array.isArray(index)) {
    throw new Error(`Schema index from ${SCHEMAS_INDEX_URL} was not an array.`);
  }

  const selectedSchemas = getSelectedSchemas(index);

  if (selectedSchemas.length === 0) {
    throw new Error(`No versioned schemas found in ${SCHEMAS_INDEX_URL}`);
  }

  const schemas = [];

  for (const { majorVersion, schema: selectedSchema } of selectedSchemas) {
    const schemaUrl = getSchemaDownloadUrl(selectedSchema.name);
    const schema = await fetchJson<SchemaDocument>(schemaUrl);

    schemas.push({
      lastUpdated: selectedSchema.lastUpdated,
      majorVersion,
      name: selectedSchema.name,
      schema: pruneSchema(schema),
      url: schemaUrl,
    });

    console.log(
      `Fetched RoomOS ${majorVersion} schema ${selectedSchema.name} from ${schemaUrl} (${schema.objects.length} objects).`,
    );
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    schemaBaseUrl: SCHEMA_BASE_URL,
    schemaIndexUrl: SCHEMAS_INDEX_URL,
    schemas: schemas.map(({ lastUpdated, majorVersion, name, url }) => ({
      lastUpdated,
      majorVersion,
      name,
      url,
    })),
  };

  mkdirSync(dirname(schemaOutputPath), { recursive: true });
  writeFileSync(
    schemaOutputPath,
    `${JSON.stringify({
      generatedAt: metadata.generatedAt,
      schemaBaseUrl: SCHEMA_BASE_URL,
      schemaIndexUrl: SCHEMAS_INDEX_URL,
      schemas,
    })}\n`,
  );
  writeFileSync(schemaMetaOutputPath, `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(`Updated ${schemas.length} RoomOS major release schemas.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateSchema();
}
