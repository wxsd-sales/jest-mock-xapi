# Jest Mock xAPI

Run Cisco RoomOS JavaScript macro tests in Node.js while preserving the normal `import xapi from "xapi"` developer experience.

This project provides a Jest-compatible mock of the RoomOS `xapi` module so JavaScript macros for Cisco RoomOS devices can be tested locally in a standard Node environment. It exists so macro developers can validate macro behavior without having to deploy to a device for every change or lose the familiar RoomOS import pattern in their source files. It is intended for developers building and maintaining Cisco RoomOS macros who want repeatable automated tests around xAPI commands, status reads, configuration changes, and emitted events.


## Overview

The package exposes a mocked `xapi` module that mirrors the top-level `Command`, `Status`, `Config`, and `Event` areas that RoomOS macro developers already use. Internally, it uses a schema-backed proxy so only valid xAPI paths are available, and each path resolves to a Jest mock function that can be inspected with normal Jest matchers. Commands resolve as promises so command handlers look like the real RoomOS async API, while status, configuration, and event paths support setting values, subscribing to changes, and emitting updates from tests. In practice, a macro test imports the macro, uses the mock xAPI to seed state or emit events, and then asserts that the macro called the expected xAPI command or updated the expected path in response.


## Setup

### Prerequisites & Dependencies: 

- Node.js 20 or later is recommended for local development and testing.
- A Jest-based test setup is expected in the macro project that consumes this package.
- The macro under test should import `xapi` exactly as it would on a Cisco RoomOS device: `import xapi from "xapi";`.
- This package is intended for local macro testing and assumes the macro developer is comfortable writing JavaScript or TypeScript unit tests with Jest.


<!-- GETTING STARTED -->

### Installation Steps:
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
4.  With option 1 in place, write tests that import your macro, set xAPI values or emit xAPI changes, and then assert the macro responded correctly.
    ```js
    import { beforeEach, describe, expect, it, jest } from "@jest/globals";

    describe("my roomos macro", () => {
      beforeEach(() => {
        jest.resetModules();
      });

      it("dials when a panel event is triggered", async () => {
        const { default: xapi } = await import("xapi");
        jest.clearAllMocks();
        xapi.removeAllListeners();

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

The package now has a split API:

- `jest-mock-xapi` exports the mock object itself and is the recommended target for `moduleNameMapper`.
- `jest-mock-xapi/register` registers a virtual `xapi` module for Jest setup-file workflows.
    
## Demo

The expected development flow is that a macro developer installs `jest-mock-xapi`, keeps their production macro code written for the native RoomOS runtime, and uses Jest to control the mock device state from tests. Tests can call `xapi.Status...set(...)` or `xapi.Config...set(...)` to simulate device state changes, use `xapi.Event...emit(...)` to trigger the same events a RoomOS device would emit, and then validate that the macro reacted by calling the required command path such as `xapi.Command.UserInterface.Extensions.Panel.Save(...)` or `xapi.Command.Dial(...)`.

For read-based behavior, tests can seed values before importing the macro or before invoking the macro logic, then assert that the macro issued the correct follow-up action. For change-driven behavior, tests should register the macro, emit a status, config, or event update through the mock xAPI object, and verify the macro made the required response with normal Jest assertions like `toHaveBeenCalledWith(...)`, `toHaveBeenCalledTimes(...)`, or `not.toHaveBeenCalled()`.

For a complete working example, see the [speed-dial-macro demo](./examples/speed-dial-macro/README.md).

*For more demos & PoCs like this, check out our [Webex Labs site](https://collabtoolbox.cisco.com/webex-labs).



## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.


## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex usecases, but are not Official Cisco Webex Branded demos.


## Questions
Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=jest-mock-xapi) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (globalexpert@webex.bot). In the "Engagement Type" field, choose the "API/SDK Proof of Concept Integration Development" option to make sure you reach our team. 
