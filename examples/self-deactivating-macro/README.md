# Self-Deactivating Macro Example

This example shows how a RoomOS macro can use the native `_main_module_name()` runtime global to discover the name it was saved with, then use that name to deactivate itself.

The example is intentionally standalone and does not import anything from this repository's `src/` folder. It is designed to validate the published `jest-mock-xapi` package once the `_main_module_name()` support is released.

## Files

- [self-deactivating-macro.js](./self-deactivating-macro.js) is the production macro
- [self-deactivating-macro.test.js](./self-deactivating-macro.test.js) is the Jest test
- [package.json](./package.json) maps `xapi` to the published `jest-mock-xapi` package during tests

## Install

Create a new folder for your macro project, copy these files into it, then run:

```sh
npm install
```

This example expects `jest-mock-xapi@1.0.3` or later to be available from npm as a normal dev dependency.

## Run Tests

Run your tests once with:

```sh
npm test
```

Run your tests continuously upon macro/test code changes with:

```sh
npm run test:watch
```

## How It Works

The production macro keeps the same `xapi` import it would use on a RoomOS device:

```js
import xapi from "xapi";
```

It then reads the macro runtime name and passes it to the xCommand that deactivates a saved macro:

```js
const macroName = _main_module_name();

xapi.Command.Macros.Macro.Deactivate({ Name: macroName });
```

When Jest imports `self-deactivating-macro.js`, the published `jest-mock-xapi` package installs a mock `_main_module_name()` global. The test asserts that the macro called:

```js
xapi.Command.Macros.Macro.Deactivate({
  Name: "self-deactivating-macro",
});
```

That proves the mock global resolved the calling macro file and removed the `.js` extension, matching the RoomOS behavior this macro depends on.

## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.

## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex usecases, but are not Official Cisco Webex Branded demos.

## Questions

Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=self-deactivating-macro-example) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (globalexpert@webex.bot). In the "Engagement Type" field, choose the "API/SDK Proof of Concept Integration Development" option to make sure you reach our team.
