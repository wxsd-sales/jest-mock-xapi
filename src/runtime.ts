import path from "node:path";
import { fileURLToPath } from "node:url";

declare global {
  function _main_module_name(): string;
}

const currentModulePath = path.normalize(fileURLToPath(import.meta.url));
const sourceMappedRuntimePath = path.normalize(
  fileURLToPath(new URL("../src/runtime.ts", import.meta.url)),
);
const runtimeModulePaths = new Set([
  currentModulePath,
  sourceMappedRuntimePath,
]);
const macroSourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function stripSourceLocation(location: string) {
  return location
    .trim()
    .replace(/:\d+:\d+$/, "")
    .replace(/:\d+$/, "");
}

function extractStackLocation(stackLine: string) {
  const frame = stackLine.trim().replace(/^at\s+/, "");
  const parenthesizedLocation = frame.match(/\((.*)\)$/)?.[1];
  const rawLocation = stripSourceLocation(parenthesizedLocation ?? frame);

  if (
    rawLocation === "" ||
    rawLocation.startsWith("node:") ||
    rawLocation.includes("<anonymous>")
  ) {
    return null;
  }

  if (rawLocation.startsWith("file://")) {
    try {
      return fileURLToPath(rawLocation);
    } catch {
      return null;
    }
  }

  if (
    rawLocation.includes("/") ||
    rawLocation.includes("\\") ||
    /^[A-Za-z]:\\/.test(rawLocation)
  ) {
    return rawLocation;
  }

  return null;
}

function sourcePathToModuleName(sourcePath: string) {
  const extension = path.extname(sourcePath);
  const normalizedExtension = extension.toLowerCase();

  if (macroSourceExtensions.has(normalizedExtension)) {
    return path.basename(sourcePath, extension);
  }

  return path.basename(sourcePath);
}

function isRuntimeModulePath(sourcePath: string) {
  return runtimeModulePaths.has(sourcePath);
}

function mainModuleName() {
  const stackLines = new Error().stack?.split("\n").slice(1) ?? [];

  for (const stackLine of stackLines) {
    const stackLocation = extractStackLocation(stackLine);

    if (!stackLocation) {
      continue;
    }

    const normalizedLocation = path.normalize(stackLocation);

    if (isRuntimeModulePath(normalizedLocation)) {
      continue;
    }

    return sourcePathToModuleName(normalizedLocation);
  }

  return "";
}

export function installMacroRuntimeGlobals() {
  if (typeof globalThis._main_module_name === "function") {
    return;
  }

  Object.defineProperty(globalThis, "_main_module_name", {
    configurable: true,
    value: mainModuleName,
    writable: true,
  });
}

installMacroRuntimeGlobals();
