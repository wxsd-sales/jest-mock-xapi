import { beforeEach, describe, expect, it, jest } from "@jest/globals";

async function loadMacro() {
  const { default: xapi } = await import("xapi");
  xapi.reset();

  const macro = await import("./httpClient-macro.js");
  await macro.ready;

  return { macro, xapi };
}

async function flushRequestStart() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("httpClient-macro", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("enables HttpClient and saves the panel when the macro loads", async () => {
    const { xapi } = await loadMacro();

    expect(xapi.Config.HttpClient.Mode.set).toHaveBeenCalledWith("On");
    expect(xapi.Config.HttpClient.AllowHTTP.set).toHaveBeenCalledWith("False");
    expect(
      xapi.Command.UserInterface.Extensions.Panel.Save,
    ).toHaveBeenCalledWith(
      { PanelId: "http-client-panel" },
      expect.stringContaining("<Name>HTTP Client</Name>"),
    );
  });

  it("uses setHttpClientResponse for successful panel-triggered HTTP calls", async () => {
    const { default: xapi } = await import("xapi");
    xapi.reset();
    xapi.setHttpClientResponse("Get", {
      body: "service healthy",
      headers: { "content-type": "text/plain" },
      statusCode: 200,
    });

    const macro = await import("./httpClient-macro.js");
    await macro.ready;

    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
      PanelId: "http-client-panel",
    });
    await macro.waitForHttpQueue();

    expect(xapi.Command.HttpClient.Get).toHaveBeenCalledWith({
      ResultBody: "PlainText",
      Url: "https://example.test/status",
    });
    expect(xapi.Command.UserInterface.Message.Alert.Display).toHaveBeenCalledWith({
      Text: "HTTP 200: service healthy",
      Title: "HTTP Client",
    });
  });

  it("queues rapid panel clicks one at a time to avoid the HttpClient connection limit", async () => {
    const { default: xapi } = await import("xapi");
    xapi.reset();
    xapi.setHttpClientResponse("Get", {
      body: "queued ok",
      delayMs: 25,
      statusCode: 200,
    });

    const macro = await import("./httpClient-macro.js");
    await macro.ready;

    for (let click = 0; click < 6; click += 1) {
      xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
        PanelId: "http-client-panel",
      });
    }

    await flushRequestStart();
    expect(xapi.Command.HttpClient.Get).toHaveBeenCalledTimes(1);

    await macro.waitForHttpQueue();

    expect(xapi.Command.HttpClient.Get).toHaveBeenCalledTimes(6);
    expect(
      xapi.Command.UserInterface.Message.Alert.Display,
    ).toHaveBeenCalledTimes(6);
    expect(
      xapi.Command.UserInterface.Message.Alert.Display,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        Text: expect.stringContaining("No available http connections"),
      }),
    );
  });

  it("surfaces non-2xx helper responses as RoomOS-style HttpClient errors", async () => {
    const { default: xapi } = await import("xapi");
    xapi.reset();
    xapi.setHttpClientResponse("Get", {
      body: "temporarily unavailable",
      statusCode: 503,
    });

    const macro = await import("./httpClient-macro.js");
    await macro.ready;

    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
      PanelId: "http-client-panel",
    });
    await macro.waitForHttpQueue();

    expect(xapi.Command.UserInterface.Message.Alert.Display).toHaveBeenCalledWith({
      Text: "Command returned an error. (503)",
      Title: "HTTP Error",
    });
  });

  it("ignores unrelated panel click events", async () => {
    const { macro, xapi } = await loadMacro();

    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
      PanelId: "different-panel",
    });
    await macro.waitForHttpQueue();

    expect(xapi.Command.HttpClient.Get).not.toHaveBeenCalled();
  });
});
