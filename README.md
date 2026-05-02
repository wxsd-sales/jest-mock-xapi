# Jest Mock xAPI

Run Cisco RoomOS JavaScript macro tests in Node.js while preserving the normal `import xapi from "xapi"` developer experience.

This project provides a Jest-compatible mock of the RoomOS `xapi` module so JavaScript macros for Cisco RoomOS devices can be tested locally in a standard Node environment. It exists so macro developers can validate behavior without deploying to a device for every change or changing production macro imports.


## Overview

The package exposes a mocked default `xapi` export that mirrors the RoomOS macro runtime. It supports both the classic uppercase proxy APIs (`xapi.Command`, `xapi.Status`, `xapi.Config`, `xapi.Event`) and the lowercase APIs commonly used by macros (`xapi.command`, `xapi.doc`, `xapi.status`, `xapi.config`, `xapi.event`).

The mock is backed by generated RoomOS schemas, so known paths, product-specific availability, default configuration values, command parameters, and `xapi.doc(...)` results behave much closer to a real device. Test helpers let you seed status/config values, override command/doc responses, emit status/config/event updates, inspect call history, and create independent xAPI instances for isolated macro tests.


## Setup

### Prerequisites

- Node.js 20 or later is recommended for local development and testing.
- A Jest-based test setup is expected in the macro project that consumes this package.
- The macro under test should import `xapi` exactly as it would on a Cisco RoomOS device: `import xapi from "xapi";`.

### Installation
1.  Install `jest-mock-xapi` and Jest in your macro project.
    ```sh
    npm install --save-dev jest jest-mock-xapi
    ```
2.  Choose one Jest integration option.

    Option 1 (recommended): Map `xapi` directly to `jest-mock-xapi` with `moduleNameMapper`.
    ```json
    {
      "jest": {
        "moduleNameMapper": {
          "^xapi$": "jest-mock-xapi"
        }
      }
    }
    ```

    Option 2: Register the virtual `xapi` module through the package's setup entrypoint if you prefer a setup-file workflow.
    ```json
    {
      "jest": {
        "setupFiles": ["jest-mock-xapi/register"]
      }
    }
    ```
3.  Add Jest test scripts to your macro project's `package.json`.
    ```json
    {
      "scripts": {
        "test": "NODE_OPTIONS=--experimental-vm-modules jest --runInBand",
        "test:watch": "NODE_OPTIONS=--experimental-vm-modules jest --watchAll --runInBand"
      }
    }
    ```
4.  Write tests that import your macro, set xAPI values or emit xAPI changes, and then assert the macro responded correctly.
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
5.  Run the tests from your macro project.

    Run your tests once with:
    ```sh
    npm test
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

- `xapi.version`, defaulting to `"6.0.0"`
- `xapi.command(path, params?, body?)`
- `xapi.doc(path)`
- `xapi.close()`
- `xapi.status.get(path)`, `xapi.status.on(path, listener)`, `xapi.status.once(path, listener)`
- `xapi.config.get(path)`, `xapi.config.set(path, value)`, `xapi.config.on(path, listener)`, `xapi.config.once(path, listener)`
- `xapi.event.on(path, listener)`, `xapi.event.once(path, listener)`
- `xapi.Command.*`, `xapi.Status.*`, `xapi.Config.*`, and `xapi.Event.*` proxy paths

Promise-returning APIs resolve or reject like the macro runtime. Subscriptions return an unsubscribe function, and `once(...)` listeners automatically unsubscribe after the first matching update.

### Reset state between tests

Most test suites should reset values, mocks, listeners, handlers, and call history before each test so one scenario does not leak into the next.

```js
import { beforeEach, jest } from "@jest/globals";

beforeEach(async () => {
  jest.resetModules();
  const { default: xapi } = await import("xapi");
  xapi.reset();
});
```

Use `createXapi()` when a test needs its own independent mock instance. Instances do not share listeners, values, handlers, or call history.

```js
import { createXapi } from "jest-mock-xapi";

const first = createXapi();
const second = createXapi();
```

### Use RoomOS-style lowercase APIs

The mock also supports the commonly used lowercase macro APIs. String paths can use spaces or slashes, and these calls return promises like the RoomOS runtime.

```js
import { expect, it } from "@jest/globals";

it("uses lowercase xapi helpers", async () => {
  const { default: xapi } = await import("xapi");

  xapi.setCommandResult("Dial", { status: "dialed" });
  xapi.setStatus("Audio/Volume", 30);

  await expect(
    xapi.command("Dial", { Number: "number@example.com" }),
  ).resolves.toEqual({ status: "dialed" });
  await expect(xapi.status.get("Audio Volume")).resolves.toBe(30);
});
```

Paths are normalized before lookup and call tracking. Strings can use spaces, slashes, dots, or a mix of those separators; arrays are also accepted. Empty path segments are removed, string segments are capitalized, and numeric strings are converted to numbers.

```js
await xapi.status.get("Audio Volume"); // ["Audio", "Volume"]
await xapi.status.get("Audio/Volume"); // ["Audio", "Volume"]
await xapi.status.get(["Call", "1", "Status"]); // ["Call", 1, "Status"]
```

### Read schema docs

`xapi.doc(...)` returns schema-derived documentation for rooted status, config, command, and event paths. You can use either `Config` or `Configuration` for configuration docs.

```js
import { expect, it } from "@jest/globals";

it("reads xapi docs", async () => {
  const { default: xapi } = await import("xapi");

  await expect(xapi.doc("Status/Audio/Volume")).resolves.toEqual(
    expect.objectContaining({
      ValueSpace: expect.objectContaining({
        type: "Integer",
      }),
    }),
  );

  await expect(xapi.doc("Config/SystemUnit/Name")).resolves.toEqual(
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
});
```

By default, valid commands resolve with `{ status: "OK" }`. Invalid command paths reject with the same code/message shape used by RoomOS, and schema-backed commands validate required parameters and value ranges. Use `setCommandResult()` or `setCommandHandler()` when a test needs a specific response.

### Mock utilities and call history

Use the mock utilities to prepare state, emit updates, override responses, and inspect how the macro used xAPI.

```js
import { expect, it } from "@jest/globals";

it("tracks calls with normalized paths", async () => {
  const { default: xapi } = await import("xapi");

  xapi.setStatus("Audio/Volume", 20);
  xapi.setConfig("Audio/DefaultVolume", 50);
  xapi.setDocResult("Status/Audio/Volume", { description: "volume" });
  xapi.setCommandHandler("Dial", (params) => ({
    dialed: params.Number,
  }));

  await xapi.command("Dial", { Number: "number@example.com" });
  await xapi.status.get("Audio Volume");

  expect(xapi.getCallHistory().command[0]).toEqual(
    expect.objectContaining({
      normalizedPath: ["Dial"],
      originalPath: "Dial",
      params: { Number: "number@example.com" },
    }),
  );
});
```

Available helpers:

- `setStatus(path, value)` and `setConfig(path, value)` seed values without notifying listeners.
- `emitStatus(path, value)`, `emitConfig(path, value)`, and `emitEvent(path, payload)` update state and notify listeners.
- `removeStatus(path)` removes a status branch and emits the RoomOS-style ghost payload for indexed branches.
- `setDocResult(path, result)`, `setCommandResult(path, result)`, and `setCommandHandler(path, handler)` override default schema-backed behavior.
- `getCallHistory()` or `callHistory` returns recorded calls for `command`, `doc`, `status.get`, `status.on`, `config.get`, `config.set`, `config.on`, and `event.on`.
- `clearCallHistory()` clears recorded calls and Jest mock call counts.
- `reset()`, `resetAll()`, and `resetMock()` clear values, handlers, listeners, call history, and Jest mock call counts.

### Use RoomOS runtime globals

The mock installs the RoomOS `_main_module_name()` global when `jest-mock-xapi` is loaded. It returns the name of the calling macro file without the source extension, matching the RoomOS behavior used by self-managing macros.

```js
import xapi from "xapi";

const macroName = _main_module_name();

xapi.Command.Macros.Macro.Deactivate({ Name: macroName });
```

For example, calling `_main_module_name()` from `self-deactivating-macro.js` returns `"self-deactivating-macro"`.

### Seed leaf status and config values

Use `setStatus()` and `setConfig()` to prepare mock device state before importing a macro or invoking a handler.

```js
import { expect, it } from "@jest/globals";

it("reads the prepared default volume", async () => {
  const { default: xapi } = await import("xapi");

  xapi.setConfig("Audio/DefaultVolume", 100);
  xapi.setStatus("Audio/Volume", 20);

  await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(100);
  await expect(xapi.Status.Audio.Volume.get()).resolves.toBe(20);
});
```

### Select a RoomOS product

The mock defaults `Status.SystemUnit.ProductPlatform` to `"Desk Pro"` and applies Desk Pro product-specific xAPI availability even when a test has not explicitly set a product. Set `Status.SystemUnit.ProductPlatform` to another public product name when a test should model a different device.

Once a known product is selected, the mock uses the newest bundled RoomOS major-release schema that supports that product. It rejects xAPI paths that are not available on that product and validates product-specific configuration values.

```js
import { expect, it } from "@jest/globals";

it("handles Desk Pro xAPI differences", async () => {
  const { default: xapi } = await import("xapi");

  await xapi.Config.Video.Output.Connector[1].MonitorRole.set("Auto");

  await expect(
    xapi.Config.Video.Output.Connector[3].MonitorRole.set("Auto"),
  ).rejects.toEqual({
    code: 3,
    message: "No match on address expression",
  });

  await expect(
    xapi.Config.Video.Output.Connector[1].MonitorRole.set("PresentationOnly"),
  ).rejects.toEqual({
    code: 4,
    message: "Invalid or missing parameters",
  });
});
```

The selected schema also provides default software statuses. For example, a schema named `26.5.1 April 2026` produces these default values unless the test overrides them with `setStatus(...)`:

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
  await xapi.Config.Video.Output.Connector[2].MonitorRole.set("Second");

  await expect(xapi.Config.get()).resolves.toHaveProperty("Audio");
  await expect(xapi.Config.Video.Output.Connector[1].get()).resolves.toEqual(
    expect.objectContaining({
      id: "1",
      MonitorRole: "First",
    }),
  );
  await expect(xapi.Config.Video.Output.Connector.get()).resolves.toEqual([
    expect.objectContaining({ id: "1", MonitorRole: "First" }),
    expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  ]);
  await expect(xapi.Config.Video.Output.Connector["*"].get()).resolves.toEqual([
    expect.objectContaining({ id: "1", MonitorRole: "First" }),
    expect.objectContaining({ id: "2", MonitorRole: "Second" }),
  ]);
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

  expect(xapi.Command.Dial).toHaveBeenCalledWith({
    Number: "number@example.com",
  });
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
  xapi.Status.Audio.Volume.set(55);

  expect(handler).toHaveBeenCalledWith(55);
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
  xapi.Config.on(configHandler);
  xapi.Event.on(eventHandler);

  xapi.Status.Audio.Volume.set(55);
  await xapi.Config.Audio.DefaultVolume.set(100);
  xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
    PanelId: "speed-dial-panel",
  });

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
  xapi.Status.Call[42].Direction.set("Outgoing");
  xapi.Status.Call[42].Status.set("Connected");

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

Use `removeStatus()` to simulate an indexed status branch disappearing, such as a call ending.

```js
import { expect, it, jest } from "@jest/globals";

it("emits a ghost payload when a call ends", async () => {
  const { default: xapi } = await import("xapi");
  const handler = jest.fn();

  xapi.Status.Call.on(handler);
  xapi.Status.Call[7].Direction.set("Incoming");

  xapi.removeStatus("Call.7");

  expect(handler).toHaveBeenLastCalledWith({
    ghost: "true",
    id: "7",
  });
});
```

## Demo

For complete examples, see the [speed-dial-macro demo](./examples/speed-dial-macro/README.md), the [self-deactivating-macro demo](./examples/self-deactivating-macro/README.md), the [monitor-role-changer demo](./examples/monitor-role-changer/README.md), and the [xAPI runtime parity probe](./examples/xapi-runtime-parity/README.md).

### Manual RoomOS hardware parity check

This repository also includes a local-only hardware parity script that connects to real RoomOS devices with `jsxapi`, runs the same representative xAPI calls against each device and a fresh `jest-mock-xapi` instance, then compares the response formats. The probe includes `xapi.doc(...)` status, config, command, and event paths, including slash, space, and array path forms. It also checks invalid path errors, invalid command argument errors, and successful command responses. It is not part of `npm test` or `prepublishOnly`.

Validated hardware is generated by `npm run parity:devices` after all live-device checks pass.

<!-- roomos-parity-results:start -->
| Hardware | RoomOS major | Software | Result | Last validated |
| --- | --- | --- | --- | --- |
| Board 70 | RoomOS 11 | RoomOS 11.38.1.1 62a3419e307 | 29/29 passed | 2026-05-02 |
| Codec Pro | RoomOS 26 | RoomOS 26.7.0.14 9848d9b7817 | 29/29 passed | 2026-05-02 |
| Desk Pro | RoomOS 26 | RoomOS 26.5.1.3 c49cadf5f59 | 29/29 passed | 2026-05-02 |
| Room Bar Pro | RoomOS 26 | RoomOS 26.5.1.3 c49cadf5f59 | 29/29 passed | 2026-05-02 |
<!-- roomos-parity-results:end -->

Create a local `.env` from `.env.example`:

```sh
cp .env.example .env
```

Add the shared credentials and an address array:

```dotenv
ROOMOS_PARITY_USERNAME=admin
ROOMOS_PARITY_PASSWORD=password
ROOMOS_PARITY_ADDRESSES='["192.0.2.10","192.0.2.11"]'
ROOMOS_PARITY_UPDATE_README=true
```

The script tries `ssh://` for each address first, then retries with `wss://`
if SSH fails. Test output uses the detected `SystemUnit/ProductPlatform` value
for each connected device rather than a configured device name. The legacy
`ROOMOS_PARITY_DEVICES='[...]'` JSON array and `ROOMOS_PARITY_DEVICE_1_*`
numbered blocks are still supported for existing local files.

Run the manual check with:

```sh
npm run parity:devices
```

The command probe is enabled by default and displays a short alert on each device. Set `ROOMOS_PARITY_INCLUDE_COMMAND=false` to skip it. `ROOMOS_PARITY_INCLUDE_CONFIG_SET=false` is the default because that probe writes the current `SystemUnit/Name` value back to the device. Set `ROOMOS_PARITY_UPDATE_README=false` when you want to run parity locally without changing the generated hardware validation table.

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

## Questions

Please open a GitHub issue for bugs, feature requests, or RoomOS parity gaps.
