import { EventEmitter } from "events";
import "./runtime.ts";
import {
  getProductCodes,
  loadSchemaModel,
  proxy,
  logger,
  resolveSchemaChild,
  type PathPatternSegment,
  type ProductScopedValue,
  type SchemaDomain,
  type SchemaNode,
} from "./utils/index.ts";

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
const materializedValueSymbol = Symbol("materializedValue");

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
        if (!this.#pathSupportsActiveProduct(path, true)) {
          return Promise.reject(invalidCommandError);
        }

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
      invoke: ({ args, node, operation, path }) => {
        const requiresExactProductPath = operation === "set";
        const pathSegments = this.#getPathSegments(path);

        if (!this.#pathSupportsActiveProduct(pathSegments, requiresExactProductPath)) {
          return Promise.reject(invalidPathError);
        }

        if (operation === "get") {
          return this.#getMaterializedStoreValue(this.#configStore, node, path);
        }

        const storeKey = this.#getStoreKey(path);

        if (operation === "set") {
          const validationError = this.#validatePathValue("Config", pathSegments, args[0]);

          if (validationError) {
            return Promise.reject(validationError);
          }

          this.#configStore.set(storeKey, args[0]);
          this.#emitStoreChange("Config", this.#configStore, path, args[0]);
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
      invoke: ({ args, node, operation, path }) => {
        const requiresExactProductPath = operation === "set";
        const pathSegments = this.#getPathSegments(path);

        if (!this.#pathSupportsActiveProduct(pathSegments, requiresExactProductPath)) {
          return Promise.reject(invalidPathError);
        }

        if (operation === "get") {
          return this.#getMaterializedStoreValue(this.#statusStore, node, path);
        }

        const storeKey = this.#getStoreKey(path);

        if (operation === "on") {
          return this.on(`Status:${storeKey}`, args[0]);
        }

        if (operation === "set") {
          const validationError = this.#validatePathValue("Status", pathSegments, args[0]);

          if (validationError) {
            return Promise.reject(validationError);
          }

          this.#statusStore.set(storeKey, args[0]);
          this.#emitStoreChange("Status", this.#statusStore, path, args[0]);
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
        const requiresExactProductPath = operation === "emit";
        const pathSegments = this.#getPathSegments(path);

        if (!this.#pathSupportsActiveProduct(pathSegments, requiresExactProductPath)) {
          return Promise.reject(invalidPathError);
        }

        const eventKey = this.#getStoreKey(path);

        if (operation === "on") {
          return this.on(`Event:${eventKey}`, args[0]);
        }

        if (operation === "emit") {
          this.#emitScopedChange("Event", null, this.#getPathSegments(path), args[0]);
          return true;
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

  #getPathSegments(path: string[]) {
    return path.slice(0, -1);
  }

  #getActiveProductCodes() {
    const productPlatform = this.#statusStore.get("Status.SystemUnit.ProductPlatform");

    if (typeof productPlatform !== "string") {
      return [];
    }

    return getProductCodes(productPlatform);
  }

  #getSchemaDomain(pathRoot: string): SchemaDomain {
    if (pathRoot === "Config") {
      return "Configuration";
    }

    if (pathRoot === "Status") {
      return "Status";
    }

    if (pathRoot === "Command") {
      return "Command";
    }

    return "Event";
  }

  #productsIncludeActiveProduct(products: Set<string>, activeProductCodes: string[]) {
    if (activeProductCodes.length === 0 || products.size === 0) {
      return true;
    }

    return activeProductCodes.some((productCode) => products.has(productCode));
  }

  #patternSegmentMatches(
    patternSegment: PathPatternSegment,
    querySegment: string,
  ) {
    if (patternSegment.type === "literal") {
      return patternSegment.value === querySegment;
    }

    if (querySegment === "*") {
      return true;
    }

    if (patternSegment.wildcard || patternSegment.allowedValues.has(querySegment)) {
      return true;
    }

    const numericValue = Number(querySegment);
    if (Number.isNaN(numericValue)) {
      return false;
    }

    return patternSegment.ranges.some(
      (range) => numericValue >= range.min && numericValue <= range.max,
    );
  }

  #pathPatternMatches(
    patternPath: PathPatternSegment[],
    querySegments: string[],
    requiresExactPath: boolean,
  ) {
    if (requiresExactPath && querySegments.length !== patternPath.length) {
      return false;
    }

    if (querySegments.length > patternPath.length) {
      return false;
    }

    return querySegments.every((querySegment, index) => {
      const patternSegment = patternPath[index];
      if (!patternSegment) {
        return false;
      }

      return this.#patternSegmentMatches(patternSegment, querySegment);
    });
  }

  #pathSupportsActiveProduct(pathSegments: string[], requiresExactPath: boolean) {
    const activeProductCodes = this.#getActiveProductCodes();

    if (activeProductCodes.length === 0) {
      return true;
    }

    const [rootSegment, ...querySegments] = pathSegments;

    if (typeof rootSegment !== "string") {
      return false;
    }

    const schemaDomain = this.#getSchemaDomain(rootSegment);
    const productPathPatterns = schemaModel.productPaths.get(schemaDomain) ?? [];

    return productPathPatterns.some((productPathPattern) =>
      this.#productsIncludeActiveProduct(
        productPathPattern.products,
        activeProductCodes,
      ) &&
      this.#pathPatternMatches(
        productPathPattern.path,
        querySegments,
        requiresExactPath,
      ),
    );
  }

  #storeKeySupportsActiveProduct(storeKey: string) {
    return this.#pathSupportsActiveProduct(storeKey.split("."), true);
  }

  #getProductDefaultStoreEntries(activeProductCodes: string[]) {
    if (activeProductCodes.length === 0) {
      return [];
    }

    return schemaModel.productDefaults
      .filter((productDefault) =>
        this.#productsIncludeActiveProduct(
          productDefault.products,
          activeProductCodes,
        ),
      )
      .map((productDefault) => ({
        storeKey: ["Config", ...productDefault.path].join("."),
        storeValue: productDefault.value,
        skipProductSupportCheck: true,
      }));
  }

  #pathValuesForActiveProduct(
    values: ProductScopedValue[],
    pathSegments: string[],
  ) {
    const activeProductCodes = this.#getActiveProductCodes();
    const querySegments = pathSegments.slice(1);

    return values.filter(
      (productScopedValue) =>
        this.#productsIncludeActiveProduct(
          productScopedValue.products,
          activeProductCodes,
        ) &&
        this.#pathPatternMatches(productScopedValue.path, querySegments, true),
    );
  }

  #validatePathValue(
    pathRoot: "Config" | "Status",
    pathSegments: string[],
    value: unknown,
  ) {
    if (this.#getActiveProductCodes().length === 0) {
      return null;
    }

    const productScopedValues = this.#pathValuesForActiveProduct(
      pathRoot === "Config" ? schemaModel.configValues : schemaModel.statusValues,
      pathSegments,
    );

    if (productScopedValues.length === 0) {
      return invalidPathError;
    }

    const valueMatches = productScopedValues.some((productScopedValue) =>
      this.#matchesParameterValue(productScopedValue.valuespace, value),
    );

    return valueMatches ? null : missingOrInvalidCommandParametersError;
  }

  #getSchemaRoot(pathRoot: string) {
    if (pathRoot === "Config") {
      return schemaModel.roots.Configuration;
    }

    if (pathRoot === "Status") {
      return schemaModel.roots.Status;
    }

    if (pathRoot === "Command") {
      return schemaModel.roots.Command;
    }

    return schemaModel.roots.Event;
  }

  #resolvePathNode(pathSegments: string[]) {
    const [rootSegment, ...remainingSegments] = pathSegments;
    if (typeof rootSegment !== "string") {
      return null;
    }

    let currentNode = this.#getSchemaRoot(rootSegment);

    for (const segment of remainingSegments) {
      const nextNode = resolveSchemaChild(currentNode, segment);
      if (!nextNode) {
        return null;
      }

      currentNode = nextNode;
    }

    return currentNode;
  }

  #matchStoreKey(querySegments: string[], storeSegments: string[]) {
    if (storeSegments.length < querySegments.length) {
      return null;
    }

    const [rootSegment] = querySegments;
    if (typeof rootSegment !== "string") {
      return null;
    }

    const capturedWildcardSegments: string[] = [];
    let currentNode = this.#getSchemaRoot(rootSegment);

    for (const [index, querySegment] of querySegments.entries()) {
      const storeSegment = storeSegments[index];

      if (typeof storeSegment === "undefined") {
        return null;
      }

      if (index === 0) {
        if (querySegment !== storeSegment) {
          return null;
        }

        continue;
      }

      if (querySegment === "*") {
        if (!this.#matchesIndexedSegment(currentNode, storeSegment)) {
          return null;
        }

        capturedWildcardSegments.push(storeSegment);
        currentNode = currentNode.indexedChild?.node ?? currentNode;
        continue;
      }

      if (querySegment !== storeSegment) {
        return null;
      }

      if (currentNode.children.has(querySegment)) {
        currentNode = currentNode.children.get(querySegment) ?? currentNode;
        continue;
      }

      if (this.#matchesIndexedSegment(currentNode, querySegment)) {
        currentNode = currentNode.indexedChild?.node ?? currentNode;
      }
    }

    return {
      projectedSegments: [
        ...capturedWildcardSegments,
        ...storeSegments.slice(querySegments.length),
      ],
    };
  }

  #matchesIndexedSegment(node: SchemaNode, segment: string) {
    const indexedChild = node.indexedChild;

    if (!indexedChild) {
      return false;
    }

    if (indexedChild.wildcard) {
      return true;
    }

    if (indexedChild.allowedValues.has(segment)) {
      return true;
    }

    const numericValue = Number(segment);
    if (Number.isNaN(numericValue)) {
      return false;
    }

    return indexedChild.ranges.some(
      (range: { min: number; max: number }) =>
        numericValue >= range.min && numericValue <= range.max,
    );
  }

  #insertMaterializedValue(
    target: Record<string | symbol, unknown>,
    projectedSegments: string[],
    value: unknown,
  ) {
    if (projectedSegments.length === 0) {
      target[materializedValueSymbol] = value;
      return;
    }

    const [segment, ...remainingSegments] = projectedSegments;
    if (typeof segment !== "string") {
      return;
    }

    const child =
      typeof target[segment] === "object" && target[segment] !== null
        ? (target[segment] as Record<string | symbol, unknown>)
        : {};

    target[segment] = child;
    this.#insertMaterializedValue(child, remainingSegments, value);
  }

  #createRelativePayload(relativeSegments: string[], value: unknown) {
    if (relativeSegments.length === 0) {
      return value;
    }

    const payload: Record<string | symbol, unknown> = {};
    this.#insertMaterializedValue(payload, relativeSegments, value);
    return this.#finalizeMaterializedValue(payload);
  }

  #finalizeMaterializedValue(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }

    const objectValue = value as Record<string | symbol, unknown>;
    const keys = Reflect.ownKeys(objectValue).filter(
      (key) => key !== materializedValueSymbol,
    );
    const hasScalarValue = Object.getOwnPropertySymbols(objectValue).includes(
      materializedValueSymbol,
    );

    if (keys.length === 0 && hasScalarValue) {
      return objectValue[materializedValueSymbol];
    }

    const numericKeys = keys.filter(
      (key) => typeof key === "string" && /^\d+$/.test(key),
    );

    if (keys.length > 0 && numericKeys.length === keys.length) {
      return numericKeys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) =>
          this.#finalizeMaterializedValue(objectValue[key]),
        );
    }

    const result: Record<string, unknown> = {};

    for (const key of keys) {
      if (typeof key !== "string") {
        continue;
      }

      result[key] = this.#finalizeMaterializedValue(
        objectValue[key],
      );
    }

    if (hasScalarValue) {
      return objectValue[materializedValueSymbol];
    }

    return result;
  }

  #getMaterializedStoreValue(
    store: Map<string, unknown>,
    node: SchemaNode,
    path: string[],
  ) {
    const querySegments = this.#getPathSegments(path);
    const exactStoreKey = querySegments.join(".");

    if (
      !querySegments.includes("*") &&
      store.has(exactStoreKey) &&
      this.#storeKeySupportsActiveProduct(exactStoreKey)
    ) {
      return store.get(exactStoreKey);
    }

    const shouldCollectIndexedChildren = Boolean(
      node.indexedChild && !querySegments.includes("*"),
    );
    const materializedResult: Record<string | symbol, unknown> = {};
    let matchCount = 0;
    const activeProductCodes = this.#getActiveProductCodes();
    const storeEntries = [...store.entries()].map(([storeKey, storeValue]) => ({
      skipProductSupportCheck: false,
      storeKey,
      storeValue,
    }));
    const materializableEntries =
      store === this.#configStore
        ? [
            ...this.#getProductDefaultStoreEntries(activeProductCodes),
            ...storeEntries,
          ]
        : storeEntries;

    for (const { skipProductSupportCheck, storeKey, storeValue } of materializableEntries) {
      if (!skipProductSupportCheck && !this.#storeKeySupportsActiveProduct(storeKey)) {
        continue;
      }

      const storeSegments = storeKey.split(".");
      let projectedSegments: string[] | null = null;

      if (shouldCollectIndexedChildren) {
        if (storeSegments.length <= querySegments.length) {
          continue;
        }

        const prefixMatches = querySegments.every(
          (querySegment, index) => storeSegments[index] === querySegment,
        );

        if (!prefixMatches) {
          continue;
        }

        const indexedSegment = storeSegments[querySegments.length];
        if (typeof indexedSegment !== "string") {
          continue;
        }

        if (!this.#matchesIndexedSegment(node, indexedSegment)) {
          continue;
        }

        projectedSegments = [
          indexedSegment,
          ...storeSegments.slice(querySegments.length + 1),
        ];
      } else {
        const match = this.#matchStoreKey(querySegments, storeSegments);

        if (!match) {
          continue;
        }

        projectedSegments = match.projectedSegments;
      }

      if (!projectedSegments) {
        continue;
      }

      matchCount += 1;
      this.#insertMaterializedValue(materializedResult, projectedSegments, storeValue);
    }

    if (matchCount === 0) {
      return undefined;
    }

    return this.#finalizeMaterializedValue(materializedResult);
  }

  #createIndexedBranchPayload(
    store: Map<string, unknown>,
    collectionPathSegments: string[],
    indexSegment: string,
    isGhost = false,
  ) {
    if (isGhost) {
      return {
        ghost: "true",
        id: indexSegment,
      };
    }

    const branchPath = [...collectionPathSegments, indexSegment];
    const branchNode = this.#resolvePathNode(branchPath);
    const branchValue = branchNode
      ? this.#getMaterializedStoreValue(store, branchNode, [...branchPath, "get"])
      : undefined;

    if (typeof branchValue === "object" && branchValue !== null && !Array.isArray(branchValue)) {
      return {
        id: indexSegment,
        ...(branchValue as Record<string, unknown>),
      };
    }

    if (typeof branchValue === "undefined") {
      return {
        id: indexSegment,
      };
    }

    return {
      id: indexSegment,
      value: branchValue,
    };
  }

  #emitScopedChange(
    domain: "Config" | "Status" | "Event",
    store: Map<string, unknown> | null,
    changedPathSegments: string[],
    value: unknown,
    options?: {
      ghostIndexSegment?: string;
    },
  ) {
    for (let scopeLength = changedPathSegments.length; scopeLength >= 1; scopeLength -= 1) {
      const scopePathSegments = changedPathSegments.slice(0, scopeLength);
      const scopeNode = this.#resolvePathNode(scopePathSegments);
      if (!scopeNode) {
        continue;
      }

      let payload: unknown;
      const nextSegment = changedPathSegments[scopeLength];
      const shouldEmitIndexedBranchPayload =
        Boolean(store) &&
        Boolean(scopeNode.indexedChild) &&
        typeof nextSegment === "string" &&
        this.#matchesIndexedSegment(scopeNode, nextSegment);

      if (shouldEmitIndexedBranchPayload && store) {
        payload = this.#createIndexedBranchPayload(
          store,
          scopePathSegments,
          nextSegment,
          options?.ghostIndexSegment === nextSegment &&
            scopeLength + 1 === changedPathSegments.length,
        );
      } else {
        payload = this.#createRelativePayload(
          changedPathSegments.slice(scopeLength),
          value,
        );
      }

      this.emit(`${domain}:${scopePathSegments.join(".")}`, payload);
    }
  }

  #emitStoreChange(
    domain: "Config" | "Status",
    store: Map<string, unknown>,
    path: string[],
    value: unknown,
  ) {
    const changedPathSegments = this.#getPathSegments(path);
    this.#emitScopedChange(domain, store, changedPathSegments, value);
  }

  #normalizeDomainPath(domain: "Config" | "Status", path: string) {
    const segments = path.split(".").filter(Boolean);

    if (segments[0] === domain) {
      return segments;
    }

    return [domain, ...segments];
  }

  #removeStoreBranch(domain: "Config" | "Status", store: Map<string, unknown>, path: string) {
    const normalizedPath = this.#normalizeDomainPath(domain, path);
    const branchKey = normalizedPath.join(".");
    let removed = false;

    for (const storeKey of [...store.keys()]) {
      if (storeKey === branchKey || storeKey.startsWith(`${branchKey}.`)) {
        store.delete(storeKey);
        removed = true;
      }
    }

    if (!removed) {
      return false;
    }

    const parentPath = normalizedPath.slice(0, -1);
    const removedSegment = normalizedPath.at(-1);
    const parentNode = parentPath.length > 0 ? this.#resolvePathNode(parentPath) : null;
    const isIndexedBranchRemoval =
      parentNode !== null &&
      Boolean(parentNode.indexedChild) &&
      typeof removedSegment === "string" &&
      this.#matchesIndexedSegment(parentNode, removedSegment);

    const removalPayload = isIndexedBranchRemoval
      ? {
          ghost: "true",
          id: removedSegment,
        }
      : undefined;

    this.#emitScopedChange(
      domain,
      store,
      normalizedPath,
      removalPayload,
      isIndexedBranchRemoval ? { ghostIndexSegment: removedSegment } : undefined,
    );

    return true;
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

    const activeProductCodes = this.#getActiveProductCodes();
    const activeSignatures = activeProductCodes.length === 0
      ? signatures
      : signatures.filter((signature) =>
          this.#productsIncludeActiveProduct(signature.products, activeProductCodes),
        );

    if (activeSignatures.length === 0) {
      return null;
    }

    const parameterRecord = parameters as Record<string, unknown>;
    let firstBadParameterName: string | null = null;

    for (const signature of activeSignatures) {
      let signatureIsValid = true;
      let signatureHasMissingRequiredParameter = false;

      for (const parameter of signature.parameters) {
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
    const eventSegments = ["Event", ...eventName.split(".").filter(Boolean)];
    this.#emitScopedChange("Event", null, eventSegments, eventData);
  }

  // Helper to remove a status branch in tests, such as a call ending.
  removeStatus(path: string) {
    return this.#removeStoreBranch("Status", this.#statusStore, path);
  }

}

const xapi = new MockXapi();
export default xapi;
