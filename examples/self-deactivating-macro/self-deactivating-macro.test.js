import { beforeEach, describe, expect, it, jest } from "@jest/globals";

describe("self-deactivating-macro", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("deactivates itself using the macro filename as the RoomOS module name", async () => {
    const { default: xapi } = await import("xapi");
    jest.clearAllMocks();
    xapi.removeAllListeners();

    await import("./self-deactivating-macro.js");

    expect(xapi.Command.Macros.Macro.Deactivate).toHaveBeenCalledTimes(1);
    expect(xapi.Command.Macros.Macro.Deactivate).toHaveBeenCalledWith({
      Name: "self-deactivating-macro",
    });
  });
});
