import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createSchemaSoftwareStatusEntries } from "../defaults.ts";
import { getProductCodes, loadSchemaModel } from "../utils/index.ts";
import xapi, { createXapi } from "../xapi.ts";

const schemaCatalog = loadSchemaModel();

function getExpectedSoftwareStatuses(productPlatform: string) {
  const schemaModel = schemaCatalog.getModelForProductCodes(
    getProductCodes(productPlatform),
  );

  return Object.fromEntries(
    createSchemaSoftwareStatusEntries(schemaModel.name),
  ) as Record<string, string>;
}

beforeEach(() => {
  xapi.reset();
});

describe("xAPI Testing", () => {
  it("defines the top-level schema-backed domains", () => {
    expect(xapi.Command).toBeDefined();
    expect(xapi.Config).toBeDefined();
    expect(xapi.Status).toBeDefined();
    expect(xapi.Event).toBeDefined();
  });

  it("defines the RoomOS macro-facing top-level API", () => {
    expect(xapi.version).toBe("6.0.0");
    expect(xapi.command).toBeDefined();
    expect(xapi.doc).toBeDefined();
    expect(xapi.close).toBeDefined();
    expect(xapi.status.get).toBeDefined();
    expect(xapi.config.set).toBeDefined();
    expect(xapi.event.on).toBeDefined();
  });
});

describe("Lowercase RoomOS APIs", () => {
  it("normalizes string and array paths for promise-returning status getters", async () => {
    xapi.setStatus(["Call", "1", "Status"], "Connected");

    await expect(xapi.status.get("Audio Volume")).resolves.toBe("0");
    await expect(xapi.status.get(["Call", "1", "Status"])).resolves.toBe("Connected");

    expect(xapi.callHistory.status.get[0]).toEqual(
      expect.objectContaining({
        normalizedPath: ["Audio", "Volume"],
        originalPath: "Audio Volume",
        path: ["Audio", "Volume"],
      }),
    );
    expect(xapi.callHistory.status.get[1]).toEqual(
      expect.objectContaining({
        normalizedPath: ["Call", 1, "Status"],
        originalPath: ["Call", "1", "Status"],
      }),
    );
  });

  it("supports mock command handlers, command results, and doc results by path", async () => {
    const handler = jest.fn(
      (_params?: unknown, _body?: unknown, _call?: unknown) => ({
        status: "handled",
      }),
    );

    xapi.setCommandHandler("Dial", handler);
    xapi.setCommandResult("UserInterface/Message/Alert/Display", { status: "displayed" });
    xapi.setDocResult("Audio/Volume", { description: "Current volume" });

    await expect(xapi.command("Dial", { Number: "1234" })).resolves.toEqual({
      status: "handled",
    });
    await expect(
      xapi.command("UserInterface Message Alert Display"),
    ).resolves.toEqual({ status: "displayed" });
    await expect(xapi.doc("Audio Volume")).resolves.toEqual({
      description: "Current volume",
    });
    expect(handler).toHaveBeenCalledWith(
      { Number: "1234" },
      undefined,
      expect.objectContaining({
        normalizedPath: ["Dial"],
      }),
    );
    expect(xapi.callHistory.command).toEqual([
      expect.objectContaining({
        normalizedPath: ["Dial"],
        params: { Number: "1234" },
      }),
      expect.objectContaining({
        normalizedPath: ["UserInterface", "Message", "Alert", "Display"],
      }),
    ]);
    expect(xapi.callHistory.doc[0]).toEqual(
      expect.objectContaining({
        normalizedPath: ["Audio", "Volume"],
      }),
    );
  });

  it("returns schema-backed doc results for rooted doc paths", async () => {
    await expect(xapi.doc("Status/Audio/Volume")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          type: "Integer",
        }),
        access: expect.any(String),
        description: expect.any(String),
        include_for_extension: expect.any(String),
        privacyimpact: expect.any(String),
        read: expect.any(String),
      }),
    );
    await expect(xapi.doc("Status Audio Volume")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          type: "Integer",
        }),
      }),
    );
    await expect(xapi.doc(["Status", "Audio", "Volume"])).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          type: "Integer",
        }),
      }),
    );
    await expect(xapi.doc("Config/SystemUnit/Name")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          default: "",
          type: "String",
        }),
        access: expect.any(String),
        include_for_extension: expect.any(String),
        read: expect.any(String),
        role: expect.any(String),
      }),
    );
    await expect(xapi.doc("Configuration/SystemUnit/Name")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          default: "",
          type: "String",
        }),
      }),
    );
    await expect(
      xapi.doc("Command/UserInterface/Message/Alert/Display"),
    ).resolves.toEqual(
      expect.objectContaining({
        Duration: expect.any(Object),
        Text: expect.any(Object),
        Title: expect.any(Object),
        access: expect.any(String),
        command: "True",
        description: expect.any(String),
        privacyimpact: expect.any(String),
        role: expect.any(String),
      }),
    );
    await expect(
      xapi.doc("Event/UserInterface/Extensions/Widget/Action"),
    ).resolves.toEqual(
      expect.objectContaining({
        Value: expect.any(Object),
        WidgetId: expect.any(Object),
        access: expect.any(String),
        event: "True",
        include_for_extension: expect.any(String),
        read: expect.any(String),
      }),
    );
  });

  it("registers on and once listeners and returns unsubscribe functions", () => {
    const statusHandler = jest.fn();
    const configHandler = jest.fn();
    const eventHandler = jest.fn();

    const unsubscribeStatus = xapi.status.on("Audio/Volume", statusHandler);
    xapi.config.once("Audio DefaultVolume", configHandler);
    const unsubscribeEvent = xapi.event.on("UserInterface/Extensions/Widget/Action", eventHandler);

    xapi.emitStatus("Audio Volume", 30);
    xapi.emitConfig("Audio/DefaultVolume", 100);
    xapi.emitConfig("Audio/DefaultVolume", 0);
    xapi.emitEvent("UserInterface Extensions Widget Action", { WidgetId: "speed" });

    unsubscribeStatus();
    unsubscribeEvent();
    xapi.emitStatus("Audio Volume", 31);
    xapi.emitEvent("UserInterface Extensions Widget Action", { WidgetId: "ignored" });

    expect(statusHandler).toHaveBeenCalledTimes(1);
    expect(statusHandler).toHaveBeenCalledWith(30);
    expect(configHandler).toHaveBeenCalledTimes(1);
    expect(configHandler).toHaveBeenCalledWith(100);
    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith({ WidgetId: "speed" });
    expect(xapi.callHistory.status.on[0]).toEqual(
      expect.objectContaining({
        normalizedPath: ["Audio", "Volume"],
        once: false,
      }),
    );
    expect(xapi.callHistory.config.on[0]).toEqual(
      expect.objectContaining({
        normalizedPath: ["Audio", "DefaultVolume"],
        once: true,
      }),
    );
    expect(xapi.callHistory.event.on[0]).toEqual(
      expect.objectContaining({
        normalizedPath: ["UserInterface", "Extensions", "Widget", "Action"],
      }),
    );
  });
});

describe("Uppercase proxy routing", () => {
  it("routes command proxies through xapi.command", async () => {
    xapi.setCommandResult("Dial", { status: "dialed" });
    xapi.setCommandResult("UserInterface/Message/Alert/Display", { status: "displayed" });

    await xapi.Command.Dial({ Number: "1234" });
    await xapi.Command.UserInterface.Message.Alert.Display({ Title: "Hi" });

    expect(xapi.command).toHaveBeenNthCalledWith(1, "Dial", { Number: "1234" }, undefined);
    expect(xapi.command).toHaveBeenNthCalledWith(
      2,
      "UserInterface/Message/Alert/Display",
      { Title: "Hi" },
      undefined,
    );
  });

  it("routes status, config, and event proxies through lowercase components", async () => {
    const statusHandler = jest.fn();
    const configHandler = jest.fn();
    const eventHandler = jest.fn();

    await xapi.Status.Audio.Volume.get();
    xapi.Status.Audio.Volume.on(statusHandler);
    await xapi.Config.SystemUnit.Name.set("Boardroom");
    await xapi.Config.SystemUnit.Name.get();
    xapi.Config.Audio.DefaultVolume.on(configHandler);
    xapi.Event.UserInterface.Extensions.Widget.Action.on(eventHandler);

    expect(xapi.status.get).toHaveBeenCalledWith("Audio/Volume");
    expect(xapi.status.on).toHaveBeenCalledWith("Audio/Volume", statusHandler);
    expect(xapi.config.set).toHaveBeenCalledWith("SystemUnit/Name", "Boardroom");
    expect(xapi.config.get).toHaveBeenCalledWith("SystemUnit/Name");
    expect(xapi.config.on).toHaveBeenCalledWith("Audio/DefaultVolume", configHandler);
    expect(xapi.event.on).toHaveBeenCalledWith(
      "UserInterface/Extensions/Widget/Action",
      eventHandler,
    );
  });
});

describe("Independent mock instances", () => {
  it("does not share listeners, values, or call history across created instances", async () => {
    const first = createXapi();
    const second = createXapi();
    const secondHandler = jest.fn();

    first.setStatus("Audio/Volume", 10);
    second.status.on("Audio/Volume", secondHandler);
    first.emitStatus("Audio/Volume", 11);

    await expect(first.status.get("Audio/Volume")).resolves.toBe(11);
    await expect(second.status.get("Audio/Volume")).resolves.toBe("0");
    expect(secondHandler).not.toHaveBeenCalled();
    expect(first.callHistory.status.on).toHaveLength(0);
    expect(second.callHistory.status.on).toHaveLength(1);
  });
});

describe("Status paths", () => {
  it("supports valid schema-backed status getters", async () => {
    const result = await xapi.Status.Audio.Volume.get();

    expect(result).toBe("0");
    expect(xapi.Status.Audio.Volume.get).toHaveBeenCalledTimes(1);
    expect(xapi.Status.Audio.Volume.get).toHaveBeenCalledWith();
  });

  it("supports indexed status paths from the schema", async () => {
    xapi.Status.Call[1].Status.set("Connected");

    await expect(xapi.Status.Call[1].Status.get()).resolves.toBe("Connected");
    expect(xapi.Status.Call[1].Status.get).toHaveBeenCalledTimes(1);
  });

  it("supports subtree status getters on indexed paths", async () => {
    xapi.Status.Cameras.Camera[1].Connected.set("True");
    xapi.Status.Cameras.Camera[1].Manufacturer.set("Cisco");

    await expect(xapi.Status.Cameras.Camera[1].get()).resolves.toEqual({
      Connected: "True",
      id: "1",
      Manufacturer: "Cisco",
    });
  });

  it("supports root status getters", async () => {
    xapi.Status.Cameras.Camera[1].Connected.set("True");

    await expect(xapi.Status.get()).resolves.toEqual(
      expect.objectContaining({
        Audio: expect.objectContaining({
          Volume: "0",
        }),
        Cameras: expect.objectContaining({
          Camera: expect.arrayContaining([
            expect.objectContaining({
              Connected: "True",
            }),
          ]),
        }),
      }),
    );
  });

  it("supports schema-backed configuration subscriptions and emits", () => {
    const handler = jest.fn();

    xapi.Status.Audio.Volume.on(handler);
    xapi.Status.Audio.Volume.set(10);

    expect(xapi.Status.Audio.Volume.set).toHaveBeenCalledWith(10);
    expect(xapi.Status.Audio.Volume.on).toHaveBeenCalledWith(handler);
  });

  it("supports indexed branch status subscriptions with branch snapshots", () => {
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

  it("emits a ghost payload when an indexed status branch is removed", () => {
    const handler = jest.fn();

    xapi.Status.Call.on(handler);
    xapi.Status.Call[7].Direction.set("Incoming");
    xapi.removeStatus("Call.7");

    expect(handler).toHaveBeenLastCalledWith({
      ghost: "true",
      id: "7",
    });
  });

  it("supports root status subscriptions with relative path payloads", () => {
    const handler = jest.fn();

    xapi.Status.on(handler);
    xapi.Status.Audio.Volume.set(55);

    expect(handler).toHaveBeenCalledWith({
      Audio: {
        Volume: 55,
      },
    });
  });

  it("rejects invalid status paths with a path error payload", async () => {
    await expect(xapi.Status.invalid.get()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it("rejects directly-invoked invalid status paths with a path error payload", async () => {
    await expect(xapi.Status.invalid()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });
});

describe("Configuration paths", () => {
  it("supports schema-backed configuration get and set", async () => {
    await xapi.Config.Audio.DefaultVolume.set(100);

    expect(xapi.Config.Audio.DefaultVolume.set).toHaveBeenCalledWith(100);
    await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(100);
  });

  it("supports schema-backed configuration subscriptions and emits", async () => {
    const handler = jest.fn();
    const defaultVolume = 100;

    xapi.Config.Audio.DefaultVolume.on(handler);
    await xapi.Config.Audio.DefaultVolume.set(defaultVolume);

    expect(xapi.Config.Audio.DefaultVolume.set).toHaveBeenCalledWith(
      defaultVolume,
    );
    expect(xapi.Config.Audio.DefaultVolume.on).toHaveBeenCalledWith(handler);
    expect(handler).toHaveBeenCalledWith(defaultVolume);
    await expect(xapi.Config.Audio.DefaultVolume.get()).resolves.toBe(defaultVolume);
  });

  it("supports root configuration getters", async () => {
    const result = await xapi.Config.get() as Record<string, unknown>;

    expect(result).toHaveProperty("Audio");
    expect((result.Audio as Record<string, unknown>).DefaultVolume).toBeDefined();
  });

  it("supports omitted-index configuration getters for indexed paths", async () => {
    await xapi.Config.Video.Output.Connector[1].MonitorRole.set("First");
    await xapi.Config.Video.Output.Connector[2].MonitorRole.set("Second");

    await expect(xapi.Config.Video.Output.Connector[1].get()).resolves.toEqual(
      expect.objectContaining({
        id: "1",
        MonitorRole: "First",
      }),
    );
    await expect(xapi.Config.Video.Output.Connector.get()).resolves.toEqual([
      expect.objectContaining({
        id: "1",
        MonitorRole: "First",
      }),
      expect.objectContaining({
        id: "2",
        MonitorRole: "Second",
      }),
    ]);
  });

  it("supports wildcard configuration getters for indexed paths", async () => {
    await xapi.Config.Video.Output.Connector[1].MonitorRole.set("First");
    await xapi.Config.Video.Output.Connector[2].MonitorRole.set("Second");

    await expect(xapi.Config.Video.Output.Connector["*"].get()).resolves.toEqual([
      expect.objectContaining({
        id: "1",
        MonitorRole: "First",
      }),
      expect.objectContaining({
        id: "2",
        MonitorRole: "Second",
      }),
    ]);
  });

  it("supports root configuration subscriptions with relative path payloads", async () => {
    const handler = jest.fn();

    xapi.Config.on(handler);
    await xapi.Config.Audio.DefaultVolume.set(100);

    expect(handler).toHaveBeenCalledWith({
      Audio: {
          DefaultVolume: 100,
      },
    });
  });

  it("rejects invalid configuration paths with a path error payload", async () => {
    await expect(xapi.Config.invalid.get()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it("rejects directly-invoked invalid configuration paths with a path error payload", async () => {
    await expect(xapi.Config.invalid()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });
});

describe("Command paths", () => {
  it("tracks nested xCommand calls as jest mocks and resolves success", async () => {
    const result = await xapi.Command.Audio.Volume.Set({ Level: 20 });

    expect(xapi.Command.Audio.Volume.Set).toHaveBeenCalledTimes(1);
    expect(xapi.Command.Audio.Volume.Set).toHaveBeenCalledWith({ Level: 20 });
    expect(result).toEqual({ status: "OK" });
  });

  it("allows command results to override schema validation for custom command paths", async () => {
    xapi.setCommandResult("Custom Command", { status: "custom" });

    await expect(xapi.Command.Custom.Command()).resolves.toEqual({
      status: "custom",
    });
  });

  it("allows command calls when all schema parameters are optional", async () => {
    await expect(
      xapi.Command.UserInterface.Message.Alert.Clear(),
    ).resolves.toEqual({
      status: "OK",
    });
  });

  it("rejects command parameters outside the allowed schema range", async () => {
    await expect(xapi.Command.Audio.Volume.Set({ Level: 120 })).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
  });

  it("rejects command calls when required parameters are missing from the argument object", async () => {
    await expect(xapi.Command.Audio.Volume.Set({})).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
  });

  it("rejects command calls when required parameters are omitted entirely", async () => {
    await expect(xapi.Command.Audio.Volume.Set()).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
  });
});

describe("RoomOS macro runtime globals", () => {
  it("defines _main_module_name and returns the calling macro name without the source extension", async () => {
    jest.clearAllMocks();

    const macroModule = await import("./fixtures/self-deactivating-macro.js") as {
      macroName: string;
    };

    expect(macroModule.macroName).toBe("self-deactivating-macro");
    expect(xapi.Command.Macros.Macro.Deactivate).toHaveBeenCalledWith({
      Name: "self-deactivating-macro",
    });
  });
});

describe("Event paths", () => {
  it("supports schema-backed event subscriptions and emits", () => {
    const handler = jest.fn();
    const eventPayload = { App: "Share" };

    xapi.Event.Apps.App.Opened.on(handler);
    xapi.Event.Apps.App.Opened.emit(eventPayload);

    expect(xapi.Event.Apps.App.Opened.on).toHaveBeenCalledWith(handler);
    expect(xapi.Event.Apps.App.Opened.emit).toHaveBeenCalledWith(eventPayload);
    expect(handler).toHaveBeenCalledWith(eventPayload);
  });

  it("supports root event subscriptions with relative path payloads", () => {
    const handler = jest.fn();
    const eventPayload = { PanelId: "speed-dial-panel" };

    xapi.Event.on(handler);
    xapi.Event.UserInterface.Extensions.Panel.Clicked.emit(eventPayload);

    expect(handler).toHaveBeenCalledWith({
      UserInterface: {
        Extensions: {
          Panel: {
            Clicked: eventPayload,
          },
        },
      },
    });
  });
});

describe("Invalid paths", () => {
  it("rejects invalid command paths with a method-not-found payload", async () => {
    await expect(xapi.Command.NotARealCommand()).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });

  it("rejects lowercase invalid command paths with a method-not-found payload", async () => {
    await expect(xapi.Command.invalid()).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });
});

describe("Product-specific xAPI availability", () => {
  it("defaults Status.SystemUnit.ProductPlatform to Desk Pro", async () => {
    expect(await xapi.Status.SystemUnit.ProductPlatform.get()).toBe("Desk Pro");
  });

  it("defaults software statuses from the latest schema for the selected product", async () => {
    const expectedSoftware = getExpectedSoftwareStatuses("Desk Pro");

    await expect(
      xapi.Status.SystemUnit.Software.DisplayName.get(),
    ).resolves.toBe(expectedSoftware["Status.SystemUnit.Software.DisplayName"]);
    await expect(xapi.Status.SystemUnit.Software.Version.get()).resolves.toBe(
      expectedSoftware["Status.SystemUnit.Software.Version"],
    );
    await expect(xapi.Status.SystemUnit.Software.get()).resolves.toEqual(
      expect.objectContaining({
        DisplayName: expectedSoftware["Status.SystemUnit.Software.DisplayName"],
        Version: expectedSoftware["Status.SystemUnit.Software.Version"],
      }),
    );
  });

  it("updates software status defaults when product selection changes schema", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Board 70");
    const expectedSoftware = getExpectedSoftwareStatuses("Board 70");

    await expect(
      xapi.Status.SystemUnit.Software.DisplayName.get(),
    ).resolves.toBe(expectedSoftware["Status.SystemUnit.Software.DisplayName"]);
    await expect(xapi.Status.SystemUnit.Software.Version.get()).resolves.toBe(
      expectedSoftware["Status.SystemUnit.Software.Version"],
    );
  });

  it("prefers explicitly set software statuses over schema defaults", async () => {
    xapi.setStatus("SystemUnit/Software/Version", "ce-custom");

    await expect(xapi.Status.SystemUnit.Software.Version.get()).resolves.toBe(
      "ce-custom",
    );
  });

  it("uses Desk Pro product filtering before a ProductPlatform is explicitly set", async () => {
    await expect(
      xapi.Config.Video.Output.Connector[3].MonitorRole.set("Auto"),
    ).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });

    await expect(xapi.Command.Audio.Equalizer.List()).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });

  it("keeps Desk Pro product filtering if ProductPlatform is removed", async () => {
    xapi.removeStatus("SystemUnit.ProductPlatform");

    await expect(
      xapi.Config.Video.Output.Connector[3].MonitorRole.set("Auto"),
    ).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it("allows product-supported configuration paths and values", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    await expect(
      xapi.Config.Video.Output.Connector[1].MonitorRole.set("Auto"),
    ).resolves.toBe("Auto");
  });

  it("rejects configuration paths that are unavailable on the selected product", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    await expect(
      xapi.Config.Video.Output.Connector[3].MonitorRole.set("Auto"),
    ).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it("rejects configuration values that are unavailable on the selected product", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    await expect(
      xapi.Config.Video.Output.Connector[1].MonitorRole.set("PresentationOnly"),
    ).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
  });

  it("returns product-supported indexed configuration defaults for aggregate getters", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    const outputs = await xapi.Config.Video.Output.Connector.get();

    expect(outputs).toHaveLength(2);
    expect(outputs).toEqual([
      expect.objectContaining({
        id: "1",
        MonitorRole: expect.any(String),
      }),
      expect.objectContaining({
        id: "2",
        MonitorRole: expect.any(String),
      }),
    ]);
  });

  it("prefers stored configuration values over product-supported defaults", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    await xapi.Config.Video.Output.Connector[1].MonitorRole.set("First");

    await expect(xapi.Config.Video.Output.Connector[1].MonitorRole.get()).resolves.toBe("First");
    await expect(xapi.Config.Video.Output.Connector.get()).resolves.toEqual([
      expect.objectContaining({
        id: "1",
        MonitorRole: "First",
      }),
      expect.objectContaining({
        id: "2",
        MonitorRole: expect.any(String),
      }),
    ]);
  });

  it("filters indexed configuration defaults to the selected product", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Codec Pro");

    const codecProOutputs = await xapi.Config.Video.Output.Connector.get();

    expect(codecProOutputs).toHaveLength(3);
    expect(
      codecProOutputs.every((output: Record<string, unknown>) =>
        Object.hasOwn(output, "MonitorRole"),
      ),
    ).toBe(true);

    xapi.Status.SystemUnit.ProductPlatform.set("Desk");

    const deskOutputs = await xapi.Config.Video.Output.Connector.get();
    const deskOutputsWithMonitorRole = deskOutputs.filter(
      (output: Record<string, unknown>) => Object.hasOwn(output, "MonitorRole"),
    );

    expect(deskOutputsWithMonitorRole).toHaveLength(0);
  });

  it("uses the newest bundled major schema that supports the selected product", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Board 70");
    const expectedSoftware = getExpectedSoftwareStatuses("Board 70");

    await expect(xapi.Status.SystemUnit.ProductPlatform.get()).resolves.toBe("Board 70");
    await expect(xapi.Status.Audio.Volume.get()).resolves.toBe("0");
    await expect(xapi.Status.SystemUnit.Software.Version.get()).resolves.toBe(
      expectedSoftware["Status.SystemUnit.Software.Version"],
    );
    await expect(xapi.Config.SystemUnit.Name.get()).resolves.toEqual(expect.any(String));
    await expect(xapi.Config.Video.Output.Connector.get()).resolves.toEqual(expect.any(Array));
    await expect(xapi.doc("Status/Audio/Volume")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.any(Object),
      }),
    );
    await expect(
      xapi.Command.UserInterface.Message.Alert.Display({
        Text: "legacy product schema selection",
      }),
    ).resolves.toEqual({
      status: "OK",
    });
  });

  it("rejects command paths that are unavailable on the selected product", async () => {
    xapi.Status.SystemUnit.ProductPlatform.set("Desk Pro");

    await expect(xapi.Command.Audio.Equalizer.List()).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });
});
