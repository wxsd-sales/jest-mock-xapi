import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jest, test } from "@jest/globals";
import jsxapi from "jsxapi";
import { createXapi } from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvPath = resolve(repoRoot, ".env");
const readmePath = resolve(repoRoot, "README.md");
const defaultConnectTimeoutMs = 20000;
const defaultTestTimeoutMs = 120000;
const readmeResultsStartMarker = "<!-- roomos-parity-results:start -->";
const readmeResultsEndMarker = "<!-- roomos-parity-results:end -->";

function getValueKind(value) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function serializeValue(value) {
  const valueKind = getValueKind(value);

  if (valueKind === "undefined") {
    return { valueKind };
  }

  if (valueKind === "function") {
    return {
      value: "[Function]",
      valueKind,
    };
  }

  return {
    value,
    valueKind,
  };
}

function serializeError(error) {
  if (typeof error !== "object" || error === null) {
    return {
      message: String(error),
      valueKind: getValueKind(error),
    };
  }

  return {
    code: error.code,
    message: error.message ?? String(error),
    name: error.name,
  };
}

async function captureProbe(name, invoke, context) {
  try {
    const value = await invoke(context);

    return {
      name,
      ok: true,
      ...serializeValue(value),
    };
  } catch (error) {
    return {
      error: serializeError(error),
      name,
      ok: false,
    };
  }
}

function createSubscriptionProbe(subscribe) {
  return (context) => {
    const unsubscribe = subscribe(context.xapi, () => undefined);
    const unsubscribeKind = typeof unsubscribe;

    if (unsubscribeKind === "function") {
      unsubscribe();
    }

    return unsubscribe;
  };
}

function createAlertCommandParams(text) {
  return {
    Duration: 1,
    Text: text,
    Title: "xAPI parity",
  };
}

function createProbeDefinitions({ includeCommand, includeConfigSet }) {
  const probes = [
    {
      compare: "exact",
      name: "xapi.version",
      run: ({ xapi }) => xapi.version,
    },
    {
      compare: "function",
      name: "xapi.close",
      run: ({ xapi }) => xapi.close,
    },
    {
      compare: "exact",
      name: "xapi.Status.SystemUnit.ProductPlatform.get",
      run: ({ xapi }) => xapi.Status.SystemUnit.ProductPlatform.get(),
    },
    {
      compare: "exact",
      name: "xapi.status.get(SystemUnit/ProductPlatform)",
      run: ({ xapi }) => xapi.status.get("SystemUnit/ProductPlatform"),
    },
    {
      compare: "format",
      name: "xapi.Status.Audio.Volume.get",
      run: ({ xapi }) => xapi.Status.Audio.Volume.get(),
    },
    {
      compare: "format",
      name: "xapi.status.get(Audio Volume)",
      run: ({ xapi }) => xapi.status.get("Audio Volume"),
    },
    {
      compare: "format",
      name: "xapi.Config.SystemUnit.Name.get",
      run: ({ xapi }) => xapi.Config.SystemUnit.Name.get(),
    },
    {
      compare: "format",
      name: "xapi.config.get(SystemUnit/Name)",
      run: ({ xapi }) => xapi.config.get(["SystemUnit", "Name"]),
    },
    {
      compare: "array-shape",
      name: "xapi.Config.Video.Output.Connector.get",
      run: ({ xapi }) => xapi.Config.Video.Output.Connector.get(),
    },
    {
      compare: "format",
      name: "xapi.doc(Status/Audio/Volume)",
      run: ({ xapi }) => xapi.doc("Status/Audio/Volume"),
    },
    {
      compare: "format",
      name: "xapi.doc(Status Audio Volume)",
      run: ({ xapi }) => xapi.doc("Status Audio Volume"),
    },
    {
      compare: "format",
      name: "xapi.doc([Status,Audio,Volume])",
      run: ({ xapi }) => xapi.doc(["Status", "Audio", "Volume"]),
    },
    {
      compare: "format",
      name: "xapi.doc(Config/SystemUnit/Name)",
      run: ({ xapi }) => xapi.doc("Config/SystemUnit/Name"),
    },
    {
      compare: "format",
      name: "xapi.doc(Configuration/SystemUnit/Name)",
      run: ({ xapi }) => xapi.doc("Configuration/SystemUnit/Name"),
    },
    {
      compare: "format",
      name: "xapi.doc(Command/UserInterface/Message/Alert/Display)",
      run: ({ xapi }) =>
        xapi.doc("Command/UserInterface/Message/Alert/Display"),
    },
    {
      compare: "format",
      name: "xapi.doc(Event/UserInterface/Extensions/Widget/Action)",
      run: ({ xapi }) =>
        xapi.doc("Event/UserInterface/Extensions/Widget/Action"),
    },
    {
      compare: "error-format",
      name: "xapi.status.get(Not/A/Real/Status)",
      run: ({ xapi }) => xapi.status.get("Not/A/Real/Status"),
    },
    {
      compare: "error-format",
      name: "xapi.config.get(Not/A/Real/Config)",
      run: ({ xapi }) => xapi.config.get("Not/A/Real/Config"),
    },
    {
      compare: "error-format",
      name: "xapi.command(Not/A/Real/Command)",
      run: ({ xapi }) => xapi.command("Not/A/Real/Command"),
    },
    {
      compare: "error-format",
      name: "xapi.command(Audio/Volume/Set,bad-level)",
      run: ({ xapi }) => xapi.command("Audio/Volume/Set", { Level: 120 }),
    },
    {
      compare: "error-format",
      name: "xapi.Command.Audio.Volume.Set(missing-level)",
      run: ({ xapi }) => xapi.Command.Audio.Volume.Set({}),
    },
    {
      compare: "function",
      name: "xapi.Status.Audio.Volume.on",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Status.Audio.Volume.on(listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.status.once(Audio/Volume)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.status.once("Audio/Volume", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.config.on(SystemUnit/Name)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.config.on("SystemUnit/Name", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Config.Audio.DefaultVolume.once",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Config.Audio.DefaultVolume.once(listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.event.on(UserInterface/Extensions/Widget/Action)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.event.on("UserInterface/Extensions/Widget/Action", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Event.UserInterface.Extensions.Widget.Action.once",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Event.UserInterface.Extensions.Widget.Action.once(listener),
      ),
    },
  ];

  if (includeConfigSet) {
    probes.push({
      compare: "format",
      name: "xapi.config.set(SystemUnit/Name,current)",
      run: async ({ xapi }) => {
        const currentName = await xapi.config.get("SystemUnit/Name");
        return xapi.config.set("SystemUnit/Name", currentName);
      },
    });
  }

  if (includeCommand) {
    probes.push({
      compare: "exact",
      name: "xapi.command(UserInterface/Message/Alert/Display)",
      run: ({ xapi }) =>
        xapi.command(
          "UserInterface/Message/Alert/Display",
          createAlertCommandParams("jest-mock-xapi parity probe"),
        ),
    });
    probes.push({
      compare: "exact",
      name: "xapi.Command.UserInterface.Message.Alert.Clear",
      run: ({ xapi }) => xapi.Command.UserInterface.Message.Alert.Clear(),
    });
  }

  return probes;
}

async function collectReport(xapi, probes) {
  const context = { xapi };
  const results = [];

  for (const probe of probes) {
    results.push(await captureProbe(probe.name, probe.run, context));
  }

  return {
    generatedAt: new Date().toISOString(),
    results,
  };
}

function byName(report) {
  return new Map(report.results.map((result) => [result.name, result]));
}

function getObjectKeys(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function getArrayItemShape(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => getObjectKeys(item).join(","));
}

function describeArrayShape(value) {
  if (!Array.isArray(value)) {
    return "not array";
  }

  return getArrayItemShape(value)
    .map((shape, index) => `${index + 1}{${shape}}`)
    .join(" ");
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function summarizeValue(result) {
  if (!result.ok) {
    return `error ${result.error?.code ?? ""} ${result.error?.message ?? ""}`.trim();
  }

  if (result.valueKind === "undefined") {
    return "undefined";
  }

  if (result.valueKind === "function") {
    return "function";
  }

  if (result.valueKind === "array") {
    return `array(${result.value?.length ?? 0})`;
  }

  if (result.valueKind === "object") {
    return `object{${getObjectKeys(result.value).join(",")}}`;
  }

  return `${result.valueKind}:${String(result.value)}`;
}

function compareProbe(probe, liveResult, mockResult) {
  if (!liveResult) {
    return {
      details: "missing live result",
      name: probe.name,
      pass: false,
    };
  }

  if (!mockResult) {
    return {
      details: "missing mock result",
      name: probe.name,
      pass: false,
    };
  }

  if (probe.compare === "error-format") {
    if (liveResult.ok || mockResult.ok) {
      return {
        details: `expected errors: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
        name: probe.name,
        pass: false,
      };
    }

    const liveMessageKind = typeof liveResult.error?.message;
    const mockMessageKind = typeof mockResult.error?.message;
    const pass =
      liveResult.error?.code === mockResult.error?.code &&
      liveMessageKind === mockMessageKind;

    return {
      details: pass
        ? "matching error code and message format"
        : `error mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (liveResult.ok !== mockResult.ok) {
    return {
      details: `ok mismatch: live ${liveResult.ok}, mock ${mockResult.ok}`,
      name: probe.name,
      pass: false,
    };
  }

  if (!liveResult.ok || !mockResult.ok) {
    const liveMessageKind = typeof liveResult.error?.message;
    const mockMessageKind = typeof mockResult.error?.message;
    const pass =
      liveResult.error?.code === mockResult.error?.code &&
      liveMessageKind === mockMessageKind;

    return {
      details: pass
        ? "matching error format"
        : `error mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (liveResult.valueKind !== mockResult.valueKind) {
    return {
      details: `kind mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass: false,
    };
  }

  if (probe.compare === "exact") {
    const pass = sameJson(liveResult.value, mockResult.value);

    return {
      details: pass
        ? "exact match"
        : `value mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (probe.compare === "function") {
    const pass = liveResult.valueKind === "function" && mockResult.valueKind === "function";

    return {
      details: pass
        ? "both returned unsubscribe/callable function"
        : `function mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (probe.compare === "object-keys") {
    const pass = sameJson(getObjectKeys(liveResult.value), getObjectKeys(mockResult.value));

    return {
      details: pass
        ? "matching object keys"
        : `object key mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (probe.compare === "array-shape") {
    const liveShape = getArrayItemShape(liveResult.value);
    const mockShape = getArrayItemShape(mockResult.value);
    const pass =
      liveResult.value.length === mockResult.value.length &&
      sameJson(liveShape, mockShape);

    return {
      details: pass
        ? "matching array length and item keys"
        : `array shape mismatch: live ${summarizeValue(liveResult)} ${describeArrayShape(liveResult.value)}, mock ${summarizeValue(mockResult)} ${describeArrayShape(mockResult.value)}`,
      name: probe.name,
      pass,
    };
  }

  if (liveResult.valueKind === "object") {
    const pass = sameJson(getObjectKeys(liveResult.value), getObjectKeys(mockResult.value));

    return {
      details: pass
        ? "matching object format"
        : `object format mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  return {
    details: "matching value kind",
    name: probe.name,
    pass: true,
  };
}

function compareReports(liveReport, mockReport, probes) {
  const liveResults = byName(liveReport);
  const mockResults = byName(mockReport);

  return probes.map((probe) =>
    compareProbe(probe, liveResults.get(probe.name), mockResults.get(probe.name)),
  );
}

function stripInlineComment(value) {
  let quote = "";
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "#") {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);

  if (quote === "'") {
    return inner;
  }

  return inner
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function parseDotEnv(contents) {
  const env = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/.exec(
      line,
    );

    if (!match) {
      continue;
    }

    const [, key, rawValue = ""] = match;
    const value = stripInlineComment(rawValue);
    env[key] = unquoteEnvValue(value);
  }

  return env;
}

function loadEnv() {
  const envPath = resolve(process.env.ROOMOS_PARITY_ENV ?? defaultEnvPath);
  const fileEnv = existsSync(envPath)
    ? parseDotEnv(readFileSync(envPath, "utf8"))
    : {};

  return {
    env: {
      ...fileEnv,
      ...process.env,
    },
    envPath,
  };
}

function parseBoolean(value, defaultValue) {
  if (typeof value === "undefined" || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parsePositiveInteger(value, defaultValue) {
  if (typeof value === "undefined" || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function getCommonCredentials(env) {
  return {
    password: env.ROOMOS_PARITY_PASSWORD ?? env.ROOMOS_PARITY_PASS,
    username: env.ROOMOS_PARITY_USERNAME ?? env.ROOMOS_PARITY_USER,
  };
}

function normalizeDevice(device, label, defaults = {}) {
  const normalizedDevice =
    typeof device === "string" ? { address: device } : device;

  if (typeof normalizedDevice !== "object" || normalizedDevice === null) {
    throw new Error(`${label} must be an object or address string.`);
  }

  const address = normalizedDevice.address ?? normalizedDevice.host;
  const username =
    normalizedDevice.username ?? normalizedDevice.user ?? defaults.username;
  const password =
    normalizedDevice.password ?? normalizedDevice.pass ?? defaults.password;

  if (!address || !username || typeof password === "undefined") {
    throw new Error(
      `${label} must include an address and shared ROOMOS_PARITY_USERNAME/ROOMOS_PARITY_PASSWORD credentials.`,
    );
  }

  return {
    address: String(address),
    password: String(password),
    port: normalizedDevice.port
      ? Number.parseInt(normalizedDevice.port, 10)
      : undefined,
    username: String(username),
  };
}

function parseAddressDevices(env) {
  if (!env.ROOMOS_PARITY_ADDRESSES) {
    return [];
  }

  let addresses;

  try {
    addresses = JSON.parse(env.ROOMOS_PARITY_ADDRESSES);
  } catch (error) {
    throw new Error(
      `ROOMOS_PARITY_ADDRESSES must be a JSON string array: ${error.message}`,
    );
  }

  if (!Array.isArray(addresses)) {
    throw new Error("ROOMOS_PARITY_ADDRESSES must be a JSON string array.");
  }

  const defaults = getCommonCredentials(env);

  return addresses.map((address, index) => {
    if (typeof address !== "string") {
      throw new Error(`ROOMOS_PARITY_ADDRESSES[${index}] must be a string.`);
    }

    return normalizeDevice(
      address,
      `ROOMOS_PARITY_ADDRESSES[${index}]`,
      defaults,
    );
  });
}

function parseJsonDevices(env) {
  if (!env.ROOMOS_PARITY_DEVICES) {
    return [];
  }

  let devices;

  try {
    devices = JSON.parse(env.ROOMOS_PARITY_DEVICES);
  } catch (error) {
    throw new Error(
      `ROOMOS_PARITY_DEVICES must be a JSON array: ${error.message}`,
    );
  }

  if (!Array.isArray(devices)) {
    throw new Error("ROOMOS_PARITY_DEVICES must be a JSON array.");
  }

  const defaults = getCommonCredentials(env);

  return devices.map((device, index) =>
    normalizeDevice(device, `ROOMOS_PARITY_DEVICES[${index}]`, defaults),
  );
}

function parseNumberedDevices(env) {
  const deviceGroups = new Map();
  const defaults = getCommonCredentials(env);

  for (const [key, value] of Object.entries(env)) {
    const match = /^ROOMOS_PARITY_DEVICE_(\d+)_(ADDRESS|HOST|NAME|PASS|PASSWORD|PORT|PROTOCOL|USER|USERNAME)$/i.exec(
      key,
    );

    if (!match) {
      continue;
    }

    const [, rawIndex, rawField] = match;
    const index = Number.parseInt(rawIndex, 10);
    const field = rawField.toLowerCase();
    const device = deviceGroups.get(index) ?? {};

    if (field === "host") {
      device.address = value;
    } else if (field === "user") {
      device.username = value;
    } else if (field === "pass") {
      device.password = value;
    } else {
      device[field] = value;
    }

    deviceGroups.set(index, device);
  }

  return [...deviceGroups.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([index, device]) =>
      normalizeDevice(
        device,
        `ROOMOS_PARITY_DEVICE_${index}`,
        defaults,
      ),
    );
}

function parseDevices(env, envPath) {
  const devices = [
    ...parseAddressDevices(env),
    ...parseJsonDevices(env),
    ...parseNumberedDevices(env),
  ];

  if (devices.length === 0) {
    throw new Error(
      `Missing RoomOS parity devices. Add ROOMOS_PARITY_ADDRESSES, ROOMOS_PARITY_USERNAME, and ROOMOS_PARITY_PASSWORD to ${envPath}.`,
    );
  }

  return devices;
}

function hasConnectionProtocol(address) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(address);
}

function appendPort(address, port) {
  if (!port || hasConnectionProtocol(address) || /:\d+$/.test(address)) {
    return address;
  }

  return `${address}:${port}`;
}

function getConnectionUrls(device) {
  if (hasConnectionProtocol(device.address)) {
    return [device.address];
  }

  const address = appendPort(device.address, device.port);

  return [`ssh://${address}`, `wss://${address}`];
}

function sanitizeConnectionUrl(connectionUrl) {
  try {
    const url = new URL(connectionUrl);

    if (url.username || url.password) {
      url.username = url.username ? "redacted" : "";
      url.password = url.password ? "redacted" : "";
    }

    return url.toString();
  } catch {
    return connectionUrl;
  }
}

function getDeviceAddressLabel(device) {
  return sanitizeConnectionUrl(device.address);
}

function connectDeviceUrl(device, connectionUrl, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer;
    let xapi;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (xapi) {
        xapi.removeListener("ready", onReady);
        xapi.removeListener("error", onError);
      }

      callback(value);
    };

    const onReady = (readyXapi) => {
      settle(resolvePromise, readyXapi ?? xapi);
    };

    const onError = (error) => {
      try {
        xapi?.close();
      } catch {
        // Closing is best-effort after a connection error.
      }

      settle(rejectPromise, error);
    };

    try {
      xapi = jsxapi
        .connect(connectionUrl, {
          username: device.username,
          password: device.password,
        })
        .on("ready", onReady)
        .on("error", onError);
    } catch (error) {
      rejectPromise(error);
      return;
    }

    timer = setTimeout(() => {
      try {
        xapi?.close();
      } catch {
        // Closing is best-effort after a timeout.
      }

      settle(
        rejectPromise,
        new Error(
          `Timed out after ${timeoutMs}ms connecting to ${sanitizeConnectionUrl(
            connectionUrl,
          )}`,
        ),
      );
    }, timeoutMs);
  });
}

async function connectDevice(device, timeoutMs) {
  const errors = [];

  for (const connectionUrl of getConnectionUrls(device)) {
    try {
      return {
        url: connectionUrl,
        xapi: await connectDeviceUrl(device, connectionUrl, timeoutMs),
      };
    } catch (error) {
      errors.push({ connectionUrl, error });
    }
  }

  const attempted = errors
    .map(({ connectionUrl, error }) => {
      const code = error?.code ? `${error.code} ` : "";
      const message = error?.message ?? String(error);
      return `${sanitizeConnectionUrl(connectionUrl)} (${code}${message})`;
    })
    .join("; ");

  throw new Error(
    `Unable to connect to ${getDeviceAddressLabel(device)}. Tried ${attempted}.`,
  );
}

function closeDevice(xapi) {
  if (!xapi || typeof xapi.close !== "function") {
    return;
  }

  try {
    xapi.close();
  } catch (error) {
    console.warn(`Failed to close xapi connection: ${error.message}`);
  }
}

function getResultValue(report, name) {
  return report.results.find((result) => result.name === name && result.ok)?.value;
}

function getLiveProductPlatform(liveReport) {
  const productFromLowercase = getResultValue(
    liveReport,
    "xapi.status.get(SystemUnit/ProductPlatform)",
  );

  if (typeof productFromLowercase === "string") {
    return productFromLowercase;
  }

  const productFromProxy = getResultValue(
    liveReport,
    "xapi.Status.SystemUnit.ProductPlatform.get",
  );

  return typeof productFromProxy === "string" ? productFromProxy : undefined;
}

async function readLiveStatusString(xapi, path) {
  try {
    const value = await xapi.status.get(path);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function getRoomOsMajorVersion(...values) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const majorMatch =
      value.match(/\bRoomOS\s+(\d+)(?:\.|\b)/i) ??
      value.match(/\bce(\d+)(?:\.|\b)/i) ??
      value.match(/\b(\d+)\.\d+/);

    if (majorMatch) {
      return `RoomOS ${majorMatch[1]}`;
    }
  }

  return "unknown";
}

async function getLiveSoftwareInfo(xapi) {
  const [displayName, version] = await Promise.all([
    readLiveStatusString(xapi, "SystemUnit/Software/DisplayName"),
    readLiveStatusString(xapi, "SystemUnit/Software/Version"),
  ]);

  return {
    displayName,
    majorVersion: getRoomOsMajorVersion(displayName, version),
    version,
  };
}

async function runDeviceComparison(device, probes, connectTimeoutMs) {
  let liveXapi;

  try {
    console.log(
      `Connecting to ${getDeviceAddressLabel(device)} (ssh, then wss if needed)`,
    );
    const connection = await connectDevice(device, connectTimeoutMs);
    liveXapi = connection.xapi;
    const liveReport = await collectReport(liveXapi, probes);
    const software = await getLiveSoftwareInfo(liveXapi);
    const mockXapi = createXapi();
    const productPlatform = getLiveProductPlatform(liveReport);

    if (productPlatform) {
      mockXapi.setStatus("SystemUnit/ProductPlatform", productPlatform);
    }

    const mockReport = await collectReport(mockXapi, probes);
    const comparisons = compareReports(liveReport, mockReport, probes);

    return {
      comparisons,
      connectionUrl: connection.url,
      device,
      liveReport,
      mockReport,
      productPlatform,
      software,
    };
  } catch (error) {
    return {
      device,
      error: serializeError(error),
    };
  } finally {
    closeDevice(liveXapi);
  }
}

function getReportLabel(report) {
  return report.productPlatform ?? getDeviceAddressLabel(report.device);
}

function formatDeviceSummary(report) {
  if (report.error) {
    return [
      "",
      getReportLabel(report),
      `  Connection/probe error: ${report.error.message}`,
    ].join("\n");
  }

  const passed = report.comparisons.filter((comparison) => comparison.pass).length;
  const failed = report.comparisons.length - passed;
  const rows = [
    "",
    getReportLabel(report),
    `  Connected via ${sanitizeConnectionUrl(report.connectionUrl)}`,
    `  Passed ${passed}/${report.comparisons.length} probes`,
  ];

  for (const comparison of report.comparisons) {
    const marker = comparison.pass ? "PASS" : "FAIL";
    rows.push(`  ${marker} ${comparison.name}: ${comparison.details}`);
  }

  if (failed === 0) {
    rows.push("  All compared xAPIs matched the mock response format.");
  }

  return rows.join("\n");
}

function printFinalSummary(reports) {
  const deviceErrors = reports.filter((report) => report.error).length;
  const comparisons = reports.flatMap((report) => report.comparisons ?? []);
  const failed = comparisons.filter((comparison) => !comparison.pass).length;
  const passed = comparisons.length - failed;

  console.log("\nRoomOS xAPI parity results");
  console.log(`Devices checked: ${reports.length}`);
  console.log(`Device errors: ${deviceErrors}`);
  console.log(`Compared xAPIs: ${comparisons.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  for (const report of reports) {
    console.log(formatDeviceSummary(report));
  }

  return {
    deviceErrors,
    failed,
    passed,
    total: comparisons.length,
  };
}

function escapeMarkdownCell(value) {
  return String(value ?? "unknown")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function getValidationRows(reports) {
  const rows = [];
  const seen = new Set();

  for (const report of reports) {
    if (report.error) {
      continue;
    }

    const passed = report.comparisons.filter((comparison) => comparison.pass).length;
    const total = report.comparisons.length;
    const row = {
      hardware: getReportLabel(report),
      result: `${passed}/${total} passed`,
      roomOsMajor: report.software?.majorVersion ?? "unknown",
      software:
        report.software?.displayName ??
        report.software?.version ??
        "unknown",
    };
    const rowKey = [
      row.hardware,
      row.roomOsMajor,
      row.software,
      row.result,
    ].join("\u0000");

    if (!seen.has(rowKey)) {
      seen.add(rowKey);
      rows.push(row);
    }
  }

  return rows.sort((left, right) =>
    left.hardware.localeCompare(right.hardware) ||
    left.roomOsMajor.localeCompare(right.roomOsMajor) ||
    left.software.localeCompare(right.software),
  );
}

function createReadmeValidationBlock(reports, generatedAt = new Date()) {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const rows = getValidationRows(reports);
  const lines = [
    readmeResultsStartMarker,
    "| Hardware | RoomOS major | Software | Result | Last validated |",
    "| --- | --- | --- | --- | --- |",
  ];

  if (rows.length === 0) {
    lines.push(`| unknown | unknown | unknown | 0/0 passed | ${generatedDate} |`);
  } else {
    for (const row of rows) {
      lines.push(
        `| ${escapeMarkdownCell(row.hardware)} | ${escapeMarkdownCell(row.roomOsMajor)} | ${escapeMarkdownCell(row.software)} | ${escapeMarkdownCell(row.result)} | ${generatedDate} |`,
      );
    }
  }

  lines.push(readmeResultsEndMarker);
  return lines.join("\n");
}

function updateReadmeValidationResults(reports) {
  const readme = readFileSync(readmePath, "utf8");
  const startIndex = readme.indexOf(readmeResultsStartMarker);
  const endIndex = readme.indexOf(readmeResultsEndMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `README validation markers not found. Expected ${readmeResultsStartMarker} and ${readmeResultsEndMarker}.`,
    );
  }

  const endMarkerIndex = endIndex + readmeResultsEndMarker.length;
  const nextReadme = [
    readme.slice(0, startIndex),
    createReadmeValidationBlock(reports),
    readme.slice(endMarkerIndex),
  ].join("");

  if (nextReadme !== readme) {
    writeFileSync(readmePath, nextReadme);
  }
}

const { env, envPath } = loadEnv();
jest.setTimeout(parsePositiveInteger(env.ROOMOS_PARITY_TEST_TIMEOUT_MS, defaultTestTimeoutMs));

test("compares jest-mock-xapi with live RoomOS devices", async () => {
  const devices = parseDevices(env, envPath);
  const includeCommand = parseBoolean(env.ROOMOS_PARITY_INCLUDE_COMMAND, true);
  const includeConfigSet = parseBoolean(env.ROOMOS_PARITY_INCLUDE_CONFIG_SET, false);
  const connectTimeoutMs = parsePositiveInteger(
    env.ROOMOS_PARITY_CONNECT_TIMEOUT_MS,
    defaultConnectTimeoutMs,
  );
  const probes = createProbeDefinitions({ includeCommand, includeConfigSet });

  const reports = [];

  for (const device of devices) {
    reports.push(await runDeviceComparison(device, probes, connectTimeoutMs));
  }

  const summary = printFinalSummary(reports);

  if (summary.deviceErrors > 0 || summary.failed > 0) {
    throw new Error(
      `RoomOS parity failed with ${summary.deviceErrors} device error(s) and ${summary.failed} xAPI mismatch(es).`,
    );
  }

  if (parseBoolean(env.ROOMOS_PARITY_UPDATE_README, true)) {
    updateReadmeValidationResults(reports);
    console.log("Updated README hardware validation results.");
  }
});
