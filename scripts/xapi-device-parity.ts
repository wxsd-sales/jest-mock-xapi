import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jest, test } from "@jest/globals";
import jsxapi from "jsxapi";
import type { MockXapi as MockXapiInstance } from "../src/xapi.ts";

type XapiLike = any;
type CompareMode =
  | "array-shape"
  | "error-format"
  | "error-message"
  | "exact"
  | "format"
  | "function"
  | "object-keys";
type ProbeConnection = "wss";
type EnvMap = Record<string, string | undefined>;

interface ProbeContext {
  connectionMonitor?: ConnectionMonitor;
  probeTimeoutMs?: number;
  xapi: XapiLike;
}

interface ProbeDefinition {
  compare: CompareMode;
  liveConnection?: ProbeConnection;
  name: string;
  run: (context: ProbeContext) => unknown;
}

interface SerializedValue {
  value?: unknown;
  valueKind: string;
}

interface SerializedError {
  code?: unknown;
  message: string;
  name?: string;
  valueKind?: string;
}

type ProbeResult =
  | ({
      name: string;
      ok: true;
    } & SerializedValue)
  | {
      error: SerializedError;
      name: string;
      ok: false;
    };

interface ProbeReport {
  generatedAt: string;
  results: ProbeResult[];
}

interface ComparisonResult {
  details: string;
  name: string;
  pass: boolean;
}

interface Credentials {
  password?: string;
  username?: string;
}

interface DeviceInput extends Credentials {
  address?: unknown;
  host?: unknown;
  name?: unknown;
  pass?: unknown;
  port?: unknown;
  protocol?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

interface Device {
  address: string;
  password: string;
  port?: number;
  username: string;
}

interface ConnectionResult {
  monitor: ConnectionMonitor;
  url: string;
  xapi: XapiLike;
}

interface ConnectionSession {
  monitor: ConnectionMonitor;
  xapi: XapiLike;
}

interface ConnectionMonitor {
  dispose: () => void;
  getFailure: () => unknown | undefined;
  race: <T>(promise: Promise<T>) => Promise<T>;
}

interface SoftwareInfo {
  displayName?: string;
  majorVersion: string;
  version?: string;
}

interface DeviceComparisonReport {
  comparisons?: ComparisonResult[];
  connectionUrl?: string;
  device: Device;
  error?: SerializedError;
  liveReport?: ProbeReport;
  mockReport?: ProbeReport;
  productPlatform?: string;
  software?: SoftwareInfo;
}

interface SchemaMetadata {
  schemas?: Array<{
    majorVersion?: number;
    name?: string;
  }>;
}

interface ValidationRow {
  hardware: string;
  result: string;
  roomOsMajor: string;
  schema: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvPath = resolve(repoRoot, ".env");
const readmePath = resolve(repoRoot, "README.md");
const schemaMetaPath = resolve(repoRoot, "src/schemas/schema.meta.json");
const defaultConnectTimeoutMs = 20000;
const defaultProbeTimeoutMs = 20000;
const defaultTestTimeoutMs = 120000;
const readmeResultsStartMarker = "<!-- roomos-parity-results:start -->";
const readmeResultsEndMarker = "<!-- roomos-parity-results:end -->";
const builtPackageEntryPoint = "../dist/index.js";
const messageSendMaxUtf8Bytes = 8192;
const panelSavePanelIdMaxUtf8Bytes = 255;
let schemaMetadata: SchemaMetadata | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorCode(error: unknown) {
  return isRecord(error) ? error.code : undefined;
}

function getErrorMessage(error: unknown) {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function getValueKind(value: unknown) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function serializeValue(value: unknown): SerializedValue {
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

function serializeError(error: unknown): SerializedError {
  if (typeof error !== "object" || error === null) {
    return {
      message: String(error),
      valueKind: getValueKind(error),
    };
  }

  const errorRecord = error as Record<string, unknown>;

  const serializedError: SerializedError = {
    code: errorRecord.code,
    message:
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : String(error),
  };

  if (typeof errorRecord.name === "string") {
    serializedError.name = errorRecord.name;
  }

  return serializedError;
}

async function captureProbe(
  name: string,
  invoke: ProbeDefinition["run"],
  context: ProbeContext,
): Promise<ProbeResult> {
  try {
    const value = await runProbeWithGuards(name, invoke, context);

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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
  createTimeoutError: () => Error,
) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function runProbeWithGuards(
  name: string,
  invoke: ProbeDefinition["run"],
  context: ProbeContext,
) {
  const invokePromise = Promise.resolve().then(() => invoke(context));
  const connectionGuardedPromise = context.connectionMonitor
    ? context.connectionMonitor.race(invokePromise)
    : invokePromise;

  return withTimeout(
    connectionGuardedPromise,
    context.probeTimeoutMs,
    () => closeDevice(context.xapi),
    () =>
      new Error(
        `Timed out after ${context.probeTimeoutMs}ms running parity probe ${name}.`,
      ),
  );
}

function createSubscriptionProbe(
  subscribe: (
    xapi: XapiLike,
    listener: (payload: unknown) => void,
  ) => unknown,
) {
  return (context: ProbeContext) => {
    const unsubscribe = subscribe(context.xapi, () => undefined);
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }

    return unsubscribe;
  };
}

function createAlertCommandParams(text: string) {
  return {
    Duration: 1,
    Text: text,
    Title: "xAPI parity",
  };
}

function createUtf8String(byteLength: number) {
  if (byteLength < 0) {
    throw new Error("UTF-8 parity string helper expects a non-negative byte length.");
  }

  return `${"\u00f8".repeat(Math.floor(byteLength / 2))}${
    byteLength % 2 === 1 ? "x" : ""
  }`;
}

function createHiddenPanelBody(panelId: string) {
  return [
    "<Extensions>",
    "<Version>1.11</Version>",
    "<Panel>",
    `<PanelId>${panelId}</PanelId>`,
    "<Type>Panel</Type>",
    "<Location>Hidden</Location>",
    "<Icon>Info</Icon>",
    "<Color>#1170CF</Color>",
    "<Name>jest-mock-xapi parity</Name>",
    "<ActivityType>Custom</ActivityType>",
    "</Panel>",
    "</Extensions>",
  ].join("");
}

async function removePanelIfPresent(xapi: XapiLike, panelId: string) {
  try {
    await xapi.Command.UserInterface.Extensions.Panel.Remove({ PanelId: panelId });
  } catch {
    // Best-effort cleanup only; save validation is what this probe compares.
  }
}

function createProbeDefinitions({
  includeCommand,
  includeConfigSet,
}: {
  includeCommand: boolean;
  includeConfigSet: boolean;
}) {
  const probes: ProbeDefinition[] = [
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
      name: "xapi.status.get(SystemUnit ProductPlatform)",
      run: ({ xapi }) => xapi.status.get("SystemUnit ProductPlatform"),
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
      name: "xapi.config.get(SystemUnit Name)",
      run: ({ xapi }) => xapi.config.get("SystemUnit Name"),
    },
    {
      compare: "array-shape",
      name: "xapi.Config.Video.Output.Connector.get",
      run: ({ xapi }) => xapi.Config.Video.Output.Connector.get(),
    },
    {
      compare: "array-shape",
      name: "xapi.config.get(Video Output Connector)",
      run: ({ xapi }) => xapi.config.get("Video Output Connector"),
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
      name: "xapi.doc(Command Message Send)",
      run: ({ xapi }) => xapi.doc("Command Message Send"),
    },
    {
      compare: "format",
      name: "xapi.doc(Configuration SystemUnit Name)",
      run: ({ xapi }) => xapi.doc("Configuration SystemUnit Name"),
    },
    {
      compare: "format",
      name: "xapi.doc(Command UserInterface Message Alert Display)",
      run: ({ xapi }) =>
        xapi.doc("Command UserInterface Message Alert Display"),
    },
    {
      compare: "format",
      name: "xapi.doc(Event UserInterface Extensions Widget Action)",
      run: ({ xapi }) =>
        xapi.doc("Event UserInterface Extensions Widget Action"),
    },
    {
      compare: "error-format",
      name: "xapi.Status.Not.A.Real.Status.get",
      run: ({ xapi }) => xapi.Status.Not.A.Real.Status.get(),
    },
    {
      compare: "error-format",
      name: "xapi.status.get(Not A Real Status)",
      run: ({ xapi }) => xapi.status.get("Not A Real Status"),
    },
    {
      compare: "error-format",
      name: "xapi.Config.Not.A.Real.Config.get",
      run: ({ xapi }) => xapi.Config.Not.A.Real.Config.get(),
    },
    {
      compare: "error-format",
      name: "xapi.config.get(Not A Real Config)",
      run: ({ xapi }) => xapi.config.get("Not A Real Config"),
    },
    {
      compare: "error-format",
      name: "xapi.Command.Not.A.Real.Command",
      run: ({ xapi }) => xapi.Command.Not.A.Real.Command(),
    },
    {
      compare: "error-format",
      name: "xapi.command(Not A Real Command)",
      run: ({ xapi }) => xapi.command("Not A Real Command"),
    },
    {
      compare: "error-format",
      name: "xapi.Command.Audio.Volume.Set(bad-level)",
      run: ({ xapi }) => xapi.Command.Audio.Volume.Set({ Level: 120 }),
    },
    {
      compare: "error-format",
      name: "xapi.command(Audio Volume Set,bad-level)",
      run: ({ xapi }) => xapi.command("Audio Volume Set", { Level: 120 }),
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
      name: "xapi.status.on(Audio Volume)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.status.on("Audio Volume", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Status.Audio.Volume.once",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Status.Audio.Volume.once(listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.status.once(Audio Volume)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.status.once("Audio Volume", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Config.Audio.DefaultVolume.on",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Config.Audio.DefaultVolume.on(listener),
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
      name: "xapi.config.on(Audio DefaultVolume)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.config.on("Audio DefaultVolume", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.config.once(Audio DefaultVolume)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.config.once("Audio DefaultVolume", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Event.UserInterface.Extensions.Widget.Action.on",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Event.UserInterface.Extensions.Widget.Action.on(listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.Event.UserInterface.Extensions.Widget.Action.once",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.Event.UserInterface.Extensions.Widget.Action.once(listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.event.on(UserInterface Extensions Widget Action)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.event.on("UserInterface Extensions Widget Action", listener),
      ),
    },
    {
      compare: "function",
      name: "xapi.event.once(UserInterface Extensions Widget Action)",
      run: createSubscriptionProbe((xapi, listener) =>
        xapi.event.once("UserInterface Extensions Widget Action", listener),
      ),
    },
  ];

  if (includeConfigSet) {
    probes.push({
      compare: "format",
      name: "xapi.Config.SystemUnit.Name.set(current)",
      run: async ({ xapi }) => {
        const currentName = await xapi.Config.SystemUnit.Name.get();
        return xapi.Config.SystemUnit.Name.set(currentName);
      },
    });
    probes.push({
      compare: "format",
      name: "xapi.config.set(SystemUnit Name,current)",
      run: async ({ xapi }) => {
        const currentName = await xapi.config.get("SystemUnit Name");
        return xapi.config.set("SystemUnit Name", currentName);
      },
    });
  }

  if (includeCommand) {
    const validMessageSendText = createUtf8String(messageSendMaxUtf8Bytes);
    const invalidMessageSendText = `${validMessageSendText}\u00f8`;
    const validPanelId = createUtf8String(panelSavePanelIdMaxUtf8Bytes);
    const invalidPanelId = createUtf8String(panelSavePanelIdMaxUtf8Bytes + 1);

    probes.push({
      compare: "exact",
      liveConnection: "wss",
      name: "xapi.Command.Message.Send(Text=utf8-8192)",
      run: ({ xapi }) => xapi.Command.Message.Send({ Text: validMessageSendText }),
    });
    probes.push({
      compare: "error-message",
      liveConnection: "wss",
      name: "xapi.command(Message Send,Text=utf8-over-8192)",
      run: ({ xapi }) =>
        xapi.command("Message Send", { Text: invalidMessageSendText }),
    });
    probes.push({
      compare: "exact",
      liveConnection: "wss",
      name: "xapi.Command.UserInterface.Extensions.Panel.Save(PanelId=utf8-255)",
      run: async ({ xapi }) => {
        const result = await xapi.Command.UserInterface.Extensions.Panel.Save(
          { PanelId: validPanelId },
          createHiddenPanelBody(validPanelId),
        );
        await removePanelIfPresent(xapi, validPanelId);
        return result;
      },
    });
    probes.push({
      compare: "error-message",
      liveConnection: "wss",
      name: "xapi.command(UserInterface Extensions Panel Save,PanelId=utf8-over-255)",
      run: async ({ xapi }) => {
        try {
          return await xapi.command(
            "UserInterface Extensions Panel Save",
            { PanelId: invalidPanelId },
            createHiddenPanelBody(invalidPanelId),
          );
        } finally {
          await removePanelIfPresent(xapi, invalidPanelId);
        }
      },
    });
    probes.push({
      compare: "exact",
      name: "xapi.Command.UserInterface.Message.Alert.Display",
      run: ({ xapi }) =>
        xapi.Command.UserInterface.Message.Alert.Display(
          createAlertCommandParams("jest-mock-xapi parity probe"),
        ),
    });
    probes.push({
      compare: "exact",
      name: "xapi.command(UserInterface Message Alert Display)",
      run: ({ xapi }) =>
        xapi.command(
          "UserInterface Message Alert Display",
          createAlertCommandParams("jest-mock-xapi parity probe"),
        ),
    });
    probes.push({
      compare: "exact",
      name: "xapi.Command.UserInterface.Message.Alert.Clear",
      run: ({ xapi }) => xapi.Command.UserInterface.Message.Alert.Clear(),
    });
    probes.push({
      compare: "exact",
      name: "xapi.command(UserInterface Message Alert Clear)",
      run: ({ xapi }) => xapi.command("UserInterface Message Alert Clear"),
    });
  }

  return probes;
}

async function collectReport(
  xapi: XapiLike,
  probes: ProbeDefinition[],
  options: {
    connectionMonitor?: ConnectionMonitor;
    contexts?: Partial<Record<ProbeConnection, ProbeContext>>;
    probeTimeoutMs?: number;
  } = {},
): Promise<ProbeReport> {
  const context: ProbeContext = { xapi };
  const results: ProbeResult[] = [];

  if (options.connectionMonitor) {
    context.connectionMonitor = options.connectionMonitor;
  }

  if (typeof options.probeTimeoutMs !== "undefined") {
    context.probeTimeoutMs = options.probeTimeoutMs;
  }

  for (const probe of probes) {
    const probeContext = probe.liveConnection
      ? options.contexts?.[probe.liveConnection] ?? context
      : context;

    results.push(await captureProbe(probe.name, probe.run, probeContext));
  }

  return {
    generatedAt: new Date().toISOString(),
    results,
  };
}

function byName(report: ProbeReport) {
  return new Map(report.results.map((result) => [result.name, result]));
}

function getObjectKeys(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function getArrayItemShape(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => getObjectKeys(item).join(","));
}

function describeArrayShape(value: unknown) {
  if (!Array.isArray(value)) {
    return "not array";
  }

  return getArrayItemShape(value)
    .map((shape, index) => `${index + 1}{${shape}}`)
    .join(" ");
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isScalarValueKind(valueKind: string) {
  return ["boolean", "null", "number", "string", "undefined"].includes(valueKind);
}

function summarizeValue(result: ProbeResult) {
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
    return `array(${Array.isArray(result.value) ? result.value.length : 0})`;
  }

  if (result.valueKind === "object") {
    return `object{${getObjectKeys(result.value).join(",")}}`;
  }

  return `${result.valueKind}:${String(result.value)}`;
}

function compareProbe(
  probe: ProbeDefinition,
  liveResult: ProbeResult | undefined,
  mockResult: ProbeResult | undefined,
): ComparisonResult {
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

  if (probe.compare === "error-message") {
    if (liveResult.ok || mockResult.ok) {
      return {
        details: `expected errors: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
        name: probe.name,
        pass: false,
      };
    }

    const pass = liveResult.error?.message === mockResult.error?.message;

    return {
      details: pass
        ? "matching error message"
        : `error message mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
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
    const pass = liveMessageKind === mockMessageKind;

    return {
      details: pass
        ? "matching error message format"
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
    if (liveResult.ok || mockResult.ok) {
      return {
        details: `ok mismatch: live ${liveResult.ok}, mock ${mockResult.ok}`,
        name: probe.name,
        pass: false,
      };
    }

    const liveMessageKind = typeof liveResult.error?.message;
    const mockMessageKind = typeof mockResult.error?.message;
    const pass = liveMessageKind === mockMessageKind;

    return {
      details: pass
        ? "matching error format"
        : `error mismatch: live ${summarizeValue(liveResult)}, mock ${summarizeValue(mockResult)}`,
      name: probe.name,
      pass,
    };
  }

  if (liveResult.valueKind !== mockResult.valueKind) {
    if (
      probe.compare === "format" &&
      isScalarValueKind(liveResult.valueKind) &&
      isScalarValueKind(mockResult.valueKind)
    ) {
      return {
        details: "matching scalar format",
        name: probe.name,
        pass: true,
      };
    }

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
      Array.isArray(liveResult.value) &&
      Array.isArray(mockResult.value) &&
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

function compareReports(
  liveReport: ProbeReport,
  mockReport: ProbeReport,
  probes: ProbeDefinition[],
) {
  const liveResults = byName(liveReport);
  const mockResults = byName(mockReport);

  return probes.map((probe) =>
    compareProbe(probe, liveResults.get(probe.name), mockResults.get(probe.name)),
  );
}

function stripInlineComment(value: string) {
  let quote = "";
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";

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

function unquoteEnvValue(value: string) {
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

function parseDotEnv(contents: string): EnvMap {
  const env: EnvMap = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/.exec(
      line,
    );

    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? "";

    if (!key) {
      continue;
    }

    const value = stripInlineComment(rawValue);
    env[key] = unquoteEnvValue(value);
  }

  return env;
}

function loadEnv(): { env: EnvMap; envPath: string } {
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

function parseBoolean(value: unknown, defaultValue: boolean) {
  if (typeof value === "undefined" || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parsePositiveInteger(value: unknown, defaultValue: number) {
  if (typeof value === "undefined" || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function getCommonCredentials(env: EnvMap): Credentials {
  const credentials: Credentials = {};
  const password = env.ROOMOS_PARITY_PASSWORD ?? env.ROOMOS_PARITY_PASS;
  const username = env.ROOMOS_PARITY_USERNAME ?? env.ROOMOS_PARITY_USER;

  if (typeof password !== "undefined") {
    credentials.password = password;
  }

  if (typeof username !== "undefined") {
    credentials.username = username;
  }

  return credentials;
}

function normalizeDevice(
  device: unknown,
  label: string,
  defaults: Credentials = {},
): Device {
  const normalizedDevice =
    typeof device === "string" ? { address: device } : device;

  if (!isRecord(normalizedDevice)) {
    throw new Error(`${label} must be an object or address string.`);
  }

  const deviceRecord = normalizedDevice as DeviceInput;
  const address = deviceRecord.address ?? deviceRecord.host;
  const username =
    deviceRecord.username ?? deviceRecord.user ?? defaults.username;
  const password =
    deviceRecord.password ?? deviceRecord.pass ?? defaults.password;

  if (!address || !username || typeof password === "undefined") {
    throw new Error(
      `${label} must include an address and shared ROOMOS_PARITY_USERNAME/ROOMOS_PARITY_PASSWORD credentials.`,
    );
  }

  const normalized: Device = {
    address: String(address),
    password: String(password),
    username: String(username),
  };

  if (typeof deviceRecord.port !== "undefined" && deviceRecord.port !== "") {
    normalized.port = Number.parseInt(String(deviceRecord.port), 10);
  }

  return normalized;
}

function parseAddressDevices(env: EnvMap) {
  if (!env.ROOMOS_PARITY_ADDRESSES) {
    return [];
  }

  let addresses: unknown;

  try {
    addresses = JSON.parse(env.ROOMOS_PARITY_ADDRESSES);
  } catch (error) {
    throw new Error(
      `ROOMOS_PARITY_ADDRESSES must be a JSON string array: ${getErrorMessage(error)}`,
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

function parseJsonDevices(env: EnvMap) {
  if (!env.ROOMOS_PARITY_DEVICES) {
    return [];
  }

  let devices: unknown;

  try {
    devices = JSON.parse(env.ROOMOS_PARITY_DEVICES);
  } catch (error) {
    throw new Error(
      `ROOMOS_PARITY_DEVICES must be a JSON array: ${getErrorMessage(error)}`,
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

function parseNumberedDevices(env: EnvMap) {
  const deviceGroups = new Map<number, DeviceInput>();
  const defaults = getCommonCredentials(env);

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "undefined") {
      continue;
    }

    const match = /^ROOMOS_PARITY_DEVICE_(\d+)_(ADDRESS|HOST|NAME|PASS|PASSWORD|PORT|PROTOCOL|USER|USERNAME)$/i.exec(
      key,
    );

    if (!match) {
      continue;
    }

    const rawIndex = match[1];
    const rawField = match[2];

    if (!rawIndex || !rawField) {
      continue;
    }

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

function parseDevices(env: EnvMap, envPath: string) {
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

function hasConnectionProtocol(address: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(address);
}

function appendPort(address: string, port?: number) {
  if (!port || hasConnectionProtocol(address) || /:\d+$/.test(address)) {
    return address;
  }

  return `${address}:${port}`;
}

function getConnectionUrls(device: Device) {
  if (hasConnectionProtocol(device.address)) {
    return [device.address];
  }

  const address = appendPort(device.address, device.port);

  return [`wss://${address}`, `ssh://${address}`];
}

function getProtocolConnectionUrl(device: Device, protocol: ProbeConnection) {
  const address = appendPort(device.address, device.port);

  if (!hasConnectionProtocol(address)) {
    return `${protocol}://${address}`;
  }

  const url = new URL(address);
  url.protocol = `${protocol}:`;
  return url.toString();
}

function sanitizeConnectionUrl(connectionUrl: string) {
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

function getDeviceAddressLabel(device: Device) {
  return sanitizeConnectionUrl(device.address);
}

function createConnectionFailure(error: unknown) {
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}

function createConnectionMonitor(xapi: XapiLike): ConnectionMonitor {
  let failure: unknown;
  const waiters = new Set<(error: unknown) => void>();
  const markFailure = (error: unknown) => {
    if (typeof failure !== "undefined") {
      return;
    }

    failure = createConnectionFailure(error);

    for (const reject of waiters) {
      reject(failure);
    }

    waiters.clear();
  };
  const onError = (error: unknown) => markFailure(error);
  const onClose = () => markFailure(new Error("Connection closed."));

  xapi.on("error", onError);
  xapi.on("close", onClose);

  return {
    dispose: () => {
      xapi.removeListener("error", onError);
      xapi.removeListener("close", onClose);
      waiters.clear();
    },
    getFailure: () => failure,
    race: async <T>(promise: Promise<T>) => {
      if (typeof failure !== "undefined") {
        throw failure;
      }

      let rejectConnectionFailure:
        | ((error: unknown) => void)
        | undefined;
      const failurePromise = new Promise<never>((_, reject) => {
        rejectConnectionFailure = reject;
        waiters.add(reject);
      });

      try {
        return await Promise.race([promise, failurePromise]);
      } finally {
        if (rejectConnectionFailure) {
          waiters.delete(rejectConnectionFailure);
        }
      }
    },
  };
}

function connectDeviceUrl(
  device: Device,
  connectionUrl: string,
  timeoutMs: number,
): Promise<ConnectionSession> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let monitor: ConnectionMonitor | undefined;
    let xapi: XapiLike | undefined;

    const settle = (
      callback: (value: any) => void,
      value: any,
      options: { disposeMonitor?: boolean } = {},
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }

      if (xapi) {
        xapi.removeListener("ready", onReady);
        xapi.removeListener("error", onError);
        xapi.removeListener("close", onClose);
      }

      if (options.disposeMonitor) {
        monitor?.dispose();
      }

      callback(value);
    };

    const onReady = (readyXapi?: XapiLike) => {
      void verifyReadyConnection(readyXapi);
    };

    const verifyReadyConnection = async (readyXapi?: XapiLike) => {
      const connectedXapi = readyXapi ?? xapi;

      if (!connectedXapi || !monitor) {
        settle(
          rejectPromise,
          new Error(
            `Connection reached ready without an xapi instance for ${sanitizeConnectionUrl(
              connectionUrl,
            )}.`,
          ),
          { disposeMonitor: true },
        );
        return;
      }

      try {
        await monitor.race(
          Promise.resolve(
            connectedXapi.status.get("SystemUnit ProductPlatform"),
          ),
        );
      } catch (error) {
        try {
          connectedXapi.close();
        } catch {
          // Closing is best-effort after a readiness check failure.
        }

        settle(rejectPromise, error, { disposeMonitor: true });
        return;
      }

      settle(resolvePromise, {
        monitor,
        xapi: connectedXapi,
      });
    };

    const onError = (error: unknown) => {
      try {
        xapi?.close();
      } catch {
        // Closing is best-effort after a connection error.
      }

      settle(rejectPromise, error, { disposeMonitor: true });
    };

    const onClose = () => {
      settle(
        rejectPromise,
        new Error(
          `Connection closed before ready for ${sanitizeConnectionUrl(connectionUrl)}.`,
        ),
        { disposeMonitor: true },
      );
    };

    try {
      xapi = jsxapi.connect(connectionUrl, {
        username: device.username,
        password: device.password,
      });
      monitor = createConnectionMonitor(xapi);
      xapi
        .on("ready", onReady)
        .on("error", onError)
        .on("close", onClose);
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
        { disposeMonitor: true },
      );
    }, timeoutMs);
  });
}

async function connectDevice(
  device: Device,
  timeoutMs: number,
): Promise<ConnectionResult> {
  const errors: Array<{ connectionUrl: string; error: unknown }> = [];

  for (const connectionUrl of getConnectionUrls(device)) {
    try {
      const session = await connectDeviceUrl(device, connectionUrl, timeoutMs);

      return {
        ...session,
        url: connectionUrl,
      };
    } catch (error) {
      errors.push({ connectionUrl, error });
    }
  }

  const attempted = errors
    .map(({ connectionUrl, error }) => {
      const errorCode = getErrorCode(error);
      const code = errorCode ? `${errorCode} ` : "";
      const message = getErrorMessage(error);
      return `${sanitizeConnectionUrl(connectionUrl)} (${code}${message})`;
    })
    .join("; ");

  throw new Error(
    `Unable to connect to ${getDeviceAddressLabel(device)}. Tried ${attempted}.`,
  );
}

async function connectDeviceProtocol(
  device: Device,
  protocol: ProbeConnection,
  timeoutMs: number,
): Promise<ConnectionResult> {
  const connectionUrl = getProtocolConnectionUrl(device, protocol);
  const session = await connectDeviceUrl(device, connectionUrl, timeoutMs);

  return {
    ...session,
    url: connectionUrl,
  };
}

function closeDevice(xapi: XapiLike | undefined) {
  if (!xapi || typeof xapi.close !== "function") {
    return;
  }

  try {
    xapi.close();
  } catch (error) {
    console.warn(`Failed to close xapi connection: ${getErrorMessage(error)}`);
  }
}

function getResultValue(report: ProbeReport, name: string) {
  const result = report.results.find((candidate) => candidate.name === name);
  return result?.ok ? result.value : undefined;
}

function getLiveProductPlatform(liveReport: ProbeReport) {
  const productFromLowercase = getResultValue(
    liveReport,
    "xapi.status.get(SystemUnit ProductPlatform)",
  );

  if (typeof productFromLowercase === "string") {
    return productFromLowercase;
  }

  const productFromNewStyle = getResultValue(
    liveReport,
    "xapi.Status.SystemUnit.ProductPlatform.get",
  );

  return typeof productFromNewStyle === "string" ? productFromNewStyle : undefined;
}

async function readLiveStatusString(xapi: XapiLike, path: string) {
  try {
    const value = await xapi.status.get(path);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function getRoomOsMajorVersion(...values: unknown[]) {
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

async function getLiveSoftwareInfo(xapi: XapiLike): Promise<SoftwareInfo> {
  const [displayName, version] = await Promise.all([
    readLiveStatusString(xapi, "SystemUnit Software DisplayName"),
    readLiveStatusString(xapi, "SystemUnit Software Version"),
  ]);

  const softwareInfo: SoftwareInfo = {
    majorVersion: getRoomOsMajorVersion(displayName, version),
  };

  if (typeof displayName !== "undefined") {
    softwareInfo.displayName = displayName;
  }

  if (typeof version !== "undefined") {
    softwareInfo.version = version;
  }

  return softwareInfo;
}

function getSchemaMetadata(): SchemaMetadata {
  if (!schemaMetadata) {
    schemaMetadata = JSON.parse(readFileSync(schemaMetaPath, "utf8"));
  }

  return schemaMetadata as SchemaMetadata;
}

function getRoomOsMajorNumber(roomOsMajor: unknown) {
  const majorMatch = typeof roomOsMajor === "string"
    ? roomOsMajor.match(/\bRoomOS\s+(\d+)\b/i)
    : undefined;

  return majorMatch ? Number(majorMatch[1]) : undefined;
}

function getSchemaVersion(schemaName: unknown) {
  return typeof schemaName === "string"
    ? schemaName.match(/^(\d+(?:\.\d+)*)/)?.[1]
    : undefined;
}

function getTestedSchemaLabel(roomOsMajor: unknown) {
  const majorVersion = getRoomOsMajorNumber(roomOsMajor);

  if (typeof majorVersion !== "number") {
    return "unknown";
  }

  const schema = getSchemaMetadata().schemas?.find(
    (schemaEntry) => schemaEntry.majorVersion === majorVersion,
  );
  const schemaVersion = getSchemaVersion(schema?.name);

  return schemaVersion ? `RoomOS ${schemaVersion}` : "unknown";
}

async function createBuiltMockXapi(): Promise<MockXapiInstance> {
  const builtPackage = await import(builtPackageEntryPoint) as {
    MockXapi: new () => MockXapiInstance;
  };

  return new builtPackage.MockXapi();
}

async function runDeviceComparison(
  device: Device,
  probes: ProbeDefinition[],
  connectTimeoutMs: number,
  probeTimeoutMs: number,
): Promise<DeviceComparisonReport> {
  let connectionMonitor: ConnectionMonitor | undefined;
  let liveXapi: XapiLike | undefined;
  let wssConnectionMonitor: ConnectionMonitor | undefined;
  let wssXapi: XapiLike | undefined;

  try {
    console.log(
      `Connecting to ${getDeviceAddressLabel(device)} (wss, then ssh if needed)`,
    );
    const connection = await connectDevice(device, connectTimeoutMs);
    connectionMonitor = connection.monitor;
    liveXapi = connection.xapi;
    const alternateContexts: Partial<Record<ProbeConnection, ProbeContext>> = {};
    const needsWssConnection = probes.some((probe) => probe.liveConnection === "wss");

    if (needsWssConnection) {
      const currentProtocol = new URL(connection.url).protocol;
      const wssConnection = currentProtocol === "wss:"
        ? connection
        : await connectDeviceProtocol(device, "wss", connectTimeoutMs);

      wssConnectionMonitor = wssConnection.monitor;
      wssXapi = wssConnection.xapi;
      alternateContexts.wss = {
        connectionMonitor: wssConnection.monitor,
        probeTimeoutMs,
        xapi: wssConnection.xapi,
      };
    }

    const liveReport = await collectReport(liveXapi, probes, {
      connectionMonitor,
      contexts: alternateContexts,
      probeTimeoutMs,
    });
    let software: SoftwareInfo = { majorVersion: "unknown" };

    if (typeof connectionMonitor.getFailure() === "undefined") {
      try {
        software = await withTimeout(
          connectionMonitor.race(getLiveSoftwareInfo(liveXapi)),
          probeTimeoutMs,
          () => closeDevice(liveXapi),
          () =>
            new Error(
              `Timed out after ${probeTimeoutMs}ms reading RoomOS software status.`,
            ),
        );
      } catch {
        software = { majorVersion: "unknown" };
      }
    }

    const mockXapi = await createBuiltMockXapi();
    const productPlatform = getLiveProductPlatform(liveReport);

    if (productPlatform) {
      mockXapi.setStatus("SystemUnit ProductPlatform", productPlatform);
    }

    const mockReport = await collectReport(mockXapi, probes);
    const comparisons = compareReports(liveReport, mockReport, probes);

    const report: DeviceComparisonReport = {
      comparisons,
      connectionUrl: connection.url,
      device,
      liveReport,
      mockReport,
      software,
    };

    if (typeof productPlatform !== "undefined") {
      report.productPlatform = productPlatform;
    }

    return report;
  } catch (error) {
    return {
      device,
      error: serializeError(error),
    };
  } finally {
    connectionMonitor?.dispose();
    if (wssConnectionMonitor !== connectionMonitor) {
      wssConnectionMonitor?.dispose();
    }
    closeDevice(liveXapi);
    if (wssXapi !== liveXapi) {
      closeDevice(wssXapi);
    }
  }
}

function getReportLabel(report: DeviceComparisonReport) {
  return report.productPlatform ?? getDeviceAddressLabel(report.device);
}

function formatDeviceSummary(report: DeviceComparisonReport) {
  if (report.error) {
    return [
      "",
      getReportLabel(report),
      `  Connection/probe error: ${report.error.message}`,
    ].join("\n");
  }

  const comparisons = report.comparisons ?? [];
  const passed = comparisons.filter((comparison) => comparison.pass).length;
  const failed = comparisons.length - passed;
  const rows = [
    "",
    getReportLabel(report),
    `  Connected via ${sanitizeConnectionUrl(report.connectionUrl ?? "unknown")}`,
    `  Passed ${passed}/${comparisons.length} probes`,
  ];

  for (const comparison of comparisons) {
    const marker = comparison.pass ? "PASS" : "FAIL";
    rows.push(`  ${marker} ${comparison.name}: ${comparison.details}`);
  }

  if (failed === 0) {
    rows.push("  All compared xAPIs matched the mock response format.");
  }

  return rows.join("\n");
}

function printFinalSummary(reports: DeviceComparisonReport[]) {
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

function escapeMarkdownCell(value: unknown) {
  return String(value ?? "unknown")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function getValidationRows(reports: DeviceComparisonReport[]) {
  const rows: ValidationRow[] = [];
  const seen = new Set();

  for (const report of reports) {
    if (report.error) {
      continue;
    }

    const comparisons = report.comparisons ?? [];
    const passed = comparisons.filter((comparison) => comparison.pass).length;
    const total = comparisons.length;
    const row = {
      hardware: getReportLabel(report),
      result: `${passed}/${total} passed`,
      roomOsMajor: report.software?.majorVersion ?? "unknown",
      schema: getTestedSchemaLabel(report.software?.majorVersion),
    };
    const rowKey = [
      row.hardware,
      row.roomOsMajor,
      row.schema,
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
    left.schema.localeCompare(right.schema),
  );
}

function createReadmeValidationBlock(
  reports: DeviceComparisonReport[],
  generatedAt = new Date(),
) {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const rows = getValidationRows(reports);
  const lines = [
    readmeResultsStartMarker,
    "| Hardware | RoomOS major | Tested schema | Result | Last validated |",
    "| --- | --- | --- | --- | --- |",
  ];

  if (rows.length === 0) {
    lines.push(`| unknown | unknown | unknown | 0/0 passed | ${generatedDate} |`);
  } else {
    for (const row of rows) {
      lines.push(
        `| ${escapeMarkdownCell(row.hardware)} | ${escapeMarkdownCell(row.roomOsMajor)} | ${escapeMarkdownCell(row.schema)} | ${escapeMarkdownCell(row.result)} | ${generatedDate} |`,
      );
    }
  }

  lines.push(readmeResultsEndMarker);
  return lines.join("\n");
}

function updateReadmeValidationResults(reports: DeviceComparisonReport[]) {
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
  const probeTimeoutMs = parsePositiveInteger(
    env.ROOMOS_PARITY_PROBE_TIMEOUT_MS,
    defaultProbeTimeoutMs,
  );
  const probes = createProbeDefinitions({ includeCommand, includeConfigSet });

  const reports = [];

  for (const device of devices) {
    reports.push(
      await runDeviceComparison(device, probes, connectTimeoutMs, probeTimeoutMs),
    );
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
