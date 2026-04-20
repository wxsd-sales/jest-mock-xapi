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

  it("supports schema-backed configuration subscriptions and emits", () => {
    const handler = jest.fn();

    xapi.Status.Audio.Volume.on(handler);
    xapi.Status.Audio.Volume.set(10);

    expect(xapi.Status.Audio.Volume.set).toHaveBeenCalledWith(10);
    expect(xapi.Status.Audio.Volume.on).toHaveBeenCalledWith(handler);
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
