# Speed Dial Macro Example

This example shows the normal workflow for a RoomOS macro author:

- write the macro in plain JavaScript
- keep the production import as `import xapi from "xapi"`
- install `jest-mock-xapi` as a development dependency for tests using the recommended `moduleNameMapper` setup

The example is intentionally standalone and does not import anything from this repository's `src/` folder.

## Files

- [speed-dial-macro.js](./speed-dial-macro.js) is the production macro
- [speed-dial-macro.test.js](./speed-dial-macro.test.js) is the Jest test
- [package.json](./package.json) maps `xapi` to the published `jest-mock-xapi` package during tests

## Install

Create a new folder for your macro project, copy these files into it, then run:

```sh
npm install
```

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

This example follows option 1 from the main package README.

In the test environment, Jest remaps the macro's normal import:

```js
import xapi from "xapi";
```

to the published `jest-mock-xapi` package using `moduleNameMapper`.

That means the test imports `xapi` exactly the same way as the production macro:

```js
const { default: xapi } = await import("xapi");
```

The macro code stays close to real RoomOS macro code, while tests can still assert things like:

- `xapi.Command.UserInterface.Extensions.Panel.Save(...)`
- `xapi.Command.Dial(...)`
- `xapi.Event.UserInterface.Extensions.Panel.Clicked.emit(...)`



## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.


## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex usecases, but are not Official Cisco Webex Branded demos.


## Questions
Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=speed-dial-macro-example) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (globalexpert@webex.bot). In the "Engagement Type" field, choose the "API/SDK Proof of Concept Integration Development" option to make sure you reach our team. 
