import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createSchemaSoftwareStatusEntries } from "../defaults.ts";
import { getProductCodes, loadSchemaModel } from "../utils/index.ts";
import xapi from "../xapi.ts";

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

async function enableHttpClient() {
  await xapi.Config.HttpClient.Mode.set("On");
}

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

  it("exposes the Jest mock API on new style and old style functions", () => {
    const jestMockMethods = [
      "getMockImplementation",
      "getMockName",
      "mockClear",
      "mockImplementation",
      "mockImplementationOnce",
      "mockName",
      "mockRejectedValue",
      "mockRejectedValueOnce",
      "mockResolvedValue",
      "mockResolvedValueOnce",
      "mockReset",
      "mockRestore",
      "mockReturnThis",
      "mockReturnValue",
      "mockReturnValueOnce",
      "withImplementation",
    ];
    const mockedSurfaces = [
      xapi.Command.Dial,
      xapi.Status.Audio.Volume.get,
      xapi.Status.Audio.Volume.set,
      xapi.Config.Audio.DefaultVolume.get,
      xapi.Config.Audio.DefaultVolume.set,
      xapi.Event.UserInterface.Extensions.Widget.Action.emit,
      xapi.command,
      xapi.status.get,
      xapi.status.on,
      xapi.status.once,
      xapi.config.get,
      xapi.config.set,
      xapi.config.on,
      xapi.config.once,
      xapi.event.on,
      xapi.event.once,
      xapi.doc,
    ];

    for (const mockedSurface of mockedSurfaces) {
      const mock = mockedSurface as unknown as Record<string, unknown>;

      expect(mock._isMockFunction).toBe(true);
      expect(mock.mock).toBeDefined();

      for (const method of jestMockMethods) {
        expect(typeof mock[method]).toBe("function");
      }
    }
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

  it("supports mock command handlers and command results by path", async () => {
    const handler = jest.fn(
      (_params?: unknown, _body?: unknown, _call?: unknown) => ({
        status: "handled",
      }),
    );

    xapi.setCommandHandler("Dial", handler);
    xapi.setCommandResult("UserInterface Message Alert Display", { status: "displayed" });

    await expect(xapi.command("Dial", { Number: "1234" })).resolves.toEqual({
      status: "handled",
    });
    await expect(
      xapi.command("UserInterface Message Alert Display"),
    ).resolves.toEqual({ status: "displayed" });
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
  });

  it("supports path-scoped mockImplementationOnce for old style commands", async () => {
    const handler = jest.fn(async (...args: unknown[]) => {
      const [params] = args;

      return {
        dialed: (params as { Number?: string }).Number,
      };
    });

    xapi.command.mockImplementationOnce("Dial", handler);

    await expect(xapi.command("Audio Volume Set", { Level: 20 })).resolves.toEqual({
      status: "OK",
    });
    await expect(xapi.command("Dial", { Number: "1234" })).resolves.toEqual({
      dialed: "1234",
    });
    await expect(xapi.command("Dial", { Number: "5678" })).resolves.toEqual({
      status: "OK",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { Number: "1234" },
      undefined,
      expect.objectContaining({
        normalizedPath: ["Dial"],
      }),
    );
  });

  it("supports path-scoped Jest result helpers for old style commands", async () => {
    xapi.command
      .mockReturnValueOnce("Dial", { status: "returned" })
      .mockResolvedValueOnce("Dial", { status: "resolved-once" })
      .mockRejectedValueOnce("Dial", { code: 9001, message: "rejected-once" });

    await expect(xapi.command("Audio Volume Set", { Level: 20 })).resolves.toEqual({
      status: "OK",
    });
    await expect(xapi.command("Dial", { Number: "1000" })).resolves.toEqual({
      status: "returned",
    });
    await expect(xapi.command("Dial", { Number: "1001" })).resolves.toEqual({
      status: "resolved-once",
    });
    await expect(xapi.command("Dial", { Number: "1002" })).rejects.toEqual({
      code: 9001,
      message: "rejected-once",
    });
    await expect(xapi.command("Dial", { Number: "1003" })).resolves.toEqual({
      status: "OK",
    });
  });

  it("supports path-scoped persistent Jest helpers for old style commands", async () => {
    xapi.command.mockImplementation("Dial", (params) => ({
      dialed: (params as { Number?: string }).Number,
    }));

    await expect(xapi.command("Dial", { Number: "2000" })).resolves.toEqual({
      dialed: "2000",
    });

    xapi.reset();
    xapi.command.mockResolvedValue("Dial", { status: "resolved" });

    await expect(xapi.command("Dial", { Number: "2001" })).resolves.toEqual({
      status: "resolved",
    });

    xapi.reset();
    xapi.command.mockRejectedValue("Dial", { code: 9002, message: "rejected" });

    await expect(xapi.command("Dial", { Number: "2002" })).rejects.toEqual({
      code: 9002,
      message: "rejected",
    });
  });

  it("keeps the standard Jest mockImplementationOnce form on old style commands", async () => {
    xapi.command.mockImplementationOnce(async (path: unknown, params: unknown) => ({
      params,
      path,
    }));

    await expect(xapi.command("Dial", { Number: "1234" })).resolves.toEqual({
      params: { Number: "1234" },
      path: "Dial",
    });
  });

  it("returns schema-backed doc results for rooted doc paths", async () => {
    await expect(xapi.doc("Status Audio Volume")).resolves.toEqual(
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
    await expect(xapi.doc(["Status", "Audio", "Volume"])).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          type: "Integer",
        }),
      }),
    );
    await expect(xapi.doc("Config SystemUnit Name")).resolves.toEqual(
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
    await expect(xapi.doc("Configuration SystemUnit Name")).resolves.toEqual(
      expect.objectContaining({
        ValueSpace: expect.objectContaining({
          default: "",
          type: "String",
        }),
      }),
    );
    await expect(
      xapi.doc("Command UserInterface Message Alert Display"),
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
      xapi.doc("Event UserInterface Extensions Widget Action"),
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

  it("registers on and once listeners and returns unsubscribe functions", async () => {
    const statusHandler = jest.fn();
    const configHandler = jest.fn();
    const eventHandler = jest.fn();

    const unsubscribeStatus = xapi.status.on("Audio Volume", statusHandler);
    xapi.config.once("Audio DefaultVolume", configHandler);
    const unsubscribeEvent = xapi.event.on("UserInterface Extensions Widget Action", eventHandler);

    xapi.setStatus("Audio Volume", 30);
    await xapi.config.set("Audio DefaultVolume", 100);
    await xapi.config.set("Audio DefaultVolume", 0);
    xapi.emitEvent("UserInterface Extensions Widget Action", { WidgetId: "speed" });

    unsubscribeStatus();
    unsubscribeEvent();
    xapi.setStatus("Audio Volume", 31);
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

describe("New style and old style API parity", () => {
  it.each([
    {
      getValue: () => xapi.Status.Audio.Volume.get(),
      name: "new style status path",
      setValue: () => xapi.Status.Audio.Volume.set(20),
    },
    {
      getValue: () => xapi.status.get("Audio Volume"),
      name: "old style status path",
      setValue: () => xapi.setStatus("Audio Volume", 20),
    },
  ])("sets and reads status values with $name", async ({ getValue, setValue }) => {
    setValue();

    await expect(getValue()).resolves.toBe(20);
  });

  it.each([
    {
      getValue: () => xapi.Config.Audio.DefaultVolume.get(),
      name: "new style config path",
      setValue: () => xapi.Config.Audio.DefaultVolume.set(100),
    },
    {
      getValue: () => xapi.config.get("Audio DefaultVolume"),
      name: "old style config path",
      setValue: () => xapi.config.set("Audio DefaultVolume", 100),
    },
  ])("sets and reads config values with $name", async ({ getValue, setValue }) => {
    await setValue();

    await expect(getValue()).resolves.toBe(100);
  });

  it.each([
    {
      name: "new style command path",
      runCommand: () => xapi.Command.Dial({ Number: "1234" }),
    },
    {
      name: "old style command path",
      runCommand: () => xapi.command("Dial", { Number: "1234" }),
    },
  ])("uses mocked command results with $name", async ({ runCommand }) => {
    xapi.setCommandResult("Dial", { status: "dialed" });

    await expect(runCommand()).resolves.toEqual({ status: "dialed" });
  });

  it.each([
    {
      name: "new style command path",
      runInvalidCommand: () => xapi.Command.Audio.Volume.Set({ Level: 120 }),
      runValidCommand: () => xapi.Command.Audio.Volume.Set({ Level: 20 }),
    },
    {
      name: "old style command path",
      runInvalidCommand: () => xapi.command("Audio Volume Set", { Level: 120 }),
      runValidCommand: () => xapi.command("Audio Volume Set", { Level: 20 }),
    },
  ])("validates schema command arguments with $name", async ({
    runInvalidCommand,
    runValidCommand,
  }) => {
    await expect(runValidCommand()).resolves.toEqual({ status: "OK" });
    await expect(runInvalidCommand()).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
  });

  it.each([
    {
      emitValue: (payload: unknown) =>
        xapi.Event.UserInterface.Extensions.Widget.Action.emit(payload),
      name: "new style event path",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.Event.UserInterface.Extensions.Widget.Action.on(listener),
    },
    {
      emitValue: (payload: unknown) =>
        xapi.emitEvent("UserInterface Extensions Widget Action", payload),
      name: "old style event path",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.event.on("UserInterface Extensions Widget Action", listener),
    },
  ])("subscribes and emits events with $name", ({ emitValue, subscribe }) => {
    const handler = jest.fn();
    const payload = { Type: "pressed", WidgetId: "speed" };

    const unsubscribe = subscribe(handler);
    emitValue(payload);
    unsubscribe();
    emitValue({ Type: "ignored", WidgetId: "speed" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it.each([
    {
      emitValue: () => xapi.Status.Audio.Volume.set(21),
      name: "new style status subscription",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.Status.Audio.Volume.on(listener),
    },
    {
      emitValue: () => xapi.setStatus("Audio Volume", 21),
      name: "old style status subscription",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.status.on("Audio Volume", listener),
    },
  ])("notifies status listeners with $name", ({ emitValue, subscribe }) => {
    const handler = jest.fn();

    const unsubscribe = subscribe(handler);
    emitValue();
    unsubscribe();
    emitValue();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(21);
  });

  it.each([
    {
      emitValue: () => xapi.Config.Audio.DefaultVolume.set(100),
      name: "new style config subscription",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.Config.Audio.DefaultVolume.on(listener),
    },
    {
      emitValue: () => xapi.config.set("Audio DefaultVolume", 100),
      name: "old style config subscription",
      subscribe: (listener: (payload: unknown) => void) =>
        xapi.config.on("Audio DefaultVolume", listener),
    },
  ])("notifies config listeners with $name", async ({ emitValue, subscribe }) => {
    const handler = jest.fn();

    const unsubscribe = subscribe(handler);
    await emitValue();
    unsubscribe();
    await emitValue();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(100);
  });

  it.each([
    {
      name: "new style status path",
      readValue: () => xapi.Status.Not.A.Real.Status.get(),
    },
    {
      name: "old style status path",
      readValue: () => xapi.status.get("Not A Real Status"),
    },
  ])("rejects invalid status paths with $name", async ({ readValue }) => {
    await expect(readValue()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it.each([
    {
      name: "new style config path",
      readValue: () => xapi.Config.Not.A.Real.Config.get(),
    },
    {
      name: "old style config path",
      readValue: () => xapi.config.get("Not A Real Config"),
    },
  ])("rejects invalid config paths with $name", async ({ readValue }) => {
    await expect(readValue()).rejects.toEqual({
      code: 3,
      message: "No match on address expression",
    });
  });

  it("shares cached command mocks between new style and old style calls", async () => {
    xapi.Command.Dial.mockResolvedValueOnce({ status: "from-new-style-mock" });

    await expect(xapi.command("Dial", { Number: "1234" })).resolves.toEqual({
      status: "from-new-style-mock",
    });
    expect(xapi.Command.Dial).toHaveBeenCalledWith({ Number: "1234" });

    xapi.command.mockResolvedValueOnce("Dial", { status: "from-old-style-mock" });

    await expect(xapi.Command.Dial({ Number: "5678" })).resolves.toEqual({
      status: "from-old-style-mock",
    });
    expect(xapi.command).toHaveBeenLastCalledWith(
      "Dial",
      { Number: "5678" },
      undefined,
    );
  });

  it("shares cached operation mocks between new style and old style status, config, and event calls", async () => {
    const statusHandler = jest.fn();
    const eventHandler = jest.fn();
    const eventPayload = { Type: "pressed", WidgetId: "speed" };

    xapi.setStatus("Audio Volume", 42);
    await xapi.status.get("Audio Volume");
    xapi.status.on("Audio Volume", statusHandler);

    await xapi.config.set("Audio DefaultVolume", 100);

    xapi.event.on("UserInterface Extensions Widget Action", eventHandler);
    xapi.emitEvent("UserInterface Extensions Widget Action", eventPayload);

    xapi.Status.Call[7].Status.set("Connected");
    xapi.removeStatus("Call 7");

    expect(xapi.Status.Audio.Volume.set).toHaveBeenCalledWith(42);
    expect(xapi.Status.Audio.Volume.get).toHaveBeenCalledWith();
    expect(xapi.Status.Audio.Volume.on).toHaveBeenCalledWith(statusHandler);
    expect(xapi.Config.Audio.DefaultVolume.set).toHaveBeenCalledWith(100);
    expect(
      xapi.Event.UserInterface.Extensions.Widget.Action.on,
    ).toHaveBeenCalledWith(eventHandler);
    expect(
      xapi.Event.UserInterface.Extensions.Widget.Action.emit,
    ).toHaveBeenCalledWith(eventPayload);
    expect(xapi.Status.Call[7].remove).toHaveBeenCalledWith();
  });
});

describe("New style routing", () => {
  it("routes new style commands through xapi.command", async () => {
    xapi.setCommandResult("Dial", { status: "dialed" });
    xapi.setCommandResult("UserInterface Message Alert Display", { status: "displayed" });

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

  it("routes new style status, config, and event paths through lowercase components", async () => {
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
    xapi.Status.Call[7].remove();

    expect(xapi.Status.Call[7].remove).toHaveBeenCalledWith();

    expect(handler).toHaveBeenLastCalledWith({
      ghost: "true",
      id: "7",
    });
  });

  it("returns false when a new style status remove has no stored branch", () => {
    expect(xapi.Status.Call[999].remove()).toBe(false);
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

  it("rejects HttpClient commands when HttpClient Mode is Off by default", async () => {
    await expect(
      xapi.Command.HttpClient.Get({ Url: "https://example.test" }),
    ).rejects.toEqual({
      code: 1,
      message: "Use of HttpClient disabled",
    });

    await expect(
      xapi.command("HttpClient Get", { Url: "https://example.test" }),
    ).rejects.toEqual({
      code: 1,
      message: "Use of HttpClient disabled",
    });
  });

  it("rejects HTTP URLs when HttpClient AllowHTTP is False", async () => {
    await enableHttpClient();
    await xapi.Config.HttpClient.AllowHTTP.set("False");

    await expect(
      xapi.Command.HttpClient.Get({ Url: "http://example.test" }),
    ).rejects.toEqual({
      code: 1,
      message: "HTTP protocol is not allowed",
    });

    await expect(
      xapi.Command.HttpClient.Get({ Url: "https://example.test" }),
    ).resolves.toEqual({
      Body: "",
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });
  });

  it("rejects command-level insecure HTTPS when HttpClient AllowInsecureHTTPS is False", async () => {
    await enableHttpClient();

    await expect(
      xapi.Command.HttpClient.Get({
        AllowInsecureHTTPS: "True",
        Url: "https://self-signed.badssl.com",
      }),
    ).rejects.toEqual({
      code: 1,
      message: "Insecure HTTPS not allowed",
    });

    await xapi.Config.HttpClient.AllowInsecureHTTPS.set("True");

    await expect(
      xapi.Command.HttpClient.Get({
        AllowInsecureHTTPS: "True",
        Url: "https://self-signed.badssl.com",
      }),
    ).resolves.toEqual({
      Body: "",
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });
  });

  it("returns RoomOS-shaped default HttpClient responses with ResultBody defaults", async () => {
    const url = "https://example.test";
    await enableHttpClient();

    await expect(xapi.Command.HttpClient.Get({ Url: url })).resolves.toEqual({
      Body: "",
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });

    const postResult = await xapi.Command.HttpClient.Post({ Url: url });

    expect(postResult).toEqual({
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });
    expect(postResult).not.toHaveProperty("Body");
  });

  it("uses setHttpClientResponse and only returns Body when ResultBody requests it", async () => {
    const url = "https://example.test";
    await enableHttpClient();

    xapi.setHttpClientResponse("Get", {
      body: "hidden unless requested",
      headers: { "content-type": "text/plain" },
      statusCode: 201,
    });

    const bodylessResult = await xapi.Command.HttpClient.Get({
      ResultBody: "None",
      Url: url,
    });

    expect(bodylessResult).toEqual({
      Headers: [{ Key: "content-type", Value: "text/plain", id: "1" }],
      StatusCode: "201",
      status: "OK",
    });
    expect(bodylessResult).not.toHaveProperty("Body");

    await expect(xapi.Command.HttpClient.Get({ Url: url })).resolves.toEqual({
      Body: "hidden unless requested",
      Headers: [{ Key: "content-type", Value: "text/plain", id: "1" }],
      StatusCode: "201",
      status: "OK",
    });
  });

  it("returns helper bodies for non-GET HttpClient commands when ResultBody is explicit", async () => {
    const url = "https://example.test";
    await enableHttpClient();

    xapi.setHttpClientResponse("Post", {
      body: "created",
      statusCode: 202,
    });
    xapi.setHttpClientResponse("HttpClient Put", {
      body: "hello",
      statusCode: "203",
    });

    await expect(
      xapi.Command.HttpClient.Post({
        ResultBody: "PlainText",
        Url: url,
      }),
    ).resolves.toEqual({
      Body: "created",
      Headers: [],
      StatusCode: "202",
      status: "OK",
    });
    await expect(
      xapi.command("HttpClient Put", {
        ResultBody: "Base64",
        Url: url,
      }),
    ).resolves.toEqual({
      Body: "aGVsbG8=",
      Headers: [],
      StatusCode: "203",
      status: "OK",
    });
  });

  it("rejects non-2xx HttpClient responses with RoomOS error metadata", async () => {
    await enableHttpClient();

    xapi.setHttpClientResponse("HttpClient Get", {
      body: "not returned",
      headers: [["x-test", "yes"]],
      statusCode: 404,
    });

    await expect(
      xapi.command("HttpClient Get", {
        ResultBody: "None",
        Url: "https://example.test",
      }),
    ).rejects.toEqual({
      code: 1,
      data: {
        Headers: [{ Key: "x-test", Value: "yes", id: "1" }],
        StatusCode: "404",
      },
      message: "Command returned an error.",
    });
  });

  it("rejects HttpClient commands beyond three simultaneous active connections", async () => {
    const url = "https://example.test";
    await enableHttpClient();

    const activeRequests = Array.from({ length: 3 }, () =>
      xapi.Command.HttpClient.Get({ Url: url }),
    );
    await Promise.resolve();
    const overflowRequests = Array.from({ length: 3 }, () =>
      xapi.Command.HttpClient.Get({ Url: url }),
    );

    const results = await Promise.allSettled([
      ...activeRequests,
      ...overflowRequests,
    ]);

    expect(results.slice(0, 3)).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);
    expect(results.slice(3)).toEqual([
      {
        reason: {
          code: 1,
          message: "No available http connections",
        },
        status: "rejected",
      },
      {
        reason: {
          code: 1,
          message: "No available http connections",
        },
        status: "rejected",
      },
      {
        reason: {
          code: 1,
          message: "No available http connections",
        },
        status: "rejected",
      },
    ]);

    await expect(xapi.Command.HttpClient.Get({ Url: url })).resolves.toEqual({
      Body: "",
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });
  });

  it("supports per-response HttpClient delays before releasing connection slots", async () => {
    const url = "https://example.test";
    await enableHttpClient();

    xapi.setHttpClientResponse("Get", {
      delayMs: 25,
    });

    const activeRequests = Array.from({ length: 3 }, () =>
      xapi.Command.HttpClient.Get({ Url: url }),
    );

    await Promise.resolve();
    await expect(xapi.Command.HttpClient.Get({ Url: url })).rejects.toEqual({
      code: 1,
      message: "No available http connections",
    });

    await Promise.all(activeRequests);
    await expect(xapi.Command.HttpClient.Get({ Url: url })).resolves.toEqual({
      Body: "",
      Headers: [],
      StatusCode: "200",
      status: "OK",
    });
  });

  it.each([
    {
      expectLastRecordedCall: (PanelId: string, body: string) => {
        expect(
          xapi.Command.UserInterface.Extensions.Panel.Save,
        ).toHaveBeenLastCalledWith({ PanelId }, body);
        expect(xapi.callHistory.command.at(-1)).toEqual(
          expect.objectContaining({
            body,
            normalizedPath: ["UserInterface", "Extensions", "Panel", "Save"],
            params: { PanelId },
          }),
        );
      },
      name: "new style command path",
      runCommand: (PanelId: string, body: string) =>
        xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId }, body),
    },
    {
      expectLastRecordedCall: (PanelId: string, body: string) => {
        expect(xapi.command).toHaveBeenLastCalledWith(
          "UserInterface Extensions Panel Save",
          { PanelId },
          body,
        );
        expect(xapi.callHistory.command.at(-1)).toEqual(
          expect.objectContaining({
            body,
            normalizedPath: ["UserInterface", "Extensions", "Panel", "Save"],
            params: { PanelId },
          }),
        );
      },
      name: "old style command path",
      runCommand: (PanelId: string, body: string) =>
        xapi.command("UserInterface Extensions Panel Save", { PanelId }, body),
    },
  ])("validates schema command string limits by UTF-8 byte length with $name", async ({
    expectLastRecordedCall,
    runCommand,
  }) => {
    const validPanelId = `${"\u00f8".repeat(127)}x`;
    const invalidPanelId = "\u00f8".repeat(128);
    const createPanelBody = (PanelId: string) =>
      `<Extensions><Version>1.11</Version><Panel><PanelId>${PanelId}</PanelId><Type>Panel</Type><Location>Hidden</Location><Icon>Info</Icon><Color>#1170CF</Color><Name>Parity</Name><ActivityType>Custom</ActivityType></Panel></Extensions>`;

    expect(Buffer.byteLength(validPanelId, "utf8")).toBe(255);
    expect(Buffer.byteLength(invalidPanelId, "utf8")).toBe(256);
    expect(invalidPanelId.length).toBeLessThanOrEqual(255);

    await expect(
      runCommand(validPanelId, createPanelBody(validPanelId)),
    ).resolves.toEqual({ status: "OK" });
    await expect(
      runCommand(invalidPanelId, createPanelBody(invalidPanelId)),
    ).rejects.toEqual({
      code: 4,
      message: 'Bad usage: Bad argument to parameter "PanelId".',
    });
    expectLastRecordedCall(invalidPanelId, createPanelBody(invalidPanelId));
  });

  it.each([
    {
      expectLastRecordedCall: (Text: string) => {
        expect(xapi.Command.Message.Send).toHaveBeenLastCalledWith({ Text });
        expect(xapi.callHistory.command.at(-1)).toEqual(
          expect.objectContaining({
            normalizedPath: ["Message", "Send"],
            params: { Text },
          }),
        );
      },
      name: "new style command path",
      runCommand: (Text: string) => xapi.Command.Message.Send({ Text }),
    },
    {
      expectLastRecordedCall: (Text: string) => {
        expect(xapi.command).toHaveBeenLastCalledWith("Message Send", { Text });
        expect(xapi.callHistory.command.at(-1)).toEqual(
          expect.objectContaining({
            normalizedPath: ["Message", "Send"],
            params: { Text },
          }),
        );
      },
      name: "old style command path",
      runCommand: (Text: string) => xapi.command("Message Send", { Text }),
    },
  ])("validates Message Send Text by UTF-8 byte length with $name", async ({
    expectLastRecordedCall,
    runCommand,
  }) => {
    const invalidTextError = {
      code: 4,
      message: 'Bad usage: Bad argument to parameter "Text".',
    };
    const asciiAtLimit = "x".repeat(8192);
    const asciiOverLimit = "x".repeat(8193);
    const twoByteAtLimit = "\u00f8".repeat(4096);
    const twoByteOverLimit = "\u00f8".repeat(4097);

    expect(Buffer.byteLength(asciiAtLimit, "utf8")).toBe(8192);
    expect(Buffer.byteLength(asciiOverLimit, "utf8")).toBe(8193);
    expect(Buffer.byteLength(twoByteAtLimit, "utf8")).toBe(8192);
    expect(Buffer.byteLength(twoByteOverLimit, "utf8")).toBe(8194);
    expect(twoByteOverLimit.length).toBeLessThanOrEqual(8192);

    await expect(runCommand(asciiAtLimit)).resolves.toEqual({ status: "OK" });
    await expect(runCommand(asciiOverLimit)).rejects.toEqual(invalidTextError);
    expectLastRecordedCall(asciiOverLimit);

    await expect(runCommand(twoByteAtLimit)).resolves.toEqual({ status: "OK" });
    await expect(runCommand(twoByteOverLimit)).rejects.toEqual(invalidTextError);
    expectLastRecordedCall(twoByteOverLimit);
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

describe("schema-backed xConfiguration value validation", () => {
  it.each([
    {
      expectLastRecordedCall: (value: string) => {
        expect(xapi.Config.SystemUnit.Name.set).toHaveBeenLastCalledWith(value);
        expect(xapi.callHistory.config.set.at(-1)).toEqual(
          expect.objectContaining({
            normalizedPath: ["SystemUnit", "Name"],
            value,
          }),
        );
      },
      name: "new style config path",
      setConfig: (value: string) => xapi.Config.SystemUnit.Name.set(value),
    },
    {
      expectLastRecordedCall: (value: string) => {
        expect(xapi.config.set).toHaveBeenLastCalledWith(
          "SystemUnit Name",
          value,
        );
        expect(xapi.callHistory.config.set.at(-1)).toEqual(
          expect.objectContaining({
            normalizedPath: ["SystemUnit", "Name"],
            value,
          }),
        );
      },
      name: "old style config path",
      setConfig: (value: string) => xapi.config.set("SystemUnit Name", value),
    },
  ])("validates schema config string limits by UTF-8 byte length with $name", async ({
    expectLastRecordedCall,
    setConfig,
  }) => {
    const validName = "\u00f8".repeat(25);
    const invalidName = "\u00f8".repeat(26);

    expect(Buffer.byteLength(validName, "utf8")).toBe(50);
    expect(Buffer.byteLength(invalidName, "utf8")).toBe(52);
    expect(invalidName.length).toBeLessThanOrEqual(50);

    await expect(setConfig(validName)).resolves.toBe(validName);
    await expect(setConfig(invalidName)).rejects.toEqual({
      code: 4,
      message: "Invalid or missing parameters",
    });
    expectLastRecordedCall(invalidName);
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
    await expect(xapi.command("NotARealCommand")).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });

  it("rejects lowercase invalid command paths with a method-not-found payload", async () => {
    await expect(xapi.Command.invalid()).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
    await expect(xapi.command("invalid")).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });
});

describe("Product-specific xAPI availability", () => {
  it("defaults Status.SystemUnit.ProductPlatform to Desk Pro", async () => {
    expect(await xapi.Status.SystemUnit.ProductPlatform.get()).toBe("Desk Pro");
    await expect(xapi.status.get("SystemUnit ProductPlatform")).resolves.toBe("Desk Pro");
  });

  it("defaults software statuses from the latest schema for the selected product", async () => {
    const expectedSoftware = getExpectedSoftwareStatuses("Desk Pro");

    await expect(
      xapi.Status.SystemUnit.Software.DisplayName.get(),
    ).resolves.toBe(expectedSoftware["Status.SystemUnit.Software.DisplayName"]);
    await expect(xapi.Status.SystemUnit.Software.Version.get()).resolves.toBe(
      expectedSoftware["Status.SystemUnit.Software.Version"],
    );
    await expect(
      xapi.status.get("SystemUnit Software DisplayName"),
    ).resolves.toBe(expectedSoftware["Status.SystemUnit.Software.DisplayName"]);
    await expect(xapi.status.get("SystemUnit Software Version")).resolves.toBe(
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
    xapi.setStatus("SystemUnit Software Version", "ce-custom");

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
    xapi.removeStatus("SystemUnit ProductPlatform");

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
    await expect(
      xapi.config.set("Video Output Connector 1 MonitorRole", "Auto"),
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
    await expect(
      xapi.config.set("Video Output Connector 3 MonitorRole", "Auto"),
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
    await expect(
      xapi.config.set(
        "Video Output Connector 1 MonitorRole",
        "PresentationOnly",
      ),
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
    await expect(xapi.config.get("Video Output Connector")).resolves.toEqual(expect.any(Array));
    await expect(xapi.doc("Status Audio Volume")).resolves.toEqual(
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
    await expect(xapi.command("Audio Equalizer List")).rejects.toEqual({
      code: 3,
      message: "Unknown command",
    });
  });
});
