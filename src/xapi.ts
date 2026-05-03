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

/** @internal */
export type NormalizedPathSegment = string | number;
/** @internal */
export type PathInput = string | Array<string | number>;
type StoreDomain = "Config" | "Status";
type SubscriptionDomain = StoreDomain | "Event";
type SharedProxyDomain = "Command" | "Config" | "Event" | "Status";
type SharedProxyOperation = "emit" | "get" | "on" | "once" | "remove" | "set";

/**
 * TypeDoc-facing names for the public mock `xapi` surfaces.
 *
 * These names intentionally mirror how code uses the mock: new style
 * `xapi.Command`, old style `xapi.command`, runtime values such as `xapi.doc`,
 * and test-only mock controls.
 */
export namespace xapi {
  /**
   * Listener used by `xapi.status.on(...)`, `xapi.config.on(...)`,
   * `xapi.event.on(...)`, and new style `.on(...)` calls.
   *
   * @group Type helpers
   * @internal
   */
  export type Listener = (payload: unknown) => void;

  /**
   * Function returned by subscription APIs. Call it to stop receiving updates.
   *
   * @group Type helpers
   * @internal
   */
  export type Unsubscribe = () => void;

  /**
   * Jest mock controls exposed by xAPI functions.
   *
   * New style command paths, operation functions, and old style functions are
   * backed by `jest.fn(...)`, so tests can use Jest validators such as
   * `toHaveBeenCalledWith(...)`, inspect `.mock.calls`, and provide test
   * responses with helpers such as `mockImplementationOnce(...)`.
   *
   * These are the Jest mock APIs exposed by Jest 30 mock functions:
   * `mock`, `getMockImplementation`, `getMockName`, `mockClear`,
   * `mockReset`, `mockRestore`, `mockImplementation`,
   * `mockImplementationOnce`, `withImplementation`, `mockName`,
   * `mockReturnThis`, `mockReturnValue`, `mockReturnValueOnce`,
   * `mockResolvedValue`, `mockResolvedValueOnce`, `mockRejectedValue`, and
   * `mockRejectedValueOnce`.
   *
   * @group Jest mock controls and assertions
   * @internal
   */
  export interface JestMockControls {
    _isMockFunction: true;
    getMockImplementation(): unknown;
    getMockName(): string;
    mock: unknown;
    mockClear(): unknown;
    mockImplementation(fn: any): unknown;
    mockImplementationOnce(fn: any): unknown;
    mockName(name: string): unknown;
    mockRejectedValue(value: unknown): unknown;
    mockRejectedValueOnce(value: unknown): unknown;
    mockResolvedValue(value: unknown): unknown;
    mockResolvedValueOnce(value: unknown): unknown;
    mockReset(): unknown;
    mockRestore(): unknown;
    mockReturnThis(): unknown;
    mockReturnValue(value: unknown): unknown;
    mockReturnValueOnce(value: unknown): unknown;
    withImplementation(fn: any, callback: () => Promise<unknown>): Promise<void>;
    withImplementation(fn: any, callback: () => void): void;
  }

  /**
   * Any xAPI function backed by `jest.fn(...)`.
   *
   * This includes new style command paths and operations such as
   * `xapi.Command.Dial`, `xapi.Status.Audio.Volume.get`, and
   * `xapi.Event.UserInterface.Extensions.Panel.Clicked.emit`, plus old style
   * functions such as `xapi.command`, `xapi.status.get`, `xapi.config.set`,
   * `xapi.event.on`, and `xapi.doc`.
   *
   * @group Jest mock controls and assertions
   * @internal
   */
  export type MockedFunction<T extends (...args: any[]) => unknown> =
    JestMockControls & T;

  /**
   * Jest controls plus the jsxapi-style `.calls` helpers exposed by new style
   * paths and operations.
   *
   * @group Jest mock controls and assertions
   * @internal
   */
  export interface MockFunctionControls extends JestMockControls {
    all(): Array<{ args: unknown[] }>;
    calls: {
      all(): Array<{ args: unknown[] }>;
      count(): number;
    };
  }

  /**
   * Jest-backed operation function exposed on new style paths, such as
   * `.get`, `.set`, `.on`, `.once`, `.remove`, or `.emit`.
   *
   * @group Jest mock controls and assertions
   * @internal
   */
  export type Operation<T extends (...args: any[]) => unknown> =
    MockFunctionControls & T;

  /**
   * New style `xapi.Command` surface.
   *
   * Build command paths with property access and call the terminal path. Each
   * terminal command is a Jest mock function.
   *
   * ```js
   * await xapi.Command.Dial({ Number: "number@example.com" });
   * expect(xapi.Command.Dial).toHaveBeenCalledWith({
   *   Number: "number@example.com",
   * });
   * ```
   *
   * @group xapi.Command
   */
  export interface Command extends MockFunctionControls {
    (params?: unknown, body?: unknown): Promise<unknown>;
    [segment: string]: any;
    [segment: number]: Command;
  }

  /**
   * New style `xapi.Config` surface.
   *
   * Supports `.get()`, `.set(value)`, `.on(listener)`, and `.once(listener)` on
   * schema-backed configuration paths.
   *
   * @group xapi.Config
   */
  export interface Config extends MockFunctionControls {
    [segment: string]: any;
    [segment: number]: Config;
    get: Operation<() => Promise<unknown>>;
    on: Operation<(listener: Listener) => Unsubscribe>;
    once: Operation<(listener: Listener) => Unsubscribe>;
    set: Operation<(value: unknown) => Promise<unknown>>;
  }

  /**
   * New style `xapi.Status` surface.
   *
   * Supports `.get()`, `.on(listener)`, `.once(listener)`, plus test-only
   * `.set(value)` and `.remove()` helpers for status updates.
   *
   * @group xapi.Status
   */
  export interface Status extends MockFunctionControls {
    [segment: string]: any;
    [segment: number]: Status;
    get: Operation<() => Promise<unknown>>;
    on: Operation<(listener: Listener) => Unsubscribe>;
    once: Operation<(listener: Listener) => Unsubscribe>;
    remove: Operation<() => boolean>;
    set: Operation<(value: unknown) => unknown>;
  }

  /**
   * New style `xapi.Event` surface.
   *
   * Supports `.on(listener)`, `.once(listener)`, plus the test-only
   * `.emit(payload)` helper for event simulation.
   *
   * @group xapi.Event
   */
  export interface Event extends MockFunctionControls {
    [segment: string]: any;
    [segment: number]: Event;
    emit: Operation<(payload: unknown) => boolean>;
    on: Operation<(listener: Listener) => Unsubscribe>;
    once: Operation<(listener: Listener) => Unsubscribe>;
  }

  /**
   * Old style `xapi.command(path, params?, body?)` function.
   *
   * This function is backed by `jest.fn(...)`, so command calls can be asserted
   * with Jest matchers. It also supports path-scoped overloads for command
   * result helpers:
   *
   * - `mockImplementation(path, handler)`
   * - `mockImplementationOnce(path, handler)`
   * - `mockResolvedValue(path, value)`
   * - `mockResolvedValueOnce(path, value)`
   * - `mockRejectedValue(path, value)`
   * - `mockRejectedValueOnce(path, value)`
   * - `mockReturnValue(path, value)`
   * - `mockReturnValueOnce(path, value)`
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  export interface command extends JestMockControls {
    (path: PathInput, params?: unknown, body?: unknown): Promise<unknown>;

    /**
     * Override matching old style command calls with a persistent handler.
     *
     * The standard Jest form is still supported when the first argument is a
     * function.
     */
    mockImplementation(path: PathInput, handler: CommandHandler): this;
    mockImplementation(fn: any): this;

    /**
     * Override the next old style command call matching `path`.
     *
     * ```js
     * xapi.command.mockImplementationOnce("Dial", async (params) => ({
     *   dialed: params.Number,
     * }));
     * ```
     *
     * The standard Jest form is still supported:
     *
     * ```js
     * xapi.command.mockImplementationOnce(async (path, params) => ({
     *   path,
     *   params,
     * }));
     * ```
     */
    mockImplementationOnce(
      path: PathInput,
      handler: CommandHandler,
    ): this;
    mockImplementationOnce(fn: any): this;

    /**
     * Reject matching old style command calls with `value`.
     *
     * The standard Jest form is still supported when called with one argument.
     */
    mockRejectedValue(path: PathInput, value: unknown): this;
    mockRejectedValue(value: unknown): this;

    /**
     * Reject the next matching old style command call with `value`.
     *
     * The standard Jest form is still supported when called with one argument.
     */
    mockRejectedValueOnce(path: PathInput, value: unknown): this;
    mockRejectedValueOnce(value: unknown): this;

    /**
     * Resolve matching old style command calls with `value`.
     *
     * The standard Jest form is still supported when called with one argument.
     */
    mockResolvedValue(path: PathInput, value: unknown): this;
    mockResolvedValue(value: unknown): this;

    /**
     * Resolve the next matching old style command call with `value`.
     *
     * The standard Jest form is still supported when called with one argument.
     */
    mockResolvedValueOnce(path: PathInput, value: unknown): this;
    mockResolvedValueOnce(value: unknown): this;

    /**
     * Return `value` from matching old style command calls.
     *
     * Because `xapi.command(...)` is promise-returning, this value is wrapped in
     * a resolved promise by the command dispatcher. The standard Jest form is
     * still supported when called with one argument.
     */
    mockReturnValue(path: PathInput, value: unknown): this;
    mockReturnValue(value: unknown): this;

    /**
     * Return `value` from the next matching old style command call.
     *
     * Because `xapi.command(...)` is promise-returning, this value is wrapped in
     * a resolved promise by the command dispatcher. The standard Jest form is
     * still supported when called with one argument.
     */
    mockReturnValueOnce(path: PathInput, value: unknown): this;
    mockReturnValueOnce(value: unknown): this;
  }

  /**
   * Old style `xapi.config` object.
   *
   * Each function (`get`, `set`, `on`, and `once`) is backed by `jest.fn(...)`
   * and exposes the full Jest mock API for call assertions, inspection,
   * temporary implementations, and mock result helpers.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  export interface config {
    /**
     * Old style `xapi.config.get(path?)` function backed by `jest.fn(...)`.
     */
    get: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path?: PathInput): Promise<unknown>;
    };

    /**
     * Old style `xapi.config.on(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    on: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };

    /**
     * Old style `xapi.config.once(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    once: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };

    /**
     * Old style `xapi.config.set(path, value)` function backed by
     * `jest.fn(...)`.
     */
    set: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput, value: unknown): Promise<unknown>;
    };
  }

  /**
   * Old style `xapi.status` object.
   *
   * Each function (`get`, `on`, and `once`) is backed by `jest.fn(...)` and
   * exposes the full Jest mock API for call assertions, inspection, temporary
   * implementations, and mock result helpers.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  export interface status {
    /**
     * Old style `xapi.status.get(path?)` function backed by `jest.fn(...)`.
     */
    get: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path?: PathInput): Promise<unknown>;
    };

    /**
     * Old style `xapi.status.on(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    on: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };

    /**
     * Old style `xapi.status.once(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    once: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };
  }

  /**
   * Old style `xapi.event` object.
   *
   * Each function (`on` and `once`) is backed by `jest.fn(...)` and exposes the
   * full Jest mock API for call assertions, inspection, temporary
   * implementations, and mock result helpers.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  export interface event {
    /**
     * Old style `xapi.event.on(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    on: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };

    /**
     * Old style `xapi.event.once(path, listener)` function backed by
     * `jest.fn(...)`.
     */
    once: {
      _isMockFunction: true;
      getMockImplementation(): unknown;
      getMockName(): string;
      mock: unknown;
      mockClear(): unknown;
      mockImplementation(fn: any): unknown;
      mockImplementationOnce(fn: any): unknown;
      mockName(name: string): unknown;
      mockRejectedValue(value: unknown): unknown;
      mockRejectedValueOnce(value: unknown): unknown;
      mockResolvedValue(value: unknown): unknown;
      mockResolvedValueOnce(value: unknown): unknown;
      mockReset(): unknown;
      mockRestore(): unknown;
      mockReturnThis(): unknown;
      mockReturnValue(value: unknown): unknown;
      mockReturnValueOnce(value: unknown): unknown;
      withImplementation(
        fn: any,
        callback: () => Promise<unknown>,
      ): Promise<void>;
      withImplementation(fn: any, callback: () => void): void;
      (path: PathInput | Listener, listener?: Listener): Unsubscribe;
    };
  }

  /**
   * Runtime `xapi.doc(path)` function backed by bundled public RoomOS schemas.
   *
   * This function is backed by `jest.fn(...)` and exposes the full Jest mock API.
   *
   * @group Runtime surfaces
   */
  export interface doc {
    _isMockFunction: true;
    getMockImplementation(): unknown;
    getMockName(): string;
    mock: unknown;
    mockClear(): unknown;
    mockImplementation(fn: any): unknown;
    mockImplementationOnce(fn: any): unknown;
    mockName(name: string): unknown;
    mockRejectedValue(value: unknown): unknown;
    mockRejectedValueOnce(value: unknown): unknown;
    mockResolvedValue(value: unknown): unknown;
    mockResolvedValueOnce(value: unknown): unknown;
    mockReset(): unknown;
    mockRestore(): unknown;
    mockReturnThis(): unknown;
    mockReturnValue(value: unknown): unknown;
    mockReturnValueOnce(value: unknown): unknown;
    withImplementation(
      fn: any,
      callback: () => Promise<unknown>,
    ): Promise<void>;
    withImplementation(fn: any, callback: () => void): void;
    (path: PathInput): Promise<unknown>;
  }

  /**
   * Runtime `xapi.version` string.
   *
   * @group Runtime surfaces
   */
  export type version = string;

  /**
   * Function used by `setCommandHandler(...)` to override command behavior.
   *
   * @group Test-only mock controls
   * @internal
   */
  export type CommandHandler = (
    params?: unknown,
    body?: unknown,
    call?: CallRecord,
  ) => unknown;

  /**
   * One recorded xAPI call.
   *
   * @group Call history and reset helpers
   * @internal
   */
  export interface CallRecord {
    body?: unknown;
    listener?: unknown;
    normalizedPath: NormalizedPathSegment[];
    once?: boolean;
    originalPath?: PathInput | undefined;
    params?: unknown;
    path: NormalizedPathSegment[];
    value?: unknown;
  }

  /**
   * Snapshot of recorded calls grouped by supported xAPI area.
   *
   * @group Call history and reset helpers
   * @internal
   */
  export interface CallHistory {
    command: CallRecord[];
    config: {
      get: CallRecord[];
      on: CallRecord[];
      set: CallRecord[];
    };
    doc: CallRecord[];
    event: {
      on: CallRecord[];
    };
    status: {
      get: CallRecord[];
      on: CallRecord[];
    };
  }
}

/** @internal */
export type XapiListener = xapi.Listener;
/** @internal */
export type XapiUnsubscribe = xapi.Unsubscribe;
/** @internal */
export type XapiJestMockControls = xapi.JestMockControls;
/** @internal */
export type XapiProxyMockControls = xapi.MockFunctionControls;
/** @internal */
export type XapiCommandProxyPath = xapi.Command;
/** @internal */
export type XapiConfigProxyPath = xapi.Config;
/** @internal */
export type XapiStatusProxyPath = xapi.Status;
/** @internal */
export type XapiEventProxyPath = xapi.Event;
/** @internal */
export type XapiProxyOperation<T extends (...args: any[]) => unknown> =
  xapi.Operation<T>;
/** @internal */
export type XapiStatusApi = xapi.status;
/** @internal */
export type XapiConfigApi = xapi.config;
/** @internal */
export type XapiEventApi = xapi.event;
/** @internal */
export type XapiCommandFunction = xapi.command;
/** @internal */
export type XapiDocFunction = xapi.doc;
/** @internal */
export type XapiCloseFunction = xapi.JestMockControls & (() => void);
/** @internal */
export type CommandHandler = xapi.CommandHandler;
/** @internal */
export type XapiCallRecord = xapi.CallRecord;
/** @internal */
export type XapiCallHistory = xapi.CallHistory;

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

/**
 * Schema-backed mock of the RoomOS `xapi` module for Jest tests.
 *
 * The instance exposes the same macro-facing surfaces most RoomOS macros use:
 * old style functions such as `xapi.command(...)` and new style paths such
 * as `xapi.Command.Dial(...)`, `xapi.Status.Audio.Volume.get()`, and
 * `xapi.Event.UserInterface.Extensions.Panel.Clicked.on(...)`.
 *
 * New style paths are schema-backed and dynamic. TypeDoc cannot list every Cisco
 * xAPI path because the available paths are generated from bundled public
 * RoomOS schemas and can vary by selected product, but the supported operation
 * shapes are documented on `Command`, `Config`, `Status`, and `Event`.
 *
 * Test helpers let you seed mock state, emit status/config/event updates,
 * override command results, and assert calls while keeping macro code unchanged.
 *
 * @internal
 */
export class MockXapi extends EventEmitter {
  #callHistory = createEmptyCallHistory();
  #commandHandlers = new Map<string, CommandHandler>();
  #commandOnceHandlers = new Map<string, CommandHandler[]>();
  #commandResults = new Map<string, unknown>();
  #configStore = createConfigStore();
  #oldStyleProxyInvocationDepth = 0;
  #oldStyleProxyOriginalPaths: PathInput[] = [];
  #proxyInvocationDepth = 0;
  #proxyCache = new Map<string, unknown>();
  #statusStore = createStatusStore();

  /**
   * New style `xapi.Command` surface.
   *
   * Build command paths with property access and call the terminal path:
   *
   * ```js
   * await xapi.Command.Dial({ Number: "number@example.com" });
   * expect(xapi.Command.Dial).toHaveBeenCalledWith({
   *   Number: "number@example.com",
   * });
   * ```
   *
   * Use Jest helpers such as `mockImplementationOnce(...)` directly on command
   * paths for one-off responses.
   *
   * @group xapi.Command
   */
  Command: xapi.Command;

  /**
   * New style `xapi.Config` surface.
   *
   * Supports `.get()`, `.set(value)`, `.on(listener)`, and `.once(listener)` on
   * schema-backed config paths:
   *
   * ```js
   * await xapi.Config.Audio.DefaultVolume.set(70);
   * await xapi.Config.Audio.DefaultVolume.get();
   * ```
   *
   * Use `setConfig(...)` or `.set(...)` to write values and notify
   * matching listeners.
   *
   * @group xapi.Config
   */
  Config: xapi.Config;

  /**
   * New style `xapi.Event` surface.
   *
   * Supports `.on(listener)`, `.once(listener)`, and the test-only
   * `.emit(payload)` helper on schema-backed event paths:
   *
   * ```js
   * xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
   *   PanelId: "speed-dial-panel",
   * });
   * ```
   *
   * @group xapi.Event
   */
  Event: xapi.Event;

  /**
   * New style `xapi.Status` surface.
   *
   * Supports `.get()`, `.on(listener)`, `.once(listener)`, `.remove()`, and the
   * test-only `.set(value)` helper on schema-backed status paths:
   *
   * ```js
   * xapi.Status.Audio.Volume.set(30);
   * await xapi.Status.Audio.Volume.get();
   * ```
   *
   * Use `setStatus(...)` or `.set(...)` to write values and notify
   * matching listeners.
   *
   * @group xapi.Status
   */
  Status: xapi.Status;

  /** @internal */
  close: XapiCloseFunction;

  /**
   * Old style `xapi.command(path, params?, body?)` API.
   *
   * Valid commands resolve with a RoomOS-style success payload by default.
   * Invalid paths and invalid parameters reject with RoomOS-style error
   * objects. Use the path-scoped Jest helper overloads for old style command
   * responses:
   *
   * - `mockImplementation(path, handler)`
   * - `mockImplementationOnce(path, handler)`
   * - `mockResolvedValue(path, value)`
   * - `mockResolvedValueOnce(path, value)`
   * - `mockRejectedValue(path, value)`
   * - `mockRejectedValueOnce(path, value)`
   * - `mockReturnValue(path, value)`
   * - `mockReturnValueOnce(path, value)`
   *
   * ```js
   * xapi.command.mockImplementationOnce("Dial", async (params) => ({
   *   dialed: params.Number,
   * }));
   *
   * xapi.command.mockResolvedValueOnce("Dial", {
   *   dialed: "number@example.com",
   * });
   *
   * xapi.command.mockReturnValueOnce("Dial", {
   *   dialed: "number@example.com",
   * });
   * ```
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  command: xapi.command;

  /**
   * Old style `xapi.config` API for `get`, `set`, `on`, and `once`.
   *
   * Each function is backed by `jest.fn(...)` and exposes the full Jest mock API.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  config: xapi.config;

  /**
   * Runtime `xapi.doc(path)` API backed by the bundled public RoomOS schemas.
   *
   * This function is backed by `jest.fn(...)` and exposes the full Jest mock API.
   *
   * @group Runtime surfaces
   */
  doc: xapi.doc;

  /**
   * Old style `xapi.event` API for `on` and `once`.
   *
   * Each function is backed by `jest.fn(...)` and exposes the full Jest mock API.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  event: xapi.event;

  /**
   * Old style `xapi.status` API for `get`, `on`, and `once`.
   *
   * Each function is backed by `jest.fn(...)` and exposes the full Jest mock API.
   *
   * @group Old style xapi.command / xapi.config / xapi.status / xapi.event
   */
  status: xapi.status;

  /**
   * Mocked jsxapi version string.
   *
   * @group Runtime surfaces
   */
  version: xapi.version = "6.0.0";

  constructor() {
    super();

    const command = jest.fn((path: PathInput, params?: unknown, body?: unknown) =>
      this.#invokeSharedProxy(
        "Command",
        path,
        undefined,
        this.#getCommandProxyArgs(params, body),
        () => this.#command(path, params, body),
      ),
    ) as unknown as xapi.command;
    this.#installOldStyleCommandMockHelpers(command);
    this.command = command;
    this.doc = jest.fn((path: PathInput) => this.#doc(path));
    this.close = jest.fn(() => undefined);
    this.status = {
      get: jest.fn((path: PathInput = []) =>
        this.#invokeSharedProxy("Status", path, "get", [], () =>
          this.#statusGet(path),
        ),
      ),
      on: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#invokeSharedProxy(
            "Status",
            subscription.path,
            "on",
            [subscription.listener],
            () => this.#statusOn(subscription.path, subscription.listener, false),
          );
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#invokeSharedProxy(
            "Status",
            subscription.path,
            "once",
            [subscription.listener],
            () => this.#statusOn(subscription.path, subscription.listener, true),
          );
        },
      ),
    };
    this.config = {
      get: jest.fn((path: PathInput = []) =>
        this.#invokeSharedProxy("Config", path, "get", [], () =>
          this.#configGet(path),
        ),
      ),
      set: jest.fn((path: PathInput, value: unknown) =>
        this.#invokeSharedProxy("Config", path, "set", [value], () =>
          this.#configSet(path, value),
        ),
      ),
      on: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#invokeSharedProxy(
            "Config",
            subscription.path,
            "on",
            [subscription.listener],
            () => this.#configOn(subscription.path, subscription.listener, false),
          );
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#invokeSharedProxy(
            "Config",
            subscription.path,
            "once",
            [subscription.listener],
            () => this.#configOn(subscription.path, subscription.listener, true),
          );
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
          return this.#invokeSharedProxy(
            "Event",
            subscription.path,
            "on",
            [subscription.listener],
            () => this.#eventOn(subscription.path, subscription.listener, false),
          );
        },
      ),
      once: jest.fn(
        (
          path: PathInput | ((payload: unknown) => void),
          listener?: (payload: unknown) => void,
        ) => {
          const subscription = this.#normalizeSubscriptionArgs(path, listener);
          return this.#invokeSharedProxy(
            "Event",
            subscription.path,
            "once",
            [subscription.listener],
            () => this.#eventOn(subscription.path, subscription.listener, true),
          );
        },
      ),
    };

    this.Command = proxy({
      cache: this.#proxyCache,
      callable: false,
      invoke: ({ args, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);

        if (this.#isInvokingFromOldStyleProxy) {
          return this.#command(
            this.#getOldStyleProxyOriginalPath(apiPath),
            args[0],
            args[1],
          );
        }

        return this.#runFromProxy(() =>
          this.command(apiPath, args[0], args[1]),
        );
      },
      node: schemaCatalog.roots.Command,
      path: ["Command"],
    }) as XapiCommandProxyPath;

    this.Config = proxy({
      allowedMethods: ["get", "set", "on", "once"],
      cache: this.#proxyCache,
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "get") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#configGet(this.#getOldStyleProxyOriginalPath(apiPath));
          }

          return this.#runFromProxy(() => this.config.get(apiPath));
        }

        if (operation === "set") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#configSet(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
            );
          }

          return this.#runFromProxy(() => this.config.set(apiPath, args[0]));
        }

        if (operation === "on") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#configOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              false,
            );
          }

          return this.#runFromProxy(() => this.config.on(apiPath, args[0]));
        }

        if (operation === "once") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#configOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              true,
            );
          }

          return this.#runFromProxy(() => this.config.once(apiPath, args[0]));
        }

        throw new Error(`Unsupported config operation: ${operation}`);
      },
      node: schemaCatalog.roots.Configuration,
      path: ["Config"],
    }) as XapiConfigProxyPath;

    this.Status = proxy({
      allowedMethods: ["get", "on", "once", "remove", "set"],
      cache: this.#proxyCache,
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "get") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#statusGet(this.#getOldStyleProxyOriginalPath(apiPath));
          }

          return this.#runFromProxy(() => this.status.get(apiPath));
        }

        if (operation === "on") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#statusOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              false,
            );
          }

          return this.#runFromProxy(() => this.status.on(apiPath, args[0]));
        }

        if (operation === "once") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#statusOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              true,
            );
          }

          return this.#runFromProxy(() => this.status.once(apiPath, args[0]));
        }

        if (operation === "remove") {
          return this.#removeStatus(this.#getOldStyleProxyOriginalPath(apiPath));
        }

        if (operation === "set") {
          return this.#setStatus(
            this.#getOldStyleProxyOriginalPath(apiPath),
            args[0],
          );
        }

        throw new Error(`Unsupported status operation: ${operation}`);
      },
      node: schemaCatalog.roots.Status,
      path: ["Status"],
    }) as XapiStatusProxyPath;

    this.Event = proxy({
      allowedMethods: ["emit", "on", "once"],
      cache: this.#proxyCache,
      invoke: ({ args, operation, path }) => {
        const apiPath = this.#getApiPathFromProxyPath(path);
        if (operation === "on") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#eventOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              false,
            );
          }

          return this.#runFromProxy(() => this.event.on(apiPath, args[0]));
        }

        if (operation === "once") {
          if (this.#isInvokingFromOldStyleProxy) {
            return this.#eventOn(
              this.#getOldStyleProxyOriginalPath(apiPath),
              args[0],
              true,
            );
          }

          return this.#runFromProxy(() => this.event.once(apiPath, args[0]));
        }

        if (operation === "emit") {
          return this.#emitEvent(this.#getOldStyleProxyOriginalPath(apiPath), args[0]);
        }

        throw new Error(`Unsupported event operation: ${operation}`);
      },
      node: schemaCatalog.roots.Event,
      path: ["Event"],
    }) as XapiEventProxyPath;
  }

  /**
   * Current call-history snapshot.
   *
   * Equivalent to `getCallHistory()`.
   *
   * @group Call history and reset helpers
   * @internal
   */
  get callHistory() {
    return this.getCallHistory();
  }

  /**
   * Alias for `getCallHistory()`.
   *
   * @group Call history and reset helpers
   * @internal
   */
  getCalls() {
    return this.getCallHistory();
  }

  /**
   * Returns copied call history for commands, docs, status/config/event
   * subscriptions, and config writes.
   *
   * Use this when a test needs normalized path details or command parameters
   * beyond what a direct Jest matcher gives you.
   *
   * @group Call history and reset helpers
   * @internal
   */
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

  /**
   * Clears recorded call history and Jest mock call counts without resetting
   * stored status/config values, command handlers, or listeners.
   *
   * @group Call history and reset helpers
   * @internal
   */
  clearCallHistory() {
    this.#callHistory = createEmptyCallHistory();
    this.#clearMockCalls();
  }

  /**
   * Resets values, command overrides, listeners, call history, and Jest mock
   * call counts.
   *
   * Most test suites should call this before each macro import.
   *
   * @group Test-only mock controls
   */
  reset() {
    this.#callHistory = createEmptyCallHistory();
    this.#commandHandlers.clear();
    this.#commandOnceHandlers.clear();
    this.#commandResults.clear();
    this.#configStore = createConfigStore();
    this.#statusStore = createStatusStore();
    this.removeAllListeners();
    this.#clearMockCalls();
  }

  /**
   * Alias for `reset()`.
   *
   * @group Call history and reset helpers
   * @internal
   */
  resetAll() {
    this.reset();
  }

  /**
   * Alias for `reset()`.
   *
   * @group Call history and reset helpers
   * @internal
   */
  resetMock() {
    this.reset();
  }

  /**
   * Sets a status value and notifies matching status listeners.
   *
   * New style status `.set(value)` calls use this behavior too.
   *
   * @group Test-only mock controls
   */
  setStatus(path: PathInput, value: unknown) {
    return this.#invokeSharedProxy("Status", path, "set", [value], () =>
      this.#setStatus(path, value),
    );
  }

  #setStatus(path: PathInput, value: unknown) {
    this.#setStoreValue("Status", this.#statusStore, path, value, {
      emit: true,
      validate: true,
    });
    return value;
  }

  /**
   * Sets a configuration value and notifies matching config listeners.
   *
   * @group Test-only mock controls
   */
  setConfig(path: PathInput, value: unknown) {
    return this.#invokeSharedProxy("Config", path, "set", [value], () =>
      this.#configSet(path, value),
    );
  }

  /**
   * Overrides the result returned by a command path.
   *
   * Applies to both old style and new style command calls:
   *
   * ```js
   * xapi.setCommandResult("Dial", { status: "dialed" });
   * await xapi.Command.Dial({ Number: "number@example.com" });
   * ```
   *
   * @group Test-only mock controls
   */
  setCommandResult(path: PathInput, result: unknown) {
    this.#commandResults.set(this.#getMockPathKey(path), result);
  }

  /**
   * Overrides command behavior with a custom function.
   *
   * The handler receives command parameters, body, and the recorded call.
   *
   * @group Test-only mock controls
   */
  setCommandHandler(path: PathInput, handler: CommandHandler) {
    this.#commandHandlers.set(this.#getMockPathKey(path), handler);
  }

  get #isInvokingFromOldStyleProxy() {
    return this.#oldStyleProxyInvocationDepth > 0;
  }

  get #isInvokingFromProxy() {
    return this.#proxyInvocationDepth > 0;
  }

  #getOldStyleProxyOriginalPath(fallback: PathInput) {
    return this.#oldStyleProxyOriginalPaths.at(-1) ?? fallback;
  }

  #runFromOldStyleProxy<T>(path: PathInput, callback: () => T) {
    this.#oldStyleProxyInvocationDepth += 1;
    this.#oldStyleProxyOriginalPaths.push(path);

    try {
      return callback();
    } finally {
      this.#oldStyleProxyOriginalPaths.pop();
      this.#oldStyleProxyInvocationDepth -= 1;
    }
  }

  #runFromProxy<T>(callback: () => T) {
    this.#proxyInvocationDepth += 1;

    try {
      return callback();
    } finally {
      this.#proxyInvocationDepth -= 1;
    }
  }

  #getCommandProxyArgs(params?: unknown, body?: unknown) {
    if (body !== undefined) {
      return [params, body];
    }

    if (params !== undefined) {
      return [params];
    }

    return [];
  }

  #getSharedProxyRoot(domain: SharedProxyDomain) {
    if (domain === "Command") {
      return this.Command;
    }

    if (domain === "Config") {
      return this.Config;
    }

    if (domain === "Event") {
      return this.Event;
    }

    return this.Status;
  }

  #getSharedProxyTarget(
    domain: SharedProxyDomain,
    path: PathInput,
    operation?: SharedProxyOperation,
  ) {
    const normalizedPath = this.#normalizePath(path);
    let target = this.#getSharedProxyRoot(domain) as Record<string | number, unknown>;

    for (const segment of normalizedPath) {
      target = target[segment] as Record<string | number, unknown>;
    }

    if (operation) {
      return target[operation];
    }

    return target;
  }

  #invokeSharedProxy<T>(
    domain: SharedProxyDomain,
    path: PathInput,
    operation: SharedProxyOperation | undefined,
    args: unknown[],
    fallback: () => T,
  ) {
    if (this.#isInvokingFromProxy || this.#isInvokingFromOldStyleProxy) {
      return fallback();
    }

    const target = this.#getSharedProxyTarget(domain, path, operation);

    if (typeof target !== "function") {
      return fallback();
    }

    return this.#runFromOldStyleProxy(path, () => target(...args)) as T;
  }

  #installOldStyleCommandMockHelpers(command: xapi.command) {
    const jestMockImplementation =
      command.mockImplementation.bind(command);
    const jestMockImplementationOnce =
      command.mockImplementationOnce.bind(command);
    const jestMockRejectedValue =
      command.mockRejectedValue.bind(command);
    const jestMockRejectedValueOnce =
      command.mockRejectedValueOnce.bind(command);
    const jestMockResolvedValue =
      command.mockResolvedValue.bind(command);
    const jestMockResolvedValueOnce =
      command.mockResolvedValueOnce.bind(command);
    const jestMockReturnValue =
      command.mockReturnValue.bind(command);
    const jestMockReturnValueOnce =
      command.mockReturnValueOnce.bind(command);

    command.mockImplementation = ((...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "function") {
        return jestMockImplementation(args[0]);
      }

      const [path, handler] = args;

      if (typeof handler !== "function") {
        throw new TypeError(
          "xapi.command.mockImplementation(path, handler) requires a handler function",
        );
      }

      this.#commandHandlers.set(
        this.#getMockPathKey(path as PathInput),
        handler as CommandHandler,
      );
      return command;
    }) as xapi.command["mockImplementation"];

    command.mockImplementationOnce = ((...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "function") {
        return jestMockImplementationOnce(args[0]);
      }

      const [pathOrHandler, handler] = args;

      if (typeof handler !== "function") {
        throw new TypeError(
          "xapi.command.mockImplementationOnce(path, handler) requires a handler function",
        );
      }

      this.#queueCommandOnceHandler(
        pathOrHandler as PathInput,
        handler as CommandHandler,
      );
      return command;
    }) as xapi.command["mockImplementationOnce"];

    command.mockRejectedValue = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockRejectedValue(args[0]);
      }

      const [path, value] = args;
      this.#commandHandlers.set(
        this.#getMockPathKey(path as PathInput),
        () => Promise.reject(value),
      );
      return command;
    }) as xapi.command["mockRejectedValue"];

    command.mockRejectedValueOnce = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockRejectedValueOnce(args[0]);
      }

      const [path, value] = args;
      this.#queueCommandOnceHandler(path as PathInput, () => Promise.reject(value));
      return command;
    }) as xapi.command["mockRejectedValueOnce"];

    command.mockResolvedValue = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockResolvedValue(args[0]);
      }

      const [path, value] = args;
      this.#commandHandlers.set(
        this.#getMockPathKey(path as PathInput),
        () => Promise.resolve(value),
      );
      return command;
    }) as xapi.command["mockResolvedValue"];

    command.mockResolvedValueOnce = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockResolvedValueOnce(args[0]);
      }

      const [path, value] = args;
      this.#queueCommandOnceHandler(path as PathInput, () => Promise.resolve(value));
      return command;
    }) as xapi.command["mockResolvedValueOnce"];

    command.mockReturnValue = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockReturnValue(args[0]);
      }

      const [path, value] = args;
      this.#commandResults.set(this.#getMockPathKey(path as PathInput), value);
      return command;
    }) as xapi.command["mockReturnValue"];

    command.mockReturnValueOnce = ((...args: unknown[]) => {
      if (args.length === 1) {
        return jestMockReturnValueOnce(args[0]);
      }

      const [path, value] = args;
      this.#queueCommandOnceHandler(path as PathInput, () => value);
      return command;
    }) as xapi.command["mockReturnValueOnce"];
  }

  #queueCommandOnceHandler(path: PathInput, handler: CommandHandler) {
    const commandKey = this.#getMockPathKey(path);
    const handlers = this.#commandOnceHandlers.get(commandKey) ?? [];
    handlers.push(handler);
    this.#commandOnceHandlers.set(commandKey, handlers);
  }

  #takeCommandOnceHandler(commandKey: string) {
    const handlers = this.#commandOnceHandlers.get(commandKey);
    const handler = handlers?.shift();

    if (handlers && handlers.length === 0) {
      this.#commandOnceHandlers.delete(commandKey);
    }

    return handler;
  }

  #command(path: PathInput, params?: unknown, body?: unknown) {
    const normalizedPath = this.#normalizePath(path);
    const call = this.#recordCall(this.#callHistory.command, path, normalizedPath, {
      body,
      params,
    });
    const commandKey = this.#getNormalizedPathKey(normalizedPath);
    const commandOnceHandler = this.#takeCommandOnceHandler(commandKey);

    if (commandOnceHandler) {
      try {
        return Promise.resolve(commandOnceHandler(params, body, call));
      } catch (error) {
        return createRejectedResult(error);
      }
    }

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
      lastSegment === "remove" ||
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

  #normalizeDomainPath(domain: "Config" | "Status", path: PathInput) {
    const segments = this.#getDomainPath(domain, this.#normalizePath(path));

    if (segments[1] === domain) {
      return segments.slice(1);
    }

    return segments;
  }

  #removeStoreBranch(domain: "Config" | "Status", store: Map<string, unknown>, path: PathInput) {
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

  /**
   * Emits an event payload to matching event listeners.
   *
   * New style event `.emit(payload)` calls use this behavior.
   *
   * @group Test-only mock controls
   */
  emitEvent(path: PathInput, eventData: unknown) {
    return this.#invokeSharedProxy("Event", path, "emit", [eventData], () =>
      this.#emitEvent(path, eventData),
    );
  }

  #emitEvent(path: PathInput, eventData: unknown) {
    const eventSegments = this.#getDomainPath("Event", this.#normalizePath(path));

    if (!this.#resolvePathNode(eventSegments) || !this.#pathSupportsActiveProduct(eventSegments, true)) {
      throw { ...invalidPathError };
    }

    this.#emitScopedChange("Event", null, eventSegments, eventData);
    return true;
  }

  /**
   * Removes a status branch and emits a RoomOS-style ghost payload for indexed
   * branches.
   *
   * This is useful for testing lifecycle-like status changes such as a call
   * ending.
   *
   * @group Test-only mock controls
   */
  removeStatus(path: PathInput) {
    return this.#invokeSharedProxy("Status", path, "remove", [], () =>
      this.#removeStatus(path),
    );
  }

  #removeStatus(path: PathInput) {
    return this.#removeStoreBranch("Status", this.#statusStore, path);
  }

}

/**
 * Shared default mock xAPI instance exported by `jest-mock-xapi`.
 *
 * This is the instance normally mapped to the virtual RoomOS `xapi` module in
 * Jest projects.
 *
 * @group Runtime surfaces
 * @internal
 */
const xapi = new MockXapi();
export default xapi;
