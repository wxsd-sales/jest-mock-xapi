import { beforeEach, describe, expect, it, jest } from "@jest/globals";

describe("speed-dial-macro", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("saves the speed dial panel when the macro loads", async () => {
    const { default: xapi } = await import("xapi");
    jest.clearAllMocks();
    xapi.removeAllListeners();
    await import("./speed-dial-macro.js");

    expect(xapi.Command.UserInterface.Extensions.Panel.Save).toHaveBeenCalledTimes(1);
    expect(xapi.Command.UserInterface.Extensions.Panel.Save).toHaveBeenCalledWith(
      { PanelId: "speed-dial-panel" },
      expect.stringContaining("<Name>Button</Name>"),
    );
  });

  it("dials the configured number when the matching panel is clicked", async () => {
    const { default: xapi } = await import("xapi");
    jest.clearAllMocks();
    xapi.removeAllListeners();
    await import("./speed-dial-macro.js");

    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
      PanelId: "speed-dial-panel",
    });

    expect(xapi.Command.Dial).toHaveBeenCalledTimes(1);
    expect(xapi.Command.Dial).toHaveBeenCalledWith({ Number: "number@example.com" });
  });

  it("ignores unrelated panel click events", async () => {
    const { default: xapi } = await import("xapi");
    jest.clearAllMocks();
    xapi.removeAllListeners();
    await import("./speed-dial-macro.js");

    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit({
      PanelId: "different-panel",
    });

    expect(xapi.Command.Dial).not.toHaveBeenCalled();
  });
});
