import { EventEmitter } from "events";
import { jest } from "@jest/globals";
import "./runtime.ts";
import {
  createSchemaSoftwareStatusEntries,
  defaultProductPlatform,
  defaultStatusEntries,
} from "./defaults.ts";
import {
  commandSuccessResponse,
  invalidCommandError,
  invalidPathError,
  missingOrInvalidCommandParametersError,
} from "./responses.ts";
import {
  getProductCodes,
  loadSchemaModel,
  proxy,
  logger,
  resolveSchemaChild,
  type PathPatternSegment,
  type ProductScopedValue,
  type SchemaDomain,
  type SchemaNode,
} from "./utils/index.ts";

const schemaCatalog = loadSchemaModel();
const materializedValueSymbol = Symbol("materializedValue");

type NormalizedPathSegment = string | number;
type PathInput = string | Array<string | number>;
type StoreDomain = "Config" | "Status";
type SubscriptionDomain = StoreDomain | "Event";
type CommandHandler = (
  params?: unknown,
  body?: unknown,
  call?: XapiCallRecord,
) => unknown;

interface XapiCallRecord {
  body?: unknown;
  listener?: unknown;
  normalizedPath: NormalizedPathSegment[];
  once?: boolean;
  originalPath?: PathInput | undefined;
  params?: unknown;
  path: NormalizedPathSegment[];
  value?: unknown;
}

interface XapiCallHistory {
  command: XapiCallRecord[];
  config: {
    get: XapiCallRecord[];
    on: XapiCallRecord[];
    set: XapiCallRecord[];
  };
  doc: XapiCallRecord[];
  event: {
    on: XapiCallRecord[];
  };
  status: {
    get: XapiCallRecord[];
    on: XapiCallRecord[];
  };
}

function createConfigStore() {
  return new Map<string, unknown>(schemaCatalog.defaultModel.defaults);
}

function createStatusStore() {
  return new Map<string, unknown>(defaultStatusEntries);
}

function createEmptyCallHistory(): XapiCallHistory {
  return {
    command: [],
    config: {
      get: [],
      on: [],
      set: [],
    },
    doc: [],
    event: {
      on: [],
    },
    status: {
      get: [],
      on: [],
    },
  };
}

function createRejectedResult(error: unknown) {
  const result = Promise.reject(error);
  result.catch(() => undefined);
  return result;
}

export class MockXapi extends EventEmitter {
  #callHistory = createEmptyCallHistory();
  #commandHandlers = new Map<string, CommandHandler>();
  #commandResults = new Map<string, unknown>();
  #configStore = createConfigStore();
  #docResults = new Map<string, unknown>();
  #proxyCache = new Map<string, unknown>();
  #statusStore = createStatusStore();

  Command: any;
  Config: any;
  Event: any;
  Status: any;
  close: any;
  command: any;
  config: any;
  doc: any;
  event: any;
  status: any;
  version = "6.0.0";

  constructor() {
    super();

    this.command = jest.fn((path: PathInput, params?: unknown, body?: unknown) =>
      this.#command(path, params, body),
    );
    this.doc = jest.fn((path: PathInput) => this.#doc(path));
    this.close = jest.fn(() => undefined);
    this.status = {
      get: jest.fn((path: PathInput = []) => this.#statusGet(path)),
      on: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#statusOn(subscription.path, subscription.listener, false);
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#statusOn(subscription.path, subscription.listener, true);
        },
      ),
    };
    this.config = {
      get: jest.fn((path: PathInput = []) => this.#configGet(path)),
      set: jest.fn((path: PathInput, value: unknown) => this.#configSet(path, value)),
      on: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#configOn(subscription.path, subscription.listener, false);
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#configOn(subscription.path, subscription.listener, true);
        },
      ),
    };
    this.event = {
      on: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#eventOn(subscription.path, subscription.listener, false);
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#eventOn(subscription.path, subscription.listener, true);
        },
      ),
    };

    this.Command = proxy({
      cache: this.#proxyCache,
      callable: false,
      invoke: ({ args, path }) => {
        return this.command(this.#getApiPathFromProxyPath(path), args[0], args[1]);
      },
      node: schemaCatalog.roots.Command,
      path: ["Command"],
    });

    this.Config = proxy({
      allowedMethods: ["get", "set", "on", "once"],
      cache: this.#proxyCache,
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "get") {
          return this.config.get(apiPath);
        }

        if (operation === "set") {
          return this.config.set(apiPath, args[0]);
        }

        if (operation === "on") {
          return this.config.on(apiPath, args[0]);
        }

        if (operation === "once") {
          return this.config.once(apiPath, args[0]);
        }

        throw new Error(`Unsupported config operation: ${operation}`);
      },
      node: schemaCatalog.roots.Configuration,
      path: ["Config"],
    });

    this.Status = proxy({
      allowedMethods: ["get", "on", "once", "set"],
      cache: this.#proxyCache,
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "get") {
          return this.status.get(apiPath);
        }

        if (operation === "on") {
          return this.status.on(apiPath, args[0]);
        }

        if (operation === "once") {
          return this.status.once(apiPath, args[0]);
        }

        if (operation === "set") {
          return this.emitStatus(apiPath, args[0]);
        }

        throw new Error(`Unsupported status operation: ${operation}`);
      },
      node: schemaCatalog.roots.Status,
      path: ["Status"],
    });

    this.Event = proxy({
      allowedMethods: ["emit", "on", "once"],
      cache: this.#proxyCache,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "on") {
          return this.event.on(apiPath, args[0]);
        }

        if (operation === "once") {
          return this.event.once(apiPath, args[0]);
        }

        if (operation === "emit") {
          return this.emitEvent(apiPath, args[0]);
        }

        throw new Error(`Unsupported event operation: ${operation}`);
      },
      node: schemaCatalog.roots.Event,
      path: ["Event"],
    });
  }

  get callHistory() {
    return this.getCallHistory();
  }

  getCalls() {
    return this.getCallHistory();
  }

  getCallHistory(): XapiCallHistory {
    return {
      command: this.#copyCallRecords(this.#callHistory.command),
      config: {
        get: this.#copyCallRecords(this.#callHistory.config.get),
        on: this.#copyCallRecords(this.#callHistory.config.on),
        set: this.#copyCallRecords(this.#callHistory.config.set),
      },
      doc: this.#copyCallRecords(this.#callHistory.doc),
      event: {
        on: this.#copyCallRecords(this.#callHistory.event.on),
      },
      status: {
        get: this.#copyCallRecords(this.#callHistory.status.get),
        on: this.#copyCallRecords(this.#callHistory.status.on),
      },
    };
  }

  clearCallHistory() {
    this.#callHistory = createEmptyCallHistory();
    this.#clearMockCalls();
  }

  reset() {
    this.#callHistory = createEmptyCallHistory();
    this.#commandHandlers.clear();
    this.#commandResults.clear();
    this.#configStore = createConfigStore();
    this.#docResults.clear();
    this.#statusStore = createStatusStore();
    this.removeAllListeners();
    this.#clearMockCalls();
  }

  resetAll() {
    this.reset();
  }

  resetMock() {
    this.reset();
  }

  setStatus(path: PathInput, value: unknown) {
    this.#setStoreValue("Status", this.#statusStore, path, value, {
      emit: false,
      validate: false,
    });
    return value;
  }

  emitStatus(path: PathInput, value: unknown) {
    this.#setStoreValue("Status", this.#statusStore, path, value, {
      emit: true,
      validate: true,
    });
    return value;
  }

  setConfig(path: PathInput, value: unknown) {
    this.#setStoreValue("Config", this.#configStore, path, value, {
      emit: false,
      validate: false,
    });
    return value;
  }

  emitConfig(path: PathInput, value: unknown) {
    this.#setStoreValue("Config", this.#configStore, path, value, {
      emit: true,
      validate: true,
    });
    return value;
  }

  setDocResult(path: PathInput, result: unknown) {
    this.#docResults.set(this.#getMockPathKey(path), result);
  }

  setCommandResult(path: PathInput, result: unknown) {
    this.#commandResults.set(this.#getMockPathKey(path), result);
  }

  setCommandHandler(path: PathInput, handler: CommandHandler) {
    this.#commandHandlers.set(this.#getMockPathKey(path), handler);
  }

  #command(path: PathInput, params?: unknown, body?: unknown) {
    const normalizedPath = this.#normalizePath(path);
    const call = this.#recordCall(this.#callHistory.command, path, normalizedPath, {
      body,
      params,
    });
    const commandKey = this.#getNormalizedPathKey(normalizedPath);
    const commandHandler = this.#commandHandlers.get(commandKey);

    if (commandHandler) {
      try {
        return Promise.resolve(commandHandler(params, body, call));
      } catch (error) {
        return createRejectedResult(error);
      }
    }

    if (this.#commandResults.has(commandKey)) {
      return Promise.resolve(this.#commandResults.get(commandKey));
    }

    const commandPath = this.#getDomainPath("Command", normalizedPath);
    const commandNode = this.#resolvePathNode(commandPath);

    if (!commandNode?.terminal || !this.#pathSupportsActiveProduct(commandPath, true)) {
      return createRejectedResult({ ...invalidCommandError });
    }

    const commandValidationError = this.#validateCommandArguments(commandPath, params);

    if (commandValidationError) {
      return createRejectedResult(commandValidationError);
    }

    return Promise.resolve(commandSuccessResponse);
  }

  #doc(path: PathInput) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.doc, path, normalizedPath);
    const docKey = this.#getNormalizedPathKey(normalizedPath);

    if (this.#docResults.has(docKey)) {
      return Promise.resolve(this.#docResults.get(docKey));
    }

    return Promise.resolve(this.#getSchemaDocResult(normalizedPath));
  }

  #statusGet(path: PathInput) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.status.get, path, normalizedPath);
    return this.#getStoreValue("Status", this.#statusStore, path);
  }

  #configGet(path: PathInput) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.config.get, path, normalizedPath);
    return this.#getStoreValue("Config", this.#configStore, path);
  }

  #configSet(path: PathInput, value: unknown) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.config.set, path, normalizedPath, { value });

    try {
      const storedValue = this.#setStoreValue("Config", this.#configStore, path, value, {
        emit: true,
        validate: true,
      });
      return Promise.resolve(storedValue);
    } catch (error) {
      return createRejectedResult(error);
    }
  }

  #statusOn(path: PathInput, listener: (payload: unknown) => void, once: boolean) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.status.on, path, normalizedPath, {
      listener,
      once,
    });
    return this.#subscribe("Status", path, listener, once);
  }

  #configOn(path: PathInput, listener: (payload: unknown) => void, once: boolean) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.config.on, path, normalizedPath, {
      listener,
      once,
    });
    return this.#subscribe("Config", path, listener, once);
  }

  #eventOn(path: PathInput, listener: (payload: unknown) => void, once: boolean) {
    const normalizedPath = this.#normalizePath(path);
    this.#recordCall(this.#callHistory.event.on, path, normalizedPath, {
      listener,
      once,
    });
    return this.#subscribe("Event", path, listener, once);
  }

  #getStoreValue(domain: StoreDomain, store: Map<string, unknown>, path: PathInput) {
    const domainPath = this.#getDomainPath(domain, this.#normalizePath(path));
    const node = this.#resolvePathNode(domainPath);

    if (!node || !this.#pathSupportsActiveProduct(domainPath, false)) {
      return createRejectedResult({ ...invalidPathError });
    }

    return Promise.resolve(
      this.#getMaterializedStoreValue(store, node, [...domainPath, "get"]),
    );
  }

  #setStoreValue(
    domain: StoreDomain,
    store: Map<string, unknown>,
    path: PathInput,
    value: unknown,
    options: {
      emit: boolean;
      validate: boolean;
    },
  ) {
    const normalizedPath = this.#normalizePath(path);
    const domainPath = this.#getDomainPath(domain, normalizedPath);
    const node = this.#resolvePathNode(domainPath);

    if (options.validate) {
      if (!node?.terminal || !this.#pathSupportsActiveProduct(domainPath, true)) {
        throw { ...invalidPathError };
      }

      const validationError = this.#validatePathValue(domain, domainPath, value);

      if (validationError) {
        throw validationError;
      }
    }

    store.set(domainPath.join("."), value);

    if (options.emit) {
      this.#emitScopedChange(domain, store, domainPath, value);
    }

    return value;
  }

  #subscribe(
    domain: SubscriptionDomain,
    path: PathInput,
    listener: (payload: unknown) => void,
    once: boolean,
  ) {
    if (typeof listener !== "function") {
      throw new TypeError("xapi listener must be a function");
    }

    const domainPath = this.#getDomainPath(domain, this.#normalizePath(path));
    const node = this.#resolvePathNode(domainPath);

    if (!node || !this.#pathSupportsActiveProduct(domainPath, false)) {
      throw { ...invalidPathError };
    }

    const eventName = `${domain}:${domainPath.join(".")}`;
    let unsubscribe = () => {
      this.off(eventName, listener);
    };

    if (!once) {
      this.on(eventName, listener);
      return unsubscribe;
    }

    const wrappedListener = (payload: unknown) => {
      unsubscribe();
      listener(payload);
    };

    unsubscribe = () => {
      this.off(eventName, wrappedListener);
    };
    this.on(eventName, wrappedListener);
    return unsubscribe;
  }

  #normalizeSubscriptionArgs(
    path: PathInput | ((payload: unknown) => void),
    listener?: (payload: unknown) => void,
  ) {
    if (typeof path === "function" && typeof listener === "undefined") {
      return {
        listener: path,
        path: [] satisfies NormalizedPathSegment[],
      };
    }

    return {
      listener: listener as (payload: unknown) => void,
      path: path as PathInput,
    };
  }

  #getApiPathFromProxyPath(path: string[]) {
    const apiSegments = path.slice(1);
    const lastSegment = apiSegments.at(-1);

    if (
      lastSegment === "emit" ||
      lastSegment === "get" ||
      lastSegment === "on" ||
      lastSegment === "once" ||
      lastSegment === "set"
    ) {
      apiSegments.pop();
    }

    return apiSegments.join("/");
  }

  #normalizePath(path: PathInput = []) {
    const rawSegments = Array.isArray(path) ? path : [path];
    const normalizedSegments: NormalizedPathSegment[] = [];

    for (const rawSegment of rawSegments) {
      if (typeof rawSegment === "number") {
        normalizedSegments.push(rawSegment);
        continue;
      }

      for (const segment of rawSegment.split(/[./\s]+/)) {
        const trimmedSegment = segment.trim();

        if (!trimmedSegment) {
          continue;
        }

        normalizedSegments.push(this.#normalizePathSegment(trimmedSegment));
      }
    }

    return normalizedSegments;
  }

  #normalizePathSegment(segment: string): NormalizedPathSegment {
    if (segment === "*") {
      return segment;
    }

    if (/^-?\d+$/.test(segment)) {
      return Number(segment);
    }

    return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
  }

  #getDomainPath(domain: "Command" | SubscriptionDomain, normalizedPath: NormalizedPathSegment[]) {
    return [domain, ...normalizedPath.map(String)];
  }

  #getNormalizedPathKey(normalizedPath: NormalizedPathSegment[]) {
    return normalizedPath.map(String).join(".");
  }

  #getMockPathKey(path: PathInput) {
    return this.#getNormalizedPathKey(this.#normalizePath(path));
  }

  #getSchemaDocResult(normalizedPath: NormalizedPathSegment[]) {
    const normalizedPathStrings = normalizedPath.map(String);
    const docKeys = this.#getSchemaDocKeys(normalizedPathStrings);
    const schemaModel = this.#getActiveSchemaModel();

    for (const docKey of docKeys) {
      const docPath = docKey.split(".");
      const productPath = docPath[0] === "Configuration"
        ? ["Config", ...docPath.slice(1)]
        : docPath;

      if (
        schemaModel.docs.has(docKey) &&
        this.#pathSupportsActiveProduct(productPath, true)
      ) {
        return schemaModel.docs.get(docKey);
      }
    }

    return undefined;
  }

  #getSchemaDocKeys(pathSegments: string[]) {
    const [rootSegment, ...remainingSegments] = pathSegments;

    if (rootSegment === "Config") {
      return [
        ["Config", ...remainingSegments].join("."),
        ["Configuration", ...remainingSegments].join("."),
      ];
    }

    if (rootSegment === "Configuration") {
      return [
        ["Configuration", ...remainingSegments].join("."),
        ["Config", ...remainingSegments].join("."),
      ];
    }

    return [pathSegments.join(".")];
  }

  #recordCall(
    records: XapiCallRecord[],
    originalPath: PathInput | undefined,
    normalizedPath: NormalizedPathSegment[],
    details: Partial<Omit<XapiCallRecord, "normalizedPath" | "originalPath" | "path">> = {},
  ) {
    const normalizedPathCopy = [...normalizedPath];
    const record: XapiCallRecord = {
      ...details,
      normalizedPath: normalizedPathCopy,
      originalPath: this.#copyPathInput(originalPath),
      path: [...normalizedPathCopy],
    };

    records.push(record);
    return record;
  }

  #copyPathInput(path: PathInput | undefined) {
    return Array.isArray(path) ? [...path] : path;
  }

  #copyCallRecords(records: XapiCallRecord[]) {
    return records.map((record) => ({
      ...record,
      normalizedPath: [...record.normalizedPath],
      originalPath: this.#copyPathInput(record.originalPath),
      path: [...record.path],
    }));
  }

  #clearMockCalls() {
    const mocks = [
      this.close,
      this.command,
      this.config.get,
      this.config.on,
      this.config.once,
      this.config.set,
      this.doc,
      this.event.on,
      this.event.once,
      this.status.get,
      this.status.on,
      this.status.once,
      ...this.#proxyCache.values(),
    ];

    for (const mock of mocks) {
      if (
        typeof mock === "function" &&
        "mockClear" in mock &&
        typeof mock.mockClear === "function"
      ) {
        mock.mockClear();
      }
    }
  }

  #getPathSegments(path: string[]) {
    return path.slice(0, -1);
  }

  #getActiveProductCodes() {
    const productPlatform =
      this.#statusStore.get("Status.SystemUnit.ProductPlatform") ??
      defaultProductPlatform;

    if (typeof productPlatform !== "string") {
      return getProductCodes(defaultProductPlatform);
    }

    return getProductCodes(productPlatform);
  }

  #getActiveSchemaModel() {
    return schemaCatalog.getModelForProductCodes(this.#getActiveProductCodes());
  }

  #getSchemaDomain(pathRoot: string): SchemaDomain {
    if (pathRoot === "Config") {
      return "Configuration";
    }

    if (pathRoot === "Status") {
      return "Status";
    }

    if (pathRoot === "Command") {
      return "Command";
    }

    return "Event";
  }

  #productsIncludeActiveProduct(products: Set<string>, activeProductCodes: string[]) {
    if (activeProductCodes.length === 0 || products.size === 0) {
      return true;
    }

    return activeProductCodes.some((productCode) => products.has(productCode));
  }

  #patternSegmentMatches(
    patternSegment: PathPatternSegment,
    querySegment: string,
  ) {
    if (patternSegment.type === "literal") {
      return patternSegment.value === querySegment;
    }

    if (querySegment === "*") {
      return true;
    }

    if (patternSegment.wildcard || patternSegment.allowedValues.has(querySegment)) {
      return true;
    }

    const numericValue = Number(querySegment);
    if (Number.isNaN(numericValue)) {
      return false;
    }

    return patternSegment.ranges.some(
      (range) => numericValue >= range.min && numericValue <= range.max,
    );
  }

  #pathPatternMatches(
    patternPath: PathPatternSegment[],
    querySegments: string[],
    requiresExactPath: boolean,
  ) {
    if (requiresExactPath && querySegments.length !== patternPath.length) {
      return false;
    }

    if (querySegments.length > patternPath.length) {
      return false;
    }

    return querySegments.every((querySegment, index) => {
      const patternSegment = patternPath[index];
      if (!patternSegment) {
        return false;
      }

      return this.#patternSegmentMatches(patternSegment, querySegment);
    });
  }

  #pathSupportsActiveProduct(pathSegments: string[], requiresExactPath: boolean) {
    const activeProductCodes = this.#getActiveProductCodes();

    if (activeProductCodes.length === 0) {
      return true;
    }

    const [rootSegment, ...querySegments] = pathSegments;

    if (typeof rootSegment !== "string") {
      return false;
    }

    const schemaDomain = this.#getSchemaDomain(rootSegment);
    const schemaModel = this.#getActiveSchemaModel();
    const productPathPatterns = schemaModel.productPaths.get(schemaDomain) ?? [];

    return productPathPatterns.some((productPathPattern) =>
      this.#productsIncludeActiveProduct(
        productPathPattern.products,
        activeProductCodes,
      ) &&
      this.#pathPatternMatches(
        productPathPattern.path,
        querySegments,
        requiresExactPath,
      ),
    );
  }

  #storeKeySupportsActiveProduct(storeKey: string) {
    return this.#pathSupportsActiveProduct(storeKey.split("."), true);
  }

  #getProductDefaultStoreEntries(activeProductCodes: string[]) {
    if (activeProductCodes.length === 0) {
      return [];
    }

    const schemaModel = this.#getActiveSchemaModel();

    return schemaModel.productDefaults
      .filter((productDefault) =>
        this.#productsIncludeActiveProduct(
          productDefault.products,
          activeProductCodes,
        ),
      )
      .map((productDefault) => ({
        storeKey: ["Config", ...productDefault.path].join("."),
        storeValue: productDefault.value,
        skipProductSupportCheck: true,
      }));
  }

  #getSchemaDefaultStatusEntries() {
    const schemaModel = this.#getActiveSchemaModel();

    return createSchemaSoftwareStatusEntries(schemaModel.name).map(
      ([storeKey, storeValue]) => ({
        skipProductSupportCheck: false,
        storeKey,
        storeValue,
      }),
    );
  }

  #pathValuesForActiveProduct(
    values: ProductScopedValue[],
    pathSegments: string[],
  ) {
    const activeProductCodes = this.#getActiveProductCodes();
    const querySegments = pathSegments.slice(1);

    return values.filter(
      (productScopedValue) =>
        this.#productsIncludeActiveProduct(
          productScopedValue.products,
          activeProductCodes,
        ) &&
        this.#pathPatternMatches(productScopedValue.path, querySegments, true),
    );
  }

  #validatePathValue(
    pathRoot: "Config" | "Status",
    pathSegments: string[],
    value: unknown,
  ) {
    if (this.#getActiveProductCodes().length === 0) {
      return null;
    }

    const productScopedValues = this.#pathValuesForActiveProduct(
      pathRoot === "Config"
        ? this.#getActiveSchemaModel().configValues
        : this.#getActiveSchemaModel().statusValues,
      pathSegments,
    );

    if (productScopedValues.length === 0) {
      return invalidPathError;
    }

    const valueMatches = productScopedValues.some((productScopedValue) =>
      this.#matchesParameterValue(productScopedValue.valuespace, value),
    );

    return valueMatches ? null : missingOrInvalidCommandParametersError;
  }

  #getSchemaRoot(pathRoot: string) {
    const schemaModel = this.#getActiveSchemaModel();

    if (pathRoot === "Config") {
      return schemaModel.roots.Configuration;
    }

    if (pathRoot === "Status") {
      return schemaModel.roots.Status;
    }

    if (pathRoot === "Command") {
      return schemaModel.roots.Command;
    }

    return schemaModel.roots.Event;
  }

  #resolvePathNode(pathSegments: string[]) {
    const [rootSegment, ...remainingSegments] = pathSegments;
    if (typeof rootSegment !== "string") {
      return null;
    }

    let currentNode = this.#getSchemaRoot(rootSegment);

    for (const segment of remainingSegments) {
      const nextNode = resolveSchemaChild(currentNode, segment);
      if (!nextNode) {
        return null;
      }

      currentNode = nextNode;
    }

    return currentNode;
  }

  #matchStoreKey(querySegments: string[], storeSegments: string[]) {
    if (storeSegments.length < querySegments.length) {
      return null;
    }

    const [rootSegment] = querySegments;
    if (typeof rootSegment !== "string") {
      return null;
    }

    const capturedWildcardSegments: string[] = [];
    let currentNode = this.#getSchemaRoot(rootSegment);

    for (const [index, querySegment] of querySegments.entries()) {
      const storeSegment = storeSegments[index];

      if (typeof storeSegment === "undefined") {
        return null;
      }

      if (index === 0) {
        if (querySegment !== storeSegment) {
          return null;
        }

        continue;
      }

      if (querySegment === "*") {
        if (!this.#matchesIndexedSegment(currentNode, storeSegment)) {
          return null;
        }

        capturedWildcardSegments.push(storeSegment);
        currentNode = currentNode.indexedChild?.node ?? currentNode;
        continue;
      }

      if (querySegment !== storeSegment) {
        return null;
      }

      if (currentNode.children.has(querySegment)) {
        currentNode = currentNode.children.get(querySegment) ?? currentNode;
        continue;
      }

      if (this.#matchesIndexedSegment(currentNode, querySegment)) {
        currentNode = currentNode.indexedChild?.node ?? currentNode;
      }
    }

    return {
      projectedSegments: [
        ...capturedWildcardSegments,
        ...storeSegments.slice(querySegments.length),
      ],
    };
  }

  #matchesIndexedSegment(node: SchemaNode, segment: string) {
    const indexedChild = node.indexedChild;

    if (!indexedChild) {
      return false;
    }

    if (indexedChild.wildcard) {
      return true;
    }

    if (indexedChild.allowedValues.has(segment)) {
      return true;
    }

    const numericValue = Number(segment);
    if (Number.isNaN(numericValue)) {
      return false;
    }

    return indexedChild.ranges.some(
      (range: { min: number; max: number }) =>
        numericValue >= range.min && numericValue <= range.max,
    );
  }

  #insertMaterializedValue(
    target: Record<string | symbol, unknown>,
    projectedSegments: string[],
    value: unknown,
  ) {
    if (projectedSegments.length === 0) {
      target[materializedValueSymbol] = value;
      return;
    }

    const [segment, ...remainingSegments] = projectedSegments;
    if (typeof segment !== "string") {
      return;
    }

    const child =
      typeof target[segment] === "object" && target[segment] !== null
        ? (target[segment] as Record<string | symbol, unknown>)
        : {};

    target[segment] = child;
    this.#insertMaterializedValue(child, remainingSegments, value);
  }

  #createRelativePayload(relativeSegments: string[], value: unknown) {
    if (relativeSegments.length === 0) {
      return value;
    }

    const payload: Record<string | symbol, unknown> = {};
    this.#insertMaterializedValue(payload, relativeSegments, value);
    return this.#finalizeMaterializedValue(payload);
  }

  #finalizeMaterializedValue(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }

    const objectValue = value as Record<string | symbol, unknown>;
    const keys = Reflect.ownKeys(objectValue).filter(
      (key) => key !== materializedValueSymbol,
    );
    const hasScalarValue = Object.getOwnPropertySymbols(objectValue).includes(
      materializedValueSymbol,
    );

    if (keys.length === 0 && hasScalarValue) {
      return objectValue[materializedValueSymbol];
    }

    const numericKeys = keys.filter(
      (key) => typeof key === "string" && /^\d+$/.test(key),
    );

    if (keys.length > 0 && numericKeys.length === keys.length) {
      return numericKeys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => {
          const finalizedValue = this.#finalizeMaterializedValue(objectValue[key]);

          if (
            typeof finalizedValue === "object" &&
            finalizedValue !== null &&
            !Array.isArray(finalizedValue) &&
            !Object.hasOwn(finalizedValue, "id")
          ) {
            return {
              ...(finalizedValue as Record<string, unknown>),
              id: key,
            };
          }

          return finalizedValue;
        });
    }

    const result: Record<string, unknown> = {};

    for (const key of keys) {
      if (typeof key !== "string") {
        continue;
      }

      result[key] = this.#finalizeMaterializedValue(
        objectValue[key],
      );
    }

    if (hasScalarValue) {
      return objectValue[materializedValueSymbol];
    }

    return result;
  }

  #getMaterializedStoreValue(
    store: Map<string, unknown>,
    node: SchemaNode,
    path: string[],
  ) {
    const querySegments = this.#getPathSegments(path);
    const exactStoreKey = querySegments.join(".");

    if (
      !querySegments.includes("*") &&
      store.has(exactStoreKey) &&
      this.#storeKeySupportsActiveProduct(exactStoreKey)
    ) {
      return store.get(exactStoreKey);
    }

    const shouldCollectIndexedChildren = Boolean(
      node.indexedChild && !querySegments.includes("*"),
    );
    const materializedResult: Record<string | symbol, unknown> = {};
    let matchCount = 0;
    const activeProductCodes = this.#getActiveProductCodes();
    const storeEntries = [...store.entries()].map(([storeKey, storeValue]) => ({
      skipProductSupportCheck: false,
      storeKey,
      storeValue,
    }));
    const materializableEntries =
      store === this.#configStore
        ? [
            ...this.#getProductDefaultStoreEntries(activeProductCodes),
            ...storeEntries,
          ]
        : [
            ...this.#getSchemaDefaultStatusEntries(),
            ...storeEntries,
          ];

    for (const { skipProductSupportCheck, storeKey, storeValue } of materializableEntries) {
      if (!skipProductSupportCheck && !this.#storeKeySupportsActiveProduct(storeKey)) {
        continue;
      }

      const storeSegments = storeKey.split(".");
      let projectedSegments: string[] | null = null;

      if (shouldCollectIndexedChildren) {
        if (storeSegments.length <= querySegments.length) {
          continue;
        }

        const prefixMatches = querySegments.every(
          (querySegment, index) => storeSegments[index] === querySegment,
        );

        if (!prefixMatches) {
          continue;
        }

        const indexedSegment = storeSegments[querySegments.length];
        if (typeof indexedSegment !== "string") {
          continue;
        }

        if (!this.#matchesIndexedSegment(node, indexedSegment)) {
          continue;
        }

        projectedSegments = [
          indexedSegment,
          ...storeSegments.slice(querySegments.length + 1),
        ];
      } else {
        const match = this.#matchStoreKey(querySegments, storeSegments);

        if (!match) {
          continue;
        }

        projectedSegments = match.projectedSegments;
      }

      if (!projectedSegments) {
        continue;
      }

      matchCount += 1;
      this.#insertMaterializedValue(materializedResult, projectedSegments, storeValue);
    }

    if (matchCount === 0) {
      return undefined;
    }

    const materializedValue = this.#finalizeMaterializedValue(materializedResult);
    const indexedBranchId = this.#getIndexedBranchId(path.slice(0, -1));

    if (
      indexedBranchId &&
      typeof materializedValue === "object" &&
      materializedValue !== null &&
      !Array.isArray(materializedValue) &&
      !Object.hasOwn(materializedValue, "id")
    ) {
      return {
        ...(materializedValue as Record<string, unknown>),
        id: indexedBranchId,
      };
    }

    return materializedValue;
  }

  #getIndexedBranchId(pathSegments: string[]) {
    const [rootSegment, ...remainingSegments] = pathSegments;
    if (typeof rootSegment !== "string") {
      return null;
    }

    let currentNode = this.#getSchemaRoot(rootSegment);

    for (const [index, segment] of remainingSegments.entries()) {
      const isLastSegment = index === remainingSegments.length - 1;

      if (this.#matchesIndexedSegment(currentNode, segment)) {
        if (isLastSegment) {
          return segment;
        }

        currentNode = currentNode.indexedChild?.node ?? currentNode;
        continue;
      }

      const childNode = currentNode.children.get(segment);
      if (!childNode) {
        return null;
      }

      currentNode = childNode;
    }

    return null;
  }

  #createIndexedBranchPayload(
    store: Map<string, unknown>,
    collectionPathSegments: string[],
    indexSegment: string,
    isGhost = false,
  ) {
    if (isGhost) {
      return {
        ghost: "true",
        id: indexSegment,
      };
    }

    const branchPath = [...collectionPathSegments, indexSegment];
    const branchNode = this.#resolvePathNode(branchPath);
    const branchValue = branchNode
      ? this.#getMaterializedStoreValue(store, branchNode, [...branchPath, "get"])
      : undefined;

    if (typeof branchValue === "object" && branchValue !== null && !Array.isArray(branchValue)) {
      return {
        id: indexSegment,
        ...(branchValue as Record<string, unknown>),
      };
    }

    if (typeof branchValue === "undefined") {
      return {
        id: indexSegment,
      };
    }

    return {
      id: indexSegment,
      value: branchValue,
    };
  }

  #emitScopedChange(
    domain: "Config" | "Status" | "Event",
    store: Map<string, unknown> | null,
    changedPathSegments: string[],
    value: unknown,
    options?: {
      ghostIndexSegment?: string;
    },
  ) {
    for (let scopeLength = changedPathSegments.length; scopeLength >= 1; scopeLength -= 1) {
      const scopePathSegments = changedPathSegments.slice(0, scopeLength);
      const scopeNode = this.#resolvePathNode(scopePathSegments);
      if (!scopeNode) {
        continue;
      }

      let payload: unknown;
      const nextSegment = changedPathSegments[scopeLength];
      const shouldEmitIndexedBranchPayload =
        Boolean(store) &&
        Boolean(scopeNode.indexedChild) &&
        typeof nextSegment === "string" &&
        this.#matchesIndexedSegment(scopeNode, nextSegment);

      if (shouldEmitIndexedBranchPayload && store) {
        payload = this.#createIndexedBranchPayload(
          store,
          scopePathSegments,
          nextSegment,
          options?.ghostIndexSegment === nextSegment &&
            scopeLength + 1 === changedPathSegments.length,
        );
      } else {
        payload = this.#createRelativePayload(
          changedPathSegments.slice(scopeLength),
          value,
        );
      }

      this.emit(`${domain}:${scopePathSegments.join(".")}`, payload);
    }
  }

  #normalizeDomainPath(domain: "Config" | "Status", path: string) {
    const segments = this.#getDomainPath(domain, this.#normalizePath(path));

    if (segments[1] === domain) {
      return segments.slice(1);
    }

    return segments;
  }

  #removeStoreBranch(domain: "Config" | "Status", store: Map<string, unknown>, path: string) {
    const normalizedPath = this.#normalizeDomainPath(domain, path);
    const branchKey = normalizedPath.join(".");
    let removed = false;

    for (const storeKey of [...store.keys()]) {
      if (storeKey === branchKey || storeKey.startsWith(`${branchKey}.`)) {
        store.delete(storeKey);
        removed = true;
      }
    }

    if (!removed) {
      return false;
    }

    const parentPath = normalizedPath.slice(0, -1);
    const removedSegment = normalizedPath.at(-1);
    const parentNode = parentPath.length > 0 ? this.#resolvePathNode(parentPath) : null;
    const isIndexedBranchRemoval =
      parentNode !== null &&
      Boolean(parentNode.indexedChild) &&
      typeof removedSegment === "string" &&
      this.#matchesIndexedSegment(parentNode, removedSegment);

    const removalPayload = isIndexedBranchRemoval
      ? {
          ghost: "true",
          id: removedSegment,
        }
      : undefined;

    this.#emitScopedChange(
      domain,
      store,
      normalizedPath,
      removalPayload,
      isIndexedBranchRemoval ? { ghostIndexSegment: removedSegment } : undefined,
    );

    return true;
  }

  #createInvalidCommandParameterError() {
    return {
      code: missingOrInvalidCommandParametersError.code,
      message: missingOrInvalidCommandParametersError.message,
    };
  }

  #isPlainObject(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  #matchesLiteralValue(value: unknown, allowedValues: string[]) {
    return typeof value === "string" && allowedValues.includes(value);
  }

  #matchesIntegerValue(
    value: unknown,
    minRaw?: string,
    maxRaw?: string,
    stepRaw?: string,
  ) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return false;
    }

    const min = typeof minRaw === "string" ? Number(minRaw) : undefined;
    const max = typeof maxRaw === "string" ? Number(maxRaw) : undefined;
    const step = typeof stepRaw === "string" ? Number(stepRaw) : undefined;

    if (typeof min === "number" && value < min) {
      return false;
    }

    if (typeof max === "number" && value > max) {
      return false;
    }

    if (typeof min === "number" && typeof step === "number" && step > 0) {
      return (value - min) % step === 0;
    }

    return true;
  }

  #matchesStringValue(value: unknown, minLengthRaw?: string, maxLengthRaw?: string) {
    if (typeof value !== "string") {
      return false;
    }

    const minLength =
      typeof minLengthRaw === "string" ? Number(minLengthRaw) : undefined;
    const maxLength =
      typeof maxLengthRaw === "string" ? Number(maxLengthRaw) : undefined;

    if (typeof minLength === "number" && value.length < minLength) {
      return false;
    }

    if (typeof maxLength === "number" && value.length > maxLength) {
      return false;
    }

    return true;
  }

  #matchesArrayValue(value: unknown, itemMatcher: (item: unknown) => boolean) {
    return Array.isArray(value) && value.every((item) => itemMatcher(item));
  }

  #matchesParameterValue(valuespace: any, value: unknown) {
    if (!valuespace?.type) {
      return true;
    }

    if (valuespace.type === "Integer") {
      return this.#matchesIntegerValue(
        value,
        valuespace.Min,
        valuespace.Max,
        valuespace.Step,
      );
    }

    if (valuespace.type === "Literal") {
      return this.#matchesLiteralValue(value, valuespace.Values ?? []);
    }

    if (valuespace.type === "String") {
      return this.#matchesStringValue(
        value,
        valuespace.MinLength,
        valuespace.MaxLength,
      );
    }

    if (valuespace.type === "IntegerArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesIntegerValue(item, valuespace.Min, valuespace.Max, valuespace.Step),
      );
    }

    if (valuespace.type === "LiteralArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesLiteralValue(item, valuespace.Values ?? []),
      );
    }

    if (valuespace.type === "StringArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesStringValue(item, valuespace.MinLength, valuespace.MaxLength),
      );
    }

    return true;
  }

  #validateCommandArguments(path: string[], parameters: unknown) {
    const commandKey = path.join(".");
    const schemaModel = this.#getActiveSchemaModel();
    const signatures = schemaModel.commandSignatures.get(commandKey);

    if (!signatures || signatures.length === 0) {
      return null;
    }

    const activeProductCodes = this.#getActiveProductCodes();
    const activeSignatures = activeProductCodes.length === 0
      ? signatures
      : signatures.filter((signature) =>
          this.#productsIncludeActiveProduct(signature.products, activeProductCodes),
        );

    if (activeSignatures.length === 0) {
      return null;
    }

    if (!this.#isPlainObject(parameters)) {
      if (
        typeof parameters === "undefined" &&
        activeSignatures.some((signature) =>
          signature.parameters.every((parameter) => !parameter.required),
        )
      ) {
        return null;
      }

      return missingOrInvalidCommandParametersError;
    }

    const parameterRecord = parameters as Record<string, unknown>;
    let firstBadParameterName: string | null = null;

    for (const signature of activeSignatures) {
      let signatureIsValid = true;
      let signatureHasMissingRequiredParameter = false;

      for (const parameter of signature.parameters) {
        const hasParameter = Object.hasOwn(parameterRecord, parameter.name);

        if (!hasParameter) {
          if (parameter.required) {
            signatureIsValid = false;
            signatureHasMissingRequiredParameter = true;
            break;
          }

          continue;
        }

        const value = parameterRecord[parameter.name];
        if (!this.#matchesParameterValue(parameter.valuespace, value)) {
          signatureIsValid = false;
          firstBadParameterName ??= parameter.name;
          break;
        }
      }

      if (signatureIsValid) {
        return null;
      }

      if (signatureHasMissingRequiredParameter) {
        continue;
      }
    }

    if (firstBadParameterName) {
      return this.#createInvalidCommandParameterError();
    }

    return missingOrInvalidCommandParametersError;
  }

  // Helper to emit mock events in tests
  emitEvent(path: PathInput, eventData: any) {
    const eventSegments = this.#getDomainPath("Event", this.#normalizePath(path));

    if (!this.#resolvePathNode(eventSegments) || !this.#pathSupportsActiveProduct(eventSegments, true)) {
      throw { ...invalidPathError };
    }

    this.#emitScopedChange("Event", null, eventSegments, eventData);
    return true;
  }

  // Helper to remove a status branch in tests, such as a call ending.
  removeStatus(path: string) {
    return this.#removeStoreBranch("Status", this.#statusStore, path);
  }

}

export function createXapi() {
  return new MockXapi();
}

const xapi = createXapi();
export default xapi;
