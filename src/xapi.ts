import { EventEmitter } from "events";
import { loadSchemaModel, proxy, logger } from "./utils/index.ts";

const commandSuccessResponse = { status: "OK" };
const invalidCommandError = { code: -32601, message: "Method not found." };
const missingOrInvalidCommandParametersError = {
  code: -32602,
  message: "Bad usage: Missing or invalid parameter(s).",
};
const invalidPathError = {
  code: -32602,
  message: "No match on Path argument",
};
const schemaModel = loadSchemaModel();

class MockXapi extends EventEmitter {
  #configStore = new Map<string, unknown>(schemaModel.defaults);
  #statusStore = new Map<string, unknown>([["Status.Audio.Volume", 20]]);
  Command: any;
  Config: any;
  Event: any;
  Status: any;

  constructor() {
    super();

    this.Command = proxy({
      callable: false,
      invalidError: invalidCommandError,
      invoke: ({ args, path }) => {
        const commandValidationError = this.#validateCommandArguments(path, args[0]);

        if (commandValidationError) {
          return Promise.reject(commandValidationError);
        }

        return Promise.resolve(commandSuccessResponse);
      },
      node: schemaModel.roots.Command,
      path: ["Command"],
    });

    this.Config = proxy({
      allowedMethods: ["get", "set", "on"],
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const storeKey = this.#getStoreKey(path);

        if (operation === "get") {
          return this.#configStore.get(storeKey);
        }

        if (operation === "set") {
          this.#configStore.set(storeKey, args[0]);
          this.emit(`Config:${storeKey}`, args[0]);
          return args[0];
        }

        if (operation === "on") {
          return this.on(`Config:${storeKey}`, args[0]);
        }

        throw new Error(`Unsupported config operation: ${operation}`);
      },
      node: schemaModel.roots.Configuration,
      path: ["Config"],
    });

    this.Status = proxy({
      allowedMethods: ["get", "on", "set"],
      invalidError: invalidPathError,
      invoke: ({ args, operation, path }) => {
        const storeKey = this.#getStoreKey(path);

        if (operation === "get") {
          return this.#statusStore.get(storeKey);
        }

        if (operation === "on") {
          return this.on(`Status:${storeKey}`, args[0]);
        }

        if (operation === "set") {
          this.#statusStore.set(storeKey, args[0]);
          this.emit(`Status:${storeKey}`, args[0]);
          return args[0];
        }

        throw new Error(`Unsupported status operation: ${operation}`);
      },
      node: schemaModel.roots.Status,
      path: ["Status"],
    });

    this.Event = proxy({
      allowedMethods: ["emit", "on"],
      invoke: ({ args, operation, path }) => {
        const eventKey = this.#getStoreKey(path);

        if (operation === "on") {
          return this.on(`Event:${eventKey}`, args[0]);
        }

        if (operation === "emit") {
          return this.emit(`Event:${eventKey}`, args[0]);
        }

        throw new Error(`Unsupported event operation: ${operation}`);
      },
      node: schemaModel.roots.Event,
      path: ["Event"],
    });
  }

  #getStoreKey(path: string[]) {
    return path.slice(0, -1).join(".");
  }

  #createInvalidCommandParameterError(parameterName: string) {
    return {
      code: -32602,
      message: `Bad usage: Bad argument to parameter "${parameterName}".`,
    };
  }

  #isPlainObject(value: unknown) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  #matchesLiteralValue(value: unknown, allowedValues: string[]) {
    return typeof value === "string" && allowedValues.includes(value);
  }

  #matchesIntegerValue(
    value: unknown,
    minRaw?: string,
    maxRaw?: string,
    stepRaw?: string,
  ) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return false;
    }

    const min = typeof minRaw === "string" ? Number(minRaw) : undefined;
    const max = typeof maxRaw === "string" ? Number(maxRaw) : undefined;
    const step = typeof stepRaw === "string" ? Number(stepRaw) : undefined;

    if (typeof min === "number" && value < min) {
      return false;
    }

    if (typeof max === "number" && value > max) {
      return false;
    }

    if (typeof min === "number" && typeof step === "number" && step > 0) {
      return (value - min) % step === 0;
    }

    return true;
  }

  #matchesStringValue(value: unknown, minLengthRaw?: string, maxLengthRaw?: string) {
    if (typeof value !== "string") {
      return false;
    }

    const minLength =
      typeof minLengthRaw === "string" ? Number(minLengthRaw) : undefined;
    const maxLength =
      typeof maxLengthRaw === "string" ? Number(maxLengthRaw) : undefined;

    if (typeof minLength === "number" && value.length < minLength) {
      return false;
    }

    if (typeof maxLength === "number" && value.length > maxLength) {
      return false;
    }

    return true;
  }

  #matchesArrayValue(value: unknown, itemMatcher: (item: unknown) => boolean) {
    return Array.isArray(value) && value.every((item) => itemMatcher(item));
  }

  #matchesParameterValue(valuespace: any, value: unknown) {
    if (!valuespace?.type) {
      return true;
    }

    if (valuespace.type === "Integer") {
      return this.#matchesIntegerValue(
        value,
        valuespace.Min,
        valuespace.Max,
        valuespace.Step,
      );
    }

    if (valuespace.type === "Literal") {
      return this.#matchesLiteralValue(value, valuespace.Values ?? []);
    }

    if (valuespace.type === "String") {
      return this.#matchesStringValue(
        value,
        valuespace.MinLength,
        valuespace.MaxLength,
      );
    }

    if (valuespace.type === "IntegerArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesIntegerValue(item, valuespace.Min, valuespace.Max, valuespace.Step),
      );
    }

    if (valuespace.type === "LiteralArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesLiteralValue(item, valuespace.Values ?? []),
      );
    }

    if (valuespace.type === "StringArray") {
      return this.#matchesArrayValue(value, (item) =>
        this.#matchesStringValue(item, valuespace.MinLength, valuespace.MaxLength),
      );
    }

    return true;
  }

  #validateCommandArguments(path: string[], parameters: unknown) {
    const commandKey = path.join(".");
    const signatures = schemaModel.commandSignatures.get(commandKey);

    if (!signatures || signatures.length === 0) {
      return null;
    }

    if (!this.#isPlainObject(parameters)) {
      return missingOrInvalidCommandParametersError;
    }

    const parameterRecord = parameters as Record<string, unknown>;
    let firstBadParameterName: string | null = null;

    for (const signature of signatures) {
      let signatureIsValid = true;
      let signatureHasMissingRequiredParameter = false;

      for (const parameter of signature) {
        const hasParameter = Object.hasOwn(parameterRecord, parameter.name);

        if (!hasParameter) {
          if (parameter.required) {
            signatureIsValid = false;
            signatureHasMissingRequiredParameter = true;
            break;
          }

          continue;
        }

        const value = parameterRecord[parameter.name];
        if (!this.#matchesParameterValue(parameter.valuespace, value)) {
          signatureIsValid = false;
          firstBadParameterName ??= parameter.name;
          break;
        }
      }

      if (signatureIsValid) {
        return null;
      }

      if (signatureHasMissingRequiredParameter) {
        continue;
      }
    }

    if (firstBadParameterName) {
      return this.#createInvalidCommandParameterError(firstBadParameterName);
    }

    return missingOrInvalidCommandParametersError;
  }

  // Helper to emit mock events in tests
  emitEvent(eventName: string, eventData: any) {
    this.emit(`Event:Event.${eventName}`, eventData);
  }

}

const xapi = new MockXapi();
export default xapi;
