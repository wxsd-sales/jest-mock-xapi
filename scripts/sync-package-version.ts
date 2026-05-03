import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const packageName = "jest-mock-xapi";
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const rootPackagePath = join(rootDir, "package.json");
const rootLockfilePath = join(rootDir, "package-lock.json");
const examplesDir = join(rootDir, "examples");

interface JsonObject {
  [key: string]: unknown;
}

type DependencySection =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

const dependencySections: DependencySection[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function readJsonObject(filePath: string) {
  const json = JSON.parse(readFileSync(filePath, "utf8")) as unknown;

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error(`${filePath} did not contain a JSON object.`);
  }

  return json as JsonObject;
}

function writeJsonObject(filePath: string, json: JsonObject) {
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

function getRootPackageVersion() {
  const rootPackage = readJsonObject(rootPackagePath);
  const version = rootPackage.version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json must define a non-empty version string.");
  }

  return version;
}

function getExamplePackagePaths() {
  if (!existsSync(examplesDir)) {
    return [];
  }

  return readdirSync(examplesDir)
    .map((entry) => join(examplesDir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .map((entryPath) => join(entryPath, "package.json"))
    .filter((packagePath) => existsSync(packagePath))
    .sort();
}

function syncDependencyVersion(
  packageJson: JsonObject,
  versionRange: string,
) {
  let changed = false;

  for (const sectionName of dependencySections) {
    const section = packageJson[sectionName];

    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      continue;
    }

    const dependencies = section as Record<string, unknown>;

    if (
      Object.hasOwn(dependencies, packageName) &&
      dependencies[packageName] !== versionRange
    ) {
      dependencies[packageName] = versionRange;
      changed = true;
    }
  }

  return changed;
}

function syncExamplePackageVersions(version: string) {
  const versionRange = `^${version}`;
  const changedFiles = [];

  for (const packagePath of getExamplePackagePaths()) {
    const packageJson = readJsonObject(packagePath);

    if (syncDependencyVersion(packageJson, versionRange)) {
      writeJsonObject(packagePath, packageJson);
      changedFiles.push(packagePath);
    }
  }

  return changedFiles;
}

function syncRootLockfileVersion(version: string) {
  if (!existsSync(rootLockfilePath)) {
    return false;
  }

  const lockfile = readJsonObject(rootLockfilePath);
  let changed = false;

  if (lockfile.version !== version) {
    lockfile.version = version;
    changed = true;
  }

  const packages = lockfile.packages;
  const rootPackage =
    typeof packages === "object" && packages !== null && !Array.isArray(packages)
      ? (packages as Record<string, unknown>)[""]
      : undefined;

  if (
    typeof rootPackage === "object" &&
    rootPackage !== null &&
    !Array.isArray(rootPackage)
  ) {
    const rootPackageObject = rootPackage as JsonObject;

    if (rootPackageObject.version !== version) {
      rootPackageObject.version = version;
      changed = true;
    }
  }

  if (changed) {
    writeJsonObject(rootLockfilePath, lockfile);
  }

  return changed;
}

const version = getRootPackageVersion();
const changedExamplePackages = syncExamplePackageVersions(version);
const lockfileChanged = syncRootLockfileVersion(version);
const changedFiles = [
  ...changedExamplePackages,
  ...(lockfileChanged ? [rootLockfilePath] : []),
];

if (changedFiles.length === 0) {
  console.log(`Package versions already synced to ${version}.`);
} else {
  console.log(`Synced package versions to ${version}:`);

  for (const changedFile of changedFiles) {
    console.log(`- ${changedFile}`);
  }
}
