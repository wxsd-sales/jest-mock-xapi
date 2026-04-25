# Monitor Role Changer Example

This example shows how a RoomOS macro can adapt to product-specific xAPI availability without using `xapi.docs()`.

The macro queries the current product platform, reads the available video output connector configuration branch, counts the outputs that expose `MonitorRole`, and builds a UI Extensions panel from that discovered shape.

The example is intentionally standalone and does not import anything from this repository's `src/` folder. It is designed to validate the published `jest-mock-xapi` package once product-specific xAPI availability support is released.

## Files

- [monitor-role-changer.js](./monitor-role-changer.js) is the production macro
- [monitor-role-changer.test.js](./monitor-role-changer.test.js) is the Jest test
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

The test suite sets `Status.SystemUnit.ProductPlatform` before importing the macro:

```js
xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

await import("./monitor-role-changer.js");
```

The macro then uses normal RoomOS xAPI calls to discover what it can safely expose:

```js
const productName = await xapi.Status.SystemUnit.ProductPlatform.get();
const outputs = await xapi.Config.Video.Output.Connector.get();
```

It filters those output connector objects down to the ones that include `MonitorRole`. For example:

- `Desk` has no output connector `MonitorRole`, so the macro does not save a panel.
- `Desk Pro` has two monitor-role outputs, so the panel contains rows for Output 1 and Output 2.
- `Codec Pro` has three monitor-role outputs, so the panel contains rows for Output 1, Output 2, and Output 3.

Each row contains a group button widget. The widget id encodes the output connector id, so a widget action event can update the corresponding config path:

```js
xapi.Config.Video.Output.Connector[connectorId].MonitorRole.set(value);
```

## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.

## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex usecases, but are not Official Cisco Webex Branded demos.

## Questions

Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=monitor-role-changer-example) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (globalexpert@webex.bot). In the "Engagement Type" field, choose the "API/SDK Proof of Concept Integration Development" option to make sure you reach our team.
