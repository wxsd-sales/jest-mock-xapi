import { describe, expect, it, jest } from "@jest/globals";
import xapi from "../xapi.ts";

describe("xAPI Testing", () => {
  it("defines the top-level schema-backed domains", () => {
    expect(xapi.Command).toBeDefined();
    expect(xapi.Config).toBeDefined();
    expect(xapi.Status).toBeDefined();
    expect(xapi.Event).toBeDefined();
  });
});

describe("Status paths", () => {
  it("supports valid schema-backed status getters", () => {
    const result = xapi.Status.Audio.Volume.get();

    expect(result).toBe(20);
    expect(xapi.Status.Audio.Volume.get).toHaveBeenCalledTimes(1);
    expect(xapi.Status.Audio.Volume.get).toHaveBeenCalledWith();
  });

  it("supports indexed status paths from the schema", () => {
    xapi.Status.Audio.Input.Connectors.Ethernet[1].Mute.set("Off");

    expect(xapi.Status.Audio.Input.Connectors.Ethernet[1].Mute.get()).toBe(
      "Off",
    );
    expect(
      xapi.Status.Audio.Input.Connectors.Ethernet[1].Mute.get,
    ).toHaveBeenCalledTimes(1);
  });

  it("supports subtree status getters on indexed paths", () => {
    xapi.Status.Cameras.Camera[1].Connected.set("True");
    xapi.Status.Cameras.Camera[1].Manufacturer.set("Cisco");

    expect(xapi.Status.Cameras.Camera[1].get()).toEqual({
      Connected: "True",
      Manufacturer: "Cisco",
    });
  });

  it("supports root status getters", () => {
    xapi.Status.Cameras.Camera[1].Connected.set("True");

    expect(xapi.Status.get()).toEqual(
      expect.objectContaining({
        Audio: expect.objectContaining({
          Volume: 20,
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
      code: -32602,
      message: "No match on Path argument",
    });
  });

  it("rejects directly-invoked invalid status paths with a path error payload", async () => {
    await expect(xapi.Status.invalid()).rejects.toEqual({
      code: -32602,
      message: "No match on Path argument",
    });
  });
});

describe("Configuration paths", () => {
  it("supports schema-backed configuration get and set", () => {
    xapi.Config.Audio.DefaultVolume.set(30);

    expect(xapi.Config.Audio.DefaultVolume.set).toHaveBeenCalledWith(30);
    expect(xapi.Config.Audio.DefaultVolume.get()).toBe(30);
  });

  it("supports schema-backed configuration subscriptions and emits", () => {
    const handler = jest.fn();
    const defaultVolume = 40;

    xapi.Config.Audio.DefaultVolume.on(handler);
    xapi.Config.Audio.DefaultVolume.set(defaultVolume);

    expect(xapi.Config.Audio.DefaultVolume.set).toHaveBeenCalledWith(
      defaultVolume,
    );
    expect(xapi.Config.Audio.DefaultVolume.on).toHaveBeenCalledWith(handler);
    expect(handler).toHaveBeenCalledWith(defaultVolume);
    expect(xapi.Config.Audio.DefaultVolume.get()).toBe(defaultVolume);
  });

  it("supports root configuration getters", () => {
    const result = xapi.Config.get() as Record<string, unknown>;

    expect(result).toHaveProperty("Audio");
    expect((result.Audio as Record<string, unknown>).DefaultVolume).toBeDefined();
  });

  it("supports omitted-index configuration getters for indexed paths", () => {
    xapi.Config.Cameras.Camera[1].Brightness.Mode.set("Manual");
    xapi.Config.Cameras.Camera[2].Brightness.Mode.set("Auto");

    expect(xapi.Config.Cameras.Camera.get()).toEqual([
      {
        Brightness: {
          Mode: "Manual",
        },
      },
      {
        Brightness: {
          Mode: "Auto",
        },
      },
    ]);
  });

  it("supports wildcard configuration getters for indexed paths", () => {
    xapi.Config.Cameras.Camera[1].Brightness.Mode.set("Manual");
    xapi.Config.Cameras.Camera[2].Brightness.Mode.set("Auto");

    expect(xapi.Config.Cameras.Camera["*"].get()).toEqual([
      {
        Brightness: {
          Mode: "Manual",
        },
      },
      {
        Brightness: {
          Mode: "Auto",
        },
      },
    ]);
  });

  it("supports root configuration subscriptions with relative path payloads", () => {
    const handler = jest.fn();

    xapi.Config.on(handler);
    xapi.Config.Audio.DefaultVolume.set(35);

    expect(handler).toHaveBeenCalledWith({
      Audio: {
        DefaultVolume: 35,
      },
    });
  });

  it("rejects invalid configuration paths with a path error payload", async () => {
    await expect(xapi.Config.invalid.get()).rejects.toEqual({
      code: -32602,
      message: "No match on Path argument",
    });
  });

  it("rejects directly-invoked invalid configuration paths with a path error payload", async () => {
    await expect(xapi.Config.invalid()).rejects.toEqual({
      code: -32602,
      message: "No match on Path argument",
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

  it("rejects command parameters outside the allowed schema range", async () => {
    await expect(xapi.Command.Audio.Volume.Set({ Level: 120 })).rejects.toEqual({
      code: -32602,
      message: 'Bad usage: Bad argument to parameter "Level".',
    });
  });

  it("rejects command calls when required parameters are missing from the argument object", async () => {
    await expect(xapi.Command.Audio.Volume.Set({})).rejects.toEqual({
      code: -32602,
      message: "Bad usage: Missing or invalid parameter(s).",
    });
  });

  it("rejects command calls when required parameters are omitted entirely", async () => {
    await expect(xapi.Command.Audio.Volume.Set()).rejects.toEqual({
      code: -32602,
      message: "Bad usage: Missing or invalid parameter(s).",
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
      code: -32601,
      message: "Method not found.",
    });
  });

  it("rejects lowercase invalid command paths with a method-not-found payload", async () => {
    await expect(xapi.Command.invalid()).rejects.toEqual({
      code: -32601,
      message: "Method not found.",
    });
  });
});
