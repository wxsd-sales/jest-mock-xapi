# HTTP Client Macro Example

This example shows how a RoomOS macro can call `xapi.Command.HttpClient.Get(...)` from a UI Extensions panel while keeping requests one at a time.

It also demonstrates the `jest-mock-xapi` HttpClient helpers in tests:

- `xapi.Config.HttpClient.Mode.set("On")` mirrors the real RoomOS requirement that HttpClient must be enabled before use
- `xapi.setHttpClientResponse(...)` provides RoomOS-shaped success and error responses
- delayed mock responses can catch macros that accidentally fire too many concurrent requests

The example is intentionally standalone and does not import anything from this repository's `src/` folder.

## Files

- [httpClient-macro.js](./httpClient-macro.js) is the production macro
- [httpClient-macro.test.js](./httpClient-macro.test.js) is the Jest test
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

The macro saves a small panel named `HTTP Client`. When that panel is clicked, it queues a GET request:

```js
xapi.Command.HttpClient.Get({
  ResultBody: "PlainText",
  Url: "https://example.test/status",
});
```

The queue is deliberately simple:

```js
requestQueue = requestQueue
  .catch(() => undefined)
  .then(() => runStatusRequest());
```

That means rapid panel clicks run sequentially instead of creating several simultaneous HTTP requests. On real RoomOS devices, more than three simultaneous HttpClient requests can fail with `No available http connections`.

In the test environment, Jest remaps the macro's normal import:

```js
import xapi from "xapi";
```

to `jest-mock-xapi` using `moduleNameMapper`. The test can then control responses without changing the production macro:

```js
xapi.setHttpClientResponse("Get", {
  body: "service healthy",
  delayMs: 25,
  statusCode: 200,
});
```

The tests emit panel clicks with:

```js
xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
  PanelId: "http-client-panel",
});
```

and then assert the macro called `xapi.Command.HttpClient.Get(...)` and displayed the expected success or error alert.

## License

All contents are licensed under the MIT license. Please see [license](LICENSE) for details.

## Disclaimer

Everything included is for demo and Proof of Concept purposes only. Use of the site is solely at your own risk. This site may contain links to third party content, which we do not warrant, endorse, or assume liability for. These demos are for Cisco Webex usecases, but are not Official Cisco Webex Branded demos.

## Questions

Please contact the WXSD team at [wxsd@external.cisco.com](mailto:wxsd@external.cisco.com?subject=httpclient-macro-example) for questions. Or, if you're a Cisco internal employee, reach out to us on the Webex App via our bot (globalexpert@webex.bot). In the "Engagement Type" field, choose the "API/SDK Proof of Concept Integration Development" option to make sure you reach our team.
