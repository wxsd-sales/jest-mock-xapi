# Jest Mock xAPI

Run Cisco RoomOS JavaScript macro tests in Node.js while preserving the normal `import xapi from "xapi"` developer experience.

This project provides a Jest-compatible mock of the RoomOS `xapi` module so JavaScript macros for Cisco RoomOS devices can be tested locally in a standard Node environment. It exists so macro developers can validate behavior without deploying to a device for every change or changing production macro imports.


## Overview

The package exposes a mocked default `xapi` export that mirrors the RoomOS macro runtime and is backed by generated RoomOS schemas. Known paths, product-specific availability, default configuration values, command parameters, and `xapi.doc(...)` results behave much closer to a real device.

### New style API support

```js
// Call commands with schema-backed new style paths.
await xapi.Command.Audio.Volume.Set({ Level: 10 });

// Read status values from new style status paths.
await xapi.Status.Audio.Volume.get();

// Set config values and notify matching config listeners.
await xapi.Config.Audio.DefaultVolume.set(10);

// Subscribe to event payloads with the same path shape used by RoomOS.
xapi.Event.UserInterface.Extensions.Panel.Clicked.on((event) => {
  console.log("Panel:", event.PanelId);
});
```

See [Use new style RoomOS API](#use-new-style-roomos-api) and [Set values and trigger xAPI updates](#set-values-and-trigger-xapi-updates).

### Old style API support

```js
// Call commands with the public RoomOS spaced path style.
await xapi.command("Audio Volume Set", { Level: 10 });

// Read status values with a spaced old style path.
await xapi.status.get("Audio Volume");

// Set config values with the old style API.
await xapi.config.set("Audio DefaultVolume", 10);

// Subscribe to event payloads with an old style path.
xapi.event.on("UserInterface Extensions Panel Clicked", (event) => {
  console.log("Panel:", event.PanelId);
});
```

See [Use old style RoomOS API](#use-old-style-roomos-api).

### Product-enforced xAPI usage

```js
// Desk Pro is the default product platform.
await xapi.Status.SystemUnit.ProductPlatform.get();

// Switch the mock to another product platform and its supported xAPIs.
xapi.Status.SystemUnit.ProductPlatform.set("Codec EQ");

// Schema docs are product-aware.
await xapi.doc("Command Audio Setup Clear");

// Switching back to Desk Pro removes unsupported product-specific docs/paths.
xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");
```

See [Select a RoomOS product](#select-a-roomos-product) and [Read schema docs](#read-schema-docs).

### Test helper functions

```js
// Set a status value and notify matching status listeners.
xapi.Status.Audio.Volume.set(30);

// Set a config value and notify matching config listeners.
await xapi.Config.Audio.DefaultVolume.set(70);

// Emit an event payload to matching event listeners.
xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
  PanelId: "speed-dial-panel",
});

// Assert command calls with normal Jest matchers.
expect(xapi.Command.Dial).toHaveBeenCalledWith({
  Number: "number@example.com",
});
```

See [Set leaf status and config values](#set-leaf-status-and-config-values), [Emit xEvent payloads](#emit-xevent-payloads), [Assert xCommand calls](#assert-xcommand-calls), and [Mock utilities](#mock-utilities).


## Setup

### Prerequisites

- Node.js 20 or later is recommended for local development and testing.
- A Jest-based test setup is expected in the macro project that consumes this package.
- The macro under test should import `xapi` exactly as it would on a Cisco RoomOS device:

  `import xapi from "xapi";`

### Installation
1.  Install `jest-mock-xapi` and Jest in your macro project.
    ```sh
    npm install --save-dev jest jest-mock-xapi
    ```
2.  Choose one Jest integration option in your macro project's `package.json`.

    **Option 1 (recommended):** Map `xapi` directly to `jest-mock-xapi` with `moduleNameMapper`.
    ```json
    {
      "type": "module",
      "scripts": {
        "test": "NODE_OPTIONS=--experimental-vm-modules jest --runInBand",
        "test:watch": "NODE_OPTIONS=--experimental-vm-modules jest --watchAll --runInBand"
      },
      "jest": {
        "testEnvironment": "node",
        "moduleNameMapper": {
          "^xapi$": "jest-mock-xapi"
        }
      }
    }
    ```

    See the [speed-dial-macro example package.json](./examples/speed-dial-macro/package.json) for this option in a working macro project.

    **Option 2:** Register the virtual `xapi` module through the package's setup entrypoint if you prefer a setup-file workflow.
    ```json
    {
      "type": "module",
      "scripts": {
        "test": "NODE_OPTIONS=--experimental-vm-modules jest --runInBand",
        "test:watch": "NODE_OPTIONS=--experimental-vm-modules jest --watchAll --runInBand"
      },
      "jest": {
        "testEnvironment": "node",
        "setupFiles": ["jest-mock-xapi/register"]
      }
    }
    ```
3.  Write tests that import your macro, set xAPI values or emit xAPI changes, and then assert the macro responded correctly.
    ```js
    import { beforeEach, describe, expect, it, jest } from "@jest/globals";

    describe("my roomos macro", () => {
      beforeEach(() => {
        jest.resetModules();
      });

      it("dials when a panel event is triggered", async () => {
        const { default: xapi } = await import("xapi");
        xapi.reset();

        await import("./my-macro.js");

        xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
          PanelId: "speed-dial-panel",
        });

        expect(xapi.Command.Dial).toHaveBeenCalledWith({
          Number: "number@example.com",
        });
      });
    });
    ```
4.  Run the tests from your macro project.

    Run your tests once with:
    ```sh
    npm test
    ```

    Expected output:
    ```text
    PASS ./my-macro.test.js
      my roomos macro
        ✓ dials when a panel event is triggered

    Test Suites: 1 passed, 1 total
    Tests:       1 passed, 1 total
    ```

    Run your tests continuously upon macro/test code changes with:

    ```sh
    npm run test:watch
    ```

The package has two public entrypoints:

- `jest-mock-xapi` exports the mock object itself and is the recommended target for `moduleNameMapper`.
- `jest-mock-xapi/register` registers a virtual `xapi` module for Jest setup-file workflows.

## Usage

The expected development flow is that a macro developer installs `jest-mock-xapi`, keeps production macro code written for the native RoomOS runtime, and uses Jest to control mock device state from tests. In practice, a test imports the macro, seeds status or config values, emits events or updates, and then asserts the macro reacted with the expected xAPI calls.

### Supported xAPI surface

The mock is exposed as a default module export, matching the RoomOS macro runtime:

```js
import xapi from "xapi";
```

The supported macro-facing surface includes:

#### New style

```js
// Commands are schema-backed Jest mock functions.
await xapi.Command.Audio.Volume.Set({ Level: 10 });

// Status paths can be read, subscribed to, and removed in tests.
await xapi.Status.Audio.Volume.get();
xapi.Status.Audio.Volume.on(listener);
xapi.Status.Audio.Volume.once(listener);
xapi.Status.Call[1].remove();

// Config paths can be read, set, and subscribed to.
await xapi.Config.Audio.DefaultVolume.get();
await xapi.Config.Audio.DefaultVolume.set(70);
xapi.Config.Audio.DefaultVolume.on(listener);
xapi.Config.Audio.DefaultVolume.once(listener);

// Event paths can be subscribed to.
xapi.Event.UserInterface.Extensions.Panel.Clicked.on(listener);
xapi.Event.UserInterface.Extensions.Panel.Clicked.once(listener);

// Indexed paths use bracket notation.
await xapi.Status.Call[1].Status.get();

// New style command paths and operation functions expose Jest helpers.
xapi.Command.Dial.mockResolvedValueOnce(result);
xapi.Status.Audio.Volume.get.mockResolvedValueOnce(55);
```

The same operation shape is available for any schema-backed path supported by the selected product.

#### Old style

```js
// Commands use spaced public RoomOS paths.
await xapi.command("Audio Volume Set", { Level: 10 });

// Status paths can be read and subscribed to.
await xapi.status.get("Audio Volume");
xapi.status.on("Audio Volume", listener);
xapi.status.once("Audio Volume", listener);

// Passing only a listener subscribes at the root.
xapi.status.on(listener);
xapi.status.once(listener);

// Config paths can be read, set, and subscribed to.
await xapi.config.get("Audio DefaultVolume");
await xapi.config.set("Audio DefaultVolume", 70);
xapi.config.on("Audio DefaultVolume", listener);
xapi.config.once("Audio DefaultVolume", listener);

// Event paths can be subscribed to.
xapi.event.on("UserInterface Extensions Panel Clicked", listener);
xapi.event.once("UserInterface Extensions Panel Clicked", listener);

// Path arguments can also use arrays for indexed paths.
await xapi.status.get(["Call", 1, "Status"]);

// Old style functions expose Jest helpers too.
xapi.status.get.mockResolvedValueOnce(55);
xapi.command.mockResolvedValueOnce("Dial", result);
```

#### Additional runtime surface

```js
// Read schema-derived docs for status, config, command, and event paths.
await xapi.doc("Status Audio Volume");

// The mocked xapi version defaults to 6.0.0.
xapi.version;
```

#### Test-only mock controls

The mock has two kinds of test controls:

```js
// State and event helpers set mock xAPI values or emit xAPI updates.
xapi.Status.Audio.Volume.set(30);

// Jest mock function controls override or inspect mocked xAPI calls.
xapi.Command.Dial.mockResolvedValueOnce(result);
```

##### State and event helpers

Use these when a test needs to prepare mock device state or simulate an xAPI update that should notify macro listeners.

```js
// Set a status value and notify matching status listeners.
xapi.Status.Audio.Volume.set(30);
// xapi.setStatus("Audio Volume", 30);

// Set a config value and notify matching config listeners.
await xapi.Config.Audio.DefaultVolume.set(70);
// await xapi.config.set("Audio DefaultVolume", 70);
// await xapi.setConfig("Audio DefaultVolume", 70);

// Emit an event payload to matching event listeners.
xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
  PanelId: "speed-dial-panel",
});
// xapi.emitEvent("UserInterface Extensions Panel Clicked", {
//   PanelId: "speed-dial-panel",
// });

// Remove a status branch and emit the RoomOS-style ghost payload for indexed branches.
xapi.Status.Call[7].remove();
// xapi.removeStatus("Call 7");

// Reset values, listeners, command overrides, and Jest mock call counts.
xapi.reset();
```

##### Jest mock function controls

Use these when a test needs normal Jest mock behavior, such as asserting calls, inspecting call history, or setting a one-off command response.

```js
// New style command paths use Jest helpers directly.
xapi.Command.Dial.mockResolvedValueOnce(result);

// New style operation functions expose Jest helpers too.
xapi.Status.Audio.Volume.get.mockResolvedValueOnce(55);
xapi.Event.UserInterface.Extensions.Panel.Clicked.on.mockImplementationOnce(handler);

// Mixed old/new style calls share cached path-level mocks.
await xapi.command("Dial", params);
expect(xapi.Command.Dial).toHaveBeenCalledWith(params);

await xapi.status.get("Audio Volume");
expect(xapi.Status.Audio.Volume.get).toHaveBeenCalled();

// Old style functions expose Jest helpers on the function being called.
xapi.status.get.mockResolvedValueOnce(55);
xapi.event.on.mockImplementationOnce(handler);

// Old style commands use the same helper names with the path first.
xapi.command.mockImplementationOnce("Dial", handler);
xapi.command.mockResolvedValueOnce("Dial", value);
xapi.command.mockRejectedValueOnce("Dial", error);
xapi.command.mockReturnValueOnce("Dial", value);

// Lower-level helpers can override both styles at once.
xapi.setCommandResult("Dial", result);
xapi.setCommandHandler("Dial", handler);
```

#### Jest mock APIs

The mock exposes Jest's mock-function API on both new style and old style xAPI functions. Use these APIs when you want to control a mocked function result or assert how a macro called xAPI:

```js
// Call assertions use normal Jest mock matchers.
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith(...args);
expect(fn).toHaveBeenNthCalledWith(1, ...args);

// Call inspection uses the standard Jest mock fields and helpers.
fn.mock;
fn.mock.calls;
fn.mock.results;
fn.getMockName();
fn.getMockImplementation();

// Reset and naming helpers are available on mocked xAPI functions.
fn.mockClear();
fn.mockReset();
fn.mockRestore();
fn.mockName("descriptive mock name");
fn.mockReturnThis();

// Implementation helpers support temporary command/status/config/event behavior.
fn.mockImplementation(handler);
fn.mockImplementationOnce(handler);
fn.withImplementation(handler, callback);

// Result helpers support sync, resolved, and rejected mock values.
fn.mockReturnValue(value);
fn.mockReturnValueOnce(value);
fn.mockResolvedValue(value);
fn.mockResolvedValueOnce(value);
fn.mockRejectedValue(value);
fn.mockRejectedValueOnce(value);
```

For new style command paths, call the Jest helper directly on the command path:

```js
xapi.Command.Dial.mockResolvedValueOnce({
  dialed: "number@example.com",
});
```

For old style command calls, use the same Jest helper names with the old style command path as the first argument:

```js
xapi.command.mockResolvedValueOnce("Dial", {
  dialed: "number@example.com",
});
```

The standard Jest form is still available on `xapi.command` too. When called without a path, it applies to the next `xapi.command(...)` invocation regardless of command path.


Promise-returning APIs resolve or reject like the macro runtime. Subscriptions return an unsubscribe function, and `once(...)` listeners automatically unsubscribe after the first matching update.

### Reset state between tests

Most test suites should reset values, mocks, listeners, and handlers before each test so one scenario does not leak into the next.

```js
import { beforeEach, jest } from "@jest/globals";

beforeEach(async () => {
  jest.resetModules();
  const { default: xapi } = await import("xapi");
  xapi.reset();
});
```

### Use new style RoomOS API

New style paths keep tests visually close to the xAPI paths used in RoomOS macros. Command paths are Jest mock functions, so tests can use Jest mock helpers for one-off responses. The mock also adds test helpers to new style paths: status paths support `.set(...)`, event paths support `.emit(...)`, and config paths use the normal RoomOS `.set(...)` API.

```js
import { expect, it, jest } from "@jest/globals";

it("uses new style xAPI helpers", async () => {
  const { default: xapi } = await import("xapi");
  const volumeHandler = jest.fn();

  xapi.Command.Dial.mockImplementationOnce(async (params) => ({
    dialed: params.Number,
  }));
  xapi.Status.Audio.Volume.on(volumeHandler);
  xapi.Status.Audio.Volume.set(30);

  await expect(
    xapi.Command.Dial({ Number: "number@example.com" }),
  ).resolves.toEqual({ dialed: "number@example.com" });
  await expect(xapi.Status.Audio.Volume.get()).resolves.toBe(30);
  expect(volumeHandler).toHaveBeenCalledWith(30);
});
```

For lowercase `xapi.command(...)` calls, pass the old style command path to the same Jest helper name, for example `xapi.command.mockImplementationOnce("Dial", handler)`.

### Use old style RoomOS API

The mock also supports the commonly used lowercase macro APIs. String paths use the same spaced format shown in the public RoomOS documentation, and these calls return promises like the RoomOS runtime.

```js
import { expect, it } from "@jest/globals";

it("uses old style xAPI helpers", async () => {
  const { default: xapi } = await import("xapi");

  xapi.command.mockImplementationOnce("Dial", async (params) => ({
    dialed: params.Number,
  }));
  xapi.setStatus("Audio Volume", 30);

  await expect(
    xapi.command("Dial", { Number: "number@example.com" }),
  ).resolves.toEqual({ dialed: "number@example.com" });
  await expect(xapi.status.get("Audio Volume")).resolves.toBe(30);
});
```

New style paths avoid string path parsing. When old style helpers are used, paths are normalized before lookup and call tracking. Strings normally use spaces, empty path segments are removed, string segments are capitalized, and numeric strings are converted to numbers.

```js
await xapi.Status.Audio.Volume.get();
// await xapi.status.get("Audio Volume"); // ["Audio", "Volume"]

await xapi.Status.Call[1].Status.get();
// await xapi.status.get(["Call", "1", "Status"]); // ["Call", 1, "Status"]
```

The examples below lead with new style syntax and show the closest old style equivalent as a comment where one exists.

### Set values and trigger xAPI updates

The mock lets tests update status and config values while notifying the same listeners a macro would register at runtime. Prefer the new style form in examples, with the old style helper shown as the equivalent where useful.

```js
import { expect, it, jest } from "@jest/globals";

it("sets status values and notifies xStatus listeners", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Status.Audio.Volume.on(handler);
  // xapi.status.on("Audio Volume", handler);

  xapi.Status.Audio.Volume.set(20);
  // xapi.setStatus("Audio Volume", 20);

  await expect(xapi.Status.Audio.Volume.get()).resolves.toBe(20);
  // await expect(xapi.status.get("Audio Volume")).resolves.toBe(20);

  expect(handler).toHaveBeenCalledWith(20);
});
```

Config paths already have a RoomOS `.set(...)` API. In the mock, setting a config value also notifies matching config listeners.

```js
import { expect, it, jest } from "@jest/globals";

it("sets config values and notifies config listeners", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Config.Audio.DefaultVolume.on(handler);
  // xapi.config.on("Audio DefaultVolume", handler);

  await xapi.Config.Audio.DefaultVolume.set(100);
  // await xapi.config.set("Audio DefaultVolume", 100);

  await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(100);
  // await expect(xapi.config.get("Audio DefaultVolume")).resolves.toBe(100);

  expect(handler).toHaveBeenCalledWith(100);
});
```

Command paths are Jest mock functions, so a test can set a command result directly on the new style command path. The old style equivalent uses the same Jest helper name with the old style command path as the first argument.

```js
import { expect, it } from "@jest/globals";

it("mocks a command response", async () => {
  const { default: xapi } = await import("xapi");

  xapi.Command.Dial.mockImplementationOnce(async (params) => ({
    dialed: params.Number,
  }));
  // xapi.command.mockImplementationOnce("Dial", async (params) => ({
  //   dialed: params.Number,
  // }));

  await expect(
    xapi.Command.Dial({ Number: "number@example.com" }),
  ).resolves.toEqual({ dialed: "number@example.com" });
  // await expect(
  //   xapi.command("Dial", { Number: "number@example.com" }),
  // ).resolves.toEqual({ dialed: "number@example.com" });
});
```

The same pattern works for the common Jest result helpers:

```js
xapi.Command.Dial.mockResolvedValueOnce({ status: "dialed" });
// xapi.command.mockResolvedValueOnce("Dial", { status: "dialed" });

xapi.Command.Dial.mockRejectedValueOnce({ code: 4, message: "Invalid" });
// xapi.command.mockRejectedValueOnce("Dial", {
//   code: 4,
//   message: "Invalid",
// });

xapi.Command.Dial.mockReturnValueOnce(Promise.resolve({ status: "queued" }));
// xapi.command.mockReturnValueOnce("Dial", { status: "queued" });
```

Event payloads can be emitted in the same new style shape used to subscribe to them.

```js
import { expect, it, jest } from "@jest/globals";

it("emits event payloads", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Event.UserInterface.Extensions.Panel.Clicked.on(handler);
  // xapi.event.on("UserInterface Extensions Panel Clicked", handler);

  xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
    PanelId: "speed-dial-panel",
  });
  // xapi.emitEvent("UserInterface Extensions Panel Clicked", {
  //   PanelId: "speed-dial-panel",
  // });

  expect(handler).toHaveBeenCalledWith({
    PanelId: "speed-dial-panel",
  });
});
```

### Read schema docs

`xapi.doc(...)` returns schema-derived documentation for rooted status, config, command, and event paths. You can use either `Config` or `Configuration` for configuration docs.

```js
import { expect, it } from "@jest/globals";

it("reads xapi docs", async () => {
  const { default: xapi } = await import("xapi");

  await expect(xapi.doc("Status Audio Volume")).resolves.toEqual(
    expect.objectContaining({
      ValueSpace: expect.objectContaining({
        type: "Integer",
      }),
    }),
  );

  await expect(xapi.doc("Config SystemUnit Name")).resolves.toEqual(
    expect.objectContaining({
      ValueSpace: expect.objectContaining({
        type: "String",
      }),
    }),
  );
});
```

### Assert xCommand calls

Commands are Jest mocks, so you can assert on them with normal Jest matchers.

```js
import { expect, it } from "@jest/globals";

it("dials the requested destination", async () => {
  const { default: xapi } = await import("xapi");

  await someMacroFunction();

  expect(xapi.Command.Dial).toHaveBeenCalledWith({
    Number: "number@example.com",
  });
  // expect(xapi.command).toHaveBeenCalledWith("Dial", {
  //   Number: "number@example.com",
  // });
});
```

By default, valid commands resolve with `{ status: "OK" }`. Invalid command paths reject with the same code/message shape used by RoomOS, and schema-backed commands validate required parameters and value ranges. For new style commands, use Jest helpers such as `mockResolvedValueOnce(...)` or `mockImplementationOnce(...)` directly on the command path when a test needs a specific response. For old style commands, use the same helper names on `xapi.command` with the command path first, such as `xapi.command.mockResolvedValueOnce("Dial", result)`.

### Mock utilities

Use the mock utilities to prepare state, emit updates, override command responses, and assert how the macro used xAPI with Jest mock matchers.

```js
import { expect, it } from "@jest/globals";

it("prepares state and asserts command calls", async () => {
  const { default: xapi } = await import("xapi");

  xapi.Status.Audio.Volume.set(20);
  // xapi.setStatus("Audio Volume", 20);

  await xapi.Config.Audio.DefaultVolume.set(100);
  // await xapi.config.set("Audio DefaultVolume", 100);

  xapi.Command.Dial.mockImplementationOnce(async (params) => ({
    dialed: params.Number,
  }));
  // xapi.command.mockImplementationOnce("Dial", async (params) => ({
  //   dialed: params.Number,
  // }));

  await xapi.Command.Dial({ Number: "number@example.com" });
  // await xapi.command("Dial", { Number: "number@example.com" });

  await xapi.Status.Audio.Volume.get();
  // await xapi.status.get("Audio Volume");

  expect(xapi.Command.Dial).toHaveBeenCalledWith({
    Number: "number@example.com",
  });
  // expect(xapi.command).toHaveBeenCalledWith("Dial", {
  //   Number: "number@example.com",
  // });
});
```

Available helpers:

State and event helpers:

```js
// Update status state and notify matching listeners.
xapi.Status.Audio.Volume.set(20);
// xapi.setStatus("Audio Volume", 20);

// Update config state and notify matching listeners.
await xapi.Config.Audio.DefaultVolume.set(100);
// await xapi.config.set("Audio DefaultVolume", 100);
// await xapi.setConfig("Audio DefaultVolume", 100);

// Emit event payloads to matching listeners.
xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
  PanelId: "speed-dial-panel",
});
// xapi.emitEvent("UserInterface Extensions Panel Clicked", {
//   PanelId: "speed-dial-panel",
// });

// Remove a status branch and emit the RoomOS-style ghost payload.
xapi.Status.Call[7].remove();
// xapi.removeStatus("Call 7");
```

Jest mock function helpers:

```js
// Set command behavior directly on new style command paths.
xapi.Command.Dial.mockImplementationOnce(handler);
xapi.Command.Dial.mockResolvedValueOnce(value);
xapi.Command.Dial.mockRejectedValueOnce(error);
xapi.Command.Dial.mockReturnValueOnce(value);

// Mixed-style macro code shares path-level mocks.
await xapi.command("Dial", params);
expect(xapi.Command.Dial).toHaveBeenCalledWith(params);

await xapi.status.get("Audio Volume");
expect(xapi.Status.Audio.Volume.get).toHaveBeenCalled();

// Old style command helpers use the command path first.
xapi.command.mockImplementationOnce("Dial", handler);
xapi.command.mockResolvedValueOnce("Dial", value);
xapi.command.mockRejectedValueOnce("Dial", error);
xapi.command.mockReturnValueOnce("Dial", value);
```

Lower-level command helpers:

```js
// Apply one command override to both new style and old style calls.
xapi.setCommandResult("Dial", result);
xapi.setCommandHandler("Dial", handler);
```

Reset helper:

```js
// Clear values, handlers, listeners, and Jest mock call counts.
xapi.reset();
```

### Use RoomOS runtime globals

The mock installs the RoomOS `_main_module_name()` global when `jest-mock-xapi` is loaded. It returns the name of the calling macro file without the source extension, matching the RoomOS behavior used by self-managing macros.

```js
import xapi from "xapi";

const macroName = _main_module_name();

xapi.Command.Macros.Macro.Deactivate({ Name: macroName });
// xapi.command("Macros Macro Deactivate", { Name: macroName });
```

For example, calling `_main_module_name()` from `self-deactivating-macro.js` returns `"self-deactivating-macro"`.

### Set leaf status and config values

Use new style `.set(...)` calls, lowercase `xapi.config.set(...)`, or the test-only `setStatus()` and `setConfig()` helpers to prepare mock device state before importing a macro or invoking a handler. These forms notify matching listeners.

```js
import { expect, it } from "@jest/globals";

it("reads the prepared default volume", async () => {
  const { default: xapi } = await import("xapi");

  await xapi.Config.Audio.DefaultVolume.set(100);
  // await xapi.config.set("Audio DefaultVolume", 100);

  xapi.Status.Audio.Volume.set(20);
  // xapi.setStatus("Audio Volume", 20);

  await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(100);
  // await expect(xapi.config.get("Audio DefaultVolume")).resolves.toBe(100);

  await expect(xapi.Status.Audio.Volume.get()).resolves.toBe(20);
  // await expect(xapi.status.get("Audio Volume")).resolves.toBe(20);

  await xapi.Config.Audio.DefaultVolume.set(0);
  // await xapi.config.set("Audio DefaultVolume", 0);

  xapi.Status.Audio.Volume.set(25);
  // xapi.setStatus("Audio Volume", 25);

  await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(0);
  // await expect(xapi.config.get("Audio DefaultVolume")).resolves.toBe(0);

  await expect(xapi.Status.Audio.Volume.get()).resolves.toBe(25);
  // await expect(xapi.status.get("Audio Volume")).resolves.toBe(25);
});
```

### Select a RoomOS product

The mock defaults `Status.SystemUnit.ProductPlatform` to `"Desk Pro"` and applies Desk Pro product-specific xAPI availability even when a test has not explicitly set a product. Set `Status.SystemUnit.ProductPlatform` to another public product name when a test should model a different device.

Once a known product is selected, the mock uses the newest bundled RoomOS major-release schema that supports that product. It rejects xAPI paths that are not available on that product and validates product-specific configuration values.

```js
import { expect, it } from "@jest/globals";

it("handles Desk Pro xAPI differences", async () => {
  const { default: xapi } = await import("xapi");

  xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");
  // xapi.setStatus("SystemUnit ProductPlatform", "Desk Pro");

  await xapi.Config.Video.Output.Connector[1].MonitorRole.set("Auto");
  // await xapi.config.set("Video Output Connector 1 MonitorRole", "Auto");

  await expect(
    xapi.Config.Video.Output.Connector[3].MonitorRole.set("Auto"),
  ).rejects.toEqual({
    code: 3,
    message: "No match on address expression",
  });
  // await expect(
  //   xapi.config.set("Video Output Connector 3 MonitorRole", "Auto"),
  // ).rejects.toEqual({
  //   code: 3,
  //   message: "No match on address expression",
  // });

  await expect(
    xapi.Config.Video.Output.Connector[1].MonitorRole.set("PresentationOnly"),
  ).rejects.toEqual({
    code: 4,
    message: "Invalid or missing parameters",
  });
  // await expect(
  //   xapi.config.set(
  //     "Video Output Connector 1 MonitorRole",
  //     "PresentationOnly",
  //   ),
  // ).rejects.toEqual({
  //   code: 4,
  //   message: "Invalid or missing parameters",
  // });
});
```

The selected schema also provides default software statuses. For example, a schema named `26.5.1 April 2026` produces these default values unless the test overrides them with new style `.set(...)` or `setStatus(...)`:

```text
Status SystemUnit Software DisplayName: "RoomOS 26.5.1.1 123456789"
Status SystemUnit Software Version: "ce26.5.1.1.123456789"
```

Compatibility note: tests that previously relied on the old unrestricted default may need to set `Status.SystemUnit.ProductPlatform` to the product they intend to model.

### Read full status or config branches

The mock supports aggregate `get()` calls on root paths and indexed branches, similar to the real xAPI module.

```js
import { expect, it } from "@jest/globals";

it("returns full config branches", async () => {
  const { default: xapi } = await import("xapi");

  await xapi.Config.Video.Output.Connector[1].MonitorRole.set("First");
  // await xapi.config.set("Video Output Connector 1 MonitorRole", "First");

  await xapi.Config.Video.Output.Connector[2].MonitorRole.set("Second");
  // await xapi.config.set("Video Output Connector 2 MonitorRole", "Second");

  await expect(xapi.Config.get()).resolves.toHaveProperty("Audio");
  // await expect(xapi.config.get()).resolves.toHaveProperty("Audio");

  await expect(xapi.Config.Video.Output.Connector[1].get()).resolves.toEqual(
    expect.objectContaining({
      id: "1",
      MonitorRole: "First",
    }),
  );
  // await expect(xapi.config.get("Video Output Connector 1")).resolves.toEqual(
  //   expect.objectContaining({
  //     id: "1",
  //     MonitorRole: "First",
  //   }),
  // );

  await expect(xapi.Config.Video.Output.Connector.get()).resolves.toEqual([
    expect.objectContaining({ id: "1", MonitorRole: "First" }),
    expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  ]);
  // await expect(xapi.config.get("Video Output Connector")).resolves.toEqual([
  //   expect.objectContaining({ id: "1", MonitorRole: "First" }),
  //   expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  // ]);

  await expect(xapi.Config.Video.Output.Connector["*"].get()).resolves.toEqual([
    expect.objectContaining({ id: "1", MonitorRole: "First" }),
    expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  ]);
  // await expect(xapi.config.get("Video Output Connector *")).resolves.toEqual([
  //   expect.objectContaining({ id: "1", MonitorRole: "First" }),
  //   expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  // ]);
});
```

### Emit xEvent payloads

Use `emit()` on event paths to simulate the same payloads a RoomOS device would send to a macro.

```js
import { expect, it } from "@jest/globals";

it("reacts to a panel press", async () => {
  const { default: xapi } = await import("xapi");

  await import("./my-macro.js");

  xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
    PanelId: "speed-dial-panel",
  });
  // xapi.emitEvent("UserInterface Extensions Panel Clicked", {
  //   PanelId: "speed-dial-panel",
  // });

  expect(xapi.Command.Dial).toHaveBeenCalledWith({
    Number: "number@example.com",
  });
  // expect(xapi.command).toHaveBeenCalledWith("Dial", {
  //   Number: "number@example.com",
  // });
});
```

### Subscribe to leaf updates

Leaf subscriptions behave like the real macro API and receive the updated value directly.

```js
import { expect, it, jest } from "@jest/globals";

it("notifies leaf status listeners", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Status.Audio.Volume.on(handler);
  // xapi.status.on("Audio Volume", handler);

  xapi.Status.Audio.Volume.set(55);
  // xapi.setStatus("Audio Volume", 55);

  xapi.Status.Audio.Volume.set(56);
  // xapi.setStatus("Audio Volume", 56);

  expect(handler).toHaveBeenNthCalledWith(1, 55);
  expect(handler).toHaveBeenNthCalledWith(2, 56);
});
```

### Subscribe to root or branch updates

Root and branch listeners receive a nested payload scoped to the changed branch.

```js
import { expect, it, jest } from "@jest/globals";

it("notifies root listeners with relative path payloads", async () => {
  const { default: xapi } = await import("xapi");
  const statusHandler = jest.fn();
  const configHandler = jest.fn();
  const eventHandler = jest.fn();

  xapi.Status.on(statusHandler);
  // xapi.status.on(statusHandler);

  xapi.Config.on(configHandler);
  // xapi.config.on(configHandler);

  xapi.Event.on(eventHandler);
  // xapi.event.on(eventHandler);

  xapi.Status.Audio.Volume.set(55);
  // xapi.setStatus("Audio Volume", 55);

  await xapi.Config.Audio.DefaultVolume.set(100);
  // await xapi.config.set("Audio DefaultVolume", 100);

  xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
    PanelId: "speed-dial-panel",
  });
  // xapi.emitEvent("UserInterface Extensions Panel Clicked", {
  //   PanelId: "speed-dial-panel",
  // });

  xapi.Status.Audio.Volume.set(56);
  // xapi.setStatus("Audio Volume", 56);

  await xapi.Config.Audio.DefaultVolume.set(0);
  // await xapi.config.set("Audio DefaultVolume", 0);

  xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
    PanelId: "speed-dial-panel-2",
  });
  // xapi.emitEvent("UserInterface Extensions Panel Clicked", {
  //   PanelId: "speed-dial-panel-2",
  // });

  expect(statusHandler).toHaveBeenCalledWith({
    Audio: {
      Volume: 55,
    },
  });
  expect(configHandler).toHaveBeenCalledWith({
    Audio: {
      DefaultVolume: 100,
    },
  });
  expect(eventHandler).toHaveBeenCalledWith({
    UserInterface: {
      Extensions: {
        Panel: {
          Clicked: {
            PanelId: "speed-dial-panel",
          },
        },
      },
    },
  });
  expect(statusHandler).toHaveBeenCalledWith({
    Audio: {
      Volume: 56,
    },
  });
  expect(configHandler).toHaveBeenCalledWith({
    Audio: {
      DefaultVolume: 0,
    },
  });
  expect(eventHandler).toHaveBeenCalledWith({
    UserInterface: {
      Extensions: {
        Panel: {
          Clicked: {
            PanelId: "speed-dial-panel-2",
          },
        },
      },
    },
  });
});
```

### Track indexed status branches such as calls

Indexed collection listeners such as `xapi.Status.Call.on(...)` receive the full branch snapshot plus the branch `id`.

```js
import { expect, it, jest } from "@jest/globals";

it("notifies call listeners as a call branch changes", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Status.Call.on(handler);
  // xapi.status.on("Call", handler);

  xapi.Status.Call[42].Direction.set("Outgoing");
  // xapi.setStatus("Call 42 Direction", "Outgoing");

  xapi.Status.Call[42].Status.set("Connected");
  // xapi.setStatus("Call 42 Status", "Connected");

  expect(handler).toHaveBeenNthCalledWith(1, {
    Direction: "Outgoing",
    id: "42",
  });
  expect(handler).toHaveBeenNthCalledWith(2, {
    Direction: "Outgoing",
    Status: "Connected",
    id: "42",
  });
});
```

### Remove indexed status branches

Use new style `.remove()` or `removeStatus()` to simulate an indexed status branch disappearing, such as a call ending.

```js
import { expect, it, jest } from "@jest/globals";

it("emits a ghost payload when a call ends", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Status.Call.on(handler);
  // xapi.status.on("Call", handler);

  xapi.Status.Call[7].Direction.set("Incoming");
  // xapi.setStatus("Call 7 Direction", "Incoming");

  xapi.Status.Call[7].Status.set("Connected");
  // xapi.setStatus("Call 7 Status", "Connected");

  xapi.Status.Call[7].remove();
  // xapi.removeStatus("Call 7");

  expect(handler).toHaveBeenLastCalledWith({
    ghost: "true",
    id: "7",
  });
});
```

## Demo

Here are some example macros where jest-mock-xapi is used to validate their functions:

- [speed-dial-macro demo](./examples/speed-dial-macro/README.md)
- [self-deactivating-macro demo](./examples/self-deactivating-macro/README.md)
- [monitor-role-changer demo](./examples/monitor-role-changer/README.md)

### Manual RoomOS hardware parity check

This repository also includes a local-only hardware parity script that connects to real RoomOS devices with `jsxapi`, runs the same representative xAPI calls against each device and a fresh `jest-mock-xapi` instance, then compares the response formats. The probe includes `xapi.doc(...)` status, config, command, and event paths using the public spaced path style, plus array path forms. It also checks invalid path errors, invalid command argument errors, and successful command responses. It is not part of `npm test` or `prepublishOnly`.

Validated hardware is generated by `npm run parity:devices` after all live-device checks pass. The table records the public RoomOS schema used for comparison, not the exact software build running on the tested device.

<!-- roomos-parity-results:start -->
| Hardware | RoomOS major | Tested schema | Result | Last validated |
| --- | --- | --- | --- | --- |
| Board 70 | RoomOS 11 | RoomOS 11.33.1 | 41/41 passed | 2026-05-03 |
| Codec Pro | RoomOS 26 | RoomOS 26.5.1 | 41/41 passed | 2026-05-03 |
| Desk Pro | RoomOS 26 | RoomOS 26.5.1 | 41/41 passed | 2026-05-03 |
| Room Bar Pro | RoomOS 26 | RoomOS 26.5.1 | 41/41 passed | 2026-05-03 |
<!-- roomos-parity-results:end -->

Create a local `.env` from `.env.example`:

```sh
cp .env.example .env
```

Add the shared credentials and an address array:

```sh
ROOMOS_PARITY_USERNAME=admin
ROOMOS_PARITY_PASSWORD=password
ROOMOS_PARITY_ADDRESSES='["192.0.2.10","192.0.2.11"]'
ROOMOS_PARITY_UPDATE_README=true
```

The script tries `ssh://` for each address first, then retries with `wss://`
if SSH fails. Test output uses the detected `SystemUnit ProductPlatform` value
for each connected device rather than a configured device name. The legacy
`ROOMOS_PARITY_DEVICES='[...]'` JSON array and `ROOMOS_PARITY_DEVICE_1_*`
numbered blocks are still supported for existing local files.

Run the manual check with:

```sh
npm run parity:devices
```

The command probe is enabled by default and displays a short alert on each device. Set `ROOMOS_PARITY_INCLUDE_COMMAND=false` to skip it. `ROOMOS_PARITY_INCLUDE_CONFIG_SET=false` is the default because that probe writes the current `SystemUnit Name` value back to the device. Set `ROOMOS_PARITY_UPDATE_README=false` when you want to run parity locally without changing the generated hardware validation table.

### Update the bundled RoomOS schema

The package uses the same schema resources as `roomos.cisco.com`. The generated schema files are ignored by git, but local scripts that need them run `schema:ensure` first and fetch them when missing. Published packages still include the pruned schema catalog in `dist`, so consumers do not need network access at runtime.

To create the local schema cache only when it is missing, run:

```sh
npm run schema:ensure
```

To force-refresh the local schema cache from the upstream index, run:

```sh
npm run schema:update
```

By default this selects the newest schema for each major RoomOS release line from `schemas.json`, such as the latest 9.x, 10.x, 11.x, and 26.x schemas. At runtime, `jest-mock-xapi` uses `Status.SystemUnit.ProductPlatform` to pick the newest bundled major schema that supports that product. To pin a single upstream schema for debugging, set `ROOMOS_SCHEMA_NAME`, for example:

```sh
ROOMOS_SCHEMA_NAME="26.5.1 April 2026" npm run schema:update
```

Publishing runs `schema:update` before building so the published package includes the current pruned schema catalog.

### Local development commands

- `npm test` ensures the schema cache exists and runs the Jest suite.
- `npm run build` ensures the schema cache exists, compiles TypeScript, and copies schemas into `dist`.
- `npm run schema:ensure` fetches schemas only when the local ignored cache is missing.
- `npm run schema:update` refreshes the local ignored schema cache from the upstream RoomOS schema index.
- `npm run parity:devices` builds the package, runs the live-device parity probe, and updates the README validation table when enabled.

## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.

## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex use cases, but are not official Cisco Webex branded demos.

## Questions

Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=jest-mock-xapi) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (`globalexpert@webex.bot`). In the `Engagement Type` field, choose `API/SDK Proof of Concept Integration Development` to make sure you reach our team.
