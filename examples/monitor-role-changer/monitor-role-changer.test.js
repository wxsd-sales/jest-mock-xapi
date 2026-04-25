import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

async function loadMacroForProduct(productName) {
  const { default: xapi } = await import("xapi");

  jest.clearAllMocks();
  xapi.removeAllListeners();
  xapi.Status.SystemUnit.ProductPlatform.set(productName);

  await import("./monitor-role-changer.js");

  return xapi;
}

function getSavedPanel(xapi) {
  return xapi.Command.UserInterface.Extensions.Panel.Save.mock.calls[0]?.[1] ?? "";
}

describe("monitor-role-changer", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not save a panel on Desk because no outputs expose MonitorRole", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const xapi = await loadMacroForProduct("Desk");

    expect(
      xapi.Command.UserInterface.Extensions.Panel.Save,
    ).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "No available output connector with monitor role",
    );
  });

  it("builds a two-output monitor role panel for Desk Pro", async () => {
    const xapi = await loadMacroForProduct("Desk Pro");
    const panel = getSavedPanel(xapi);

    expect(
      xapi.Command.UserInterface.Extensions.Panel.Save,
    ).toHaveBeenCalledWith(
      { PanelId: "monitor-role-changer-panel" },
      expect.any(String),
    );
    expect(panel).toContain("<Name>Output 1</Name>");
    expect(panel).toContain("<Name>Output 2</Name>");
    expect(panel).not.toContain("<Name>Output 3</Name>");
    expect(panel).toContain("<Key>Auto</Key>");
    expect(panel).toContain("<Key>First</Key>");
    expect(panel).toContain("<Key>Second</Key>");
    expect(panel).not.toContain("<Key>Third</Key>");
    expect(panel).not.toContain("<Key>PresentationOnly</Key>");
  });

  it("builds a three-output monitor role panel for Codec Pro", async () => {
    const xapi = await loadMacroForProduct("Codec Pro");
    const panel = getSavedPanel(xapi);

    expect(panel).toContain("<Name>Output 1</Name>");
    expect(panel).toContain("<Name>Output 2</Name>");
    expect(panel).toContain("<Name>Output 3</Name>");
    expect(panel).toContain("<Key>Auto</Key>");
    expect(panel).toContain("<Key>First</Key>");
    expect(panel).toContain("<Key>Second</Key>");
    expect(panel).toContain("<Key>Third</Key>");
    expect(panel).toContain("<Key>PresentationOnly</Key>");
  });

  it("changes the selected output monitor role from a group button event", async () => {
    const xapi = await loadMacroForProduct("Desk Pro");

    xapi.Event.UserInterface.Extensions.Widget.Action.emit({
      WidgetId: "monitor_role_output_2",
      Value: "Second",
    });

    expect(
      xapi.Config.Video.Output.Connector[2].MonitorRole.set,
    ).toHaveBeenCalledWith("Second");
  });
});
