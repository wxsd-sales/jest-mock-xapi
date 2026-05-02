import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { updateSchema } from "./update-schema.ts";

const schemaPath = fileURLToPath(new URL("../src/schemas/schema.json", import.meta.url));
const schemaMetaPath = fileURLToPath(
  new URL("../src/schemas/schema.meta.json", import.meta.url),
);

if (existsSync(schemaPath) && existsSync(schemaMetaPath)) {
  console.log("RoomOS schema cache found.");
} else {
  console.log("RoomOS schema cache missing. Fetching from roomos.cisco.com schema sources...");
  await updateSchema();
}
