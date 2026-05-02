import { readFileSync } from "fs";

export type SchemaDomain = "Command" | "Configuration" | "Status" | "Event";

interface SchemaParameterValueSpace {
  Max?: string;
  MaxLength?: string;
  Min?: string;
  MinLength?: string;
  Step?: string;
  Values?: string[];
  type?: string;
}

interface SchemaValueAttributes {
  default?: unknown;
  valuespace?: SchemaParameterValueSpace;
}

interface SchemaParameter {
  name: string;
  required?: boolean;
  valuespace?: SchemaParameterValueSpace;
}

interface SchemaObject {
  attributes?: SchemaValueAttributes & {
    params?: SchemaParameter[];
  };
  path: string;
  products?: string[];
  type: SchemaDomain;
}

interface SchemaDocument {
  objects: SchemaObject[];
}

interface IndexedConstraint {
  allowedValues: Set<string>;
  ranges: Array<{ max: number; min: number }>;
  wildcard: boolean;
}

interface IndexedChild extends IndexedConstraint {
  node: SchemaNode;
}

export interface SchemaNode {
  children: Map<string, SchemaNode>;
  indexedChild?: IndexedChild;
  terminal: boolean;
}

export type PathPatternSegment =
  | { type: "literal"; value: string }
  | { type: "index"; allowedValues: Set<string>; ranges: Array<{ max: number; min: number }>; wildcard: boolean };

export interface ProductPathPattern {
  path: PathPatternSegment[];
  products: Set<string>;
}

export interface CommandParameterSignature {
  name: string;
  required: boolean;
  valuespace?: SchemaParameterValueSpace;
}

export interface ProductScopedCommandSignature {
  parameters: CommandParameterSignature[];
  products: Set<string>;
}

export interface ProductScopedValue {
  path: PathPatternSegment[];
  products: Set<string>;
  valuespace?: SchemaParameterValueSpace;
}

export interface ProductScopedDefaultValue {
  path: string[];
  products: Set<string>;
  value: unknown;
}

export interface SchemaModel {
  commandSignatures: Map<string, ProductScopedCommandSignature[]>;
  configValues: ProductScopedValue[];
  defaults: Map<string, unknown>;
  docs: Map<string, unknown>;
  majorVersion: number;
  name: string;
  productCodes: Set<string>;
  productDefaults: ProductScopedDefaultValue[];
  productPaths: Map<SchemaDomain, ProductPathPattern[]>;
  roots: Record<SchemaDomain, SchemaNode>;
  statusValues: ProductScopedValue[];
}

export interface SchemaCatalogEntry {
  majorVersion: number;
  model: SchemaModel;
  name: string;
}

export interface SchemaCatalog {
  defaultModel: SchemaModel;
  getModelForProductCodes(productCodes: string[]): SchemaModel;
  models: SchemaCatalogEntry[];
  roots: Record<SchemaDomain, SchemaNode>;
}

function createSchemaNode(): SchemaNode {
  return {
    children: new Map(),
    terminal: false,
  };
}

function getOrCreateChild(node: SchemaNode, segment: string) {
  const existingChild = node.children.get(segment);
  if (existingChild) {
    return existingChild;
  }

  const child = createSchemaNode();
  node.children.set(segment, child);
  return child;
}

function getOrCreateIndexedChild(node: SchemaNode) {
  if (!node.indexedChild) {
    node.indexedChild = {
      allowedValues: new Set(),
      node: createSchemaNode(),
      ranges: [],
      wildcard: false,
    };
  }

  return node.indexedChild;
}

function addIndexedConstraint(indexedChild: IndexedConstraint, token: string) {
  if (token === "n") {
    indexedChild.wildcard = true;
    return;
  }

  const rangeMatch = token.match(/^(\d+)\.\.(\d+)$/);
  if (rangeMatch) {
    indexedChild.ranges.push({
      max: Number(rangeMatch[2]),
      min: Number(rangeMatch[1]),
    });
    return;
  }

  indexedChild.allowedValues.add(token);
}

function addPath(root: SchemaNode, schemaPath: string) {
  let currentNode = root;

  for (const segment of schemaPath.split(" ")) {
    const indexedMatch = segment.match(/^([^\[]+)\[(.+)\]$/);
    if (!indexedMatch) {
      currentNode = getOrCreateChild(currentNode, segment);
      continue;
    }

    const baseSegment = indexedMatch[1];
    const indexToken = indexedMatch[2];
    if (!baseSegment || !indexToken) {
      continue;
    }

    const indexedParent = getOrCreateChild(currentNode, baseSegment);
    const indexedChild = getOrCreateIndexedChild(indexedParent);
    addIndexedConstraint(indexedChild, indexToken);
    currentNode = indexedChild.node;
  }

  currentNode.terminal = true;
}

function createProductSet(products?: string[]) {
  return new Set(products ?? []);
}

function parsePathPattern(schemaPath: string) {
  const patternSegments: PathPatternSegment[] = [];

  for (const segment of schemaPath.split(" ")) {
    const indexedMatch = segment.match(/^([^\[]+)\[(.+)\]$/);

    if (!indexedMatch) {
      patternSegments.push({
        type: "literal",
        value: segment,
      });
      continue;
    }

    const baseSegment = indexedMatch[1];
    const indexToken = indexedMatch[2];
    if (!baseSegment || !indexToken) {
      continue;
    }

    patternSegments.push({
      type: "literal",
      value: baseSegment,
    });

    const indexPattern: Extract<PathPatternSegment, { type: "index" }> = {
      allowedValues: new Set(),
      ranges: [],
      type: "index",
      wildcard: false,
    };
    addIndexedConstraint(indexPattern, indexToken);
    patternSegments.push(indexPattern);
  }

  return patternSegments;
}

function expandIndexToken(indexToken: string) {
  const rangeMatch = indexToken.match(/^(\d+)\.\.(\d+)$/);

  if (!rangeMatch) {
    return [indexToken];
  }

  const min = Number(rangeMatch[1]);
  const max = Number(rangeMatch[2]);
  const expandedTokens: string[] = [];

  for (let value = min; value <= max; value += 1) {
    expandedTokens.push(String(value));
  }

  return expandedTokens;
}

function expandSchemaPath(schemaPath: string) {
  let expandedPaths: string[][] = [[]];

  for (const segment of schemaPath.split(" ")) {
    const indexedMatch = segment.match(/^([^\[]+)\[(.+)\]$/);

    if (!indexedMatch) {
      expandedPaths = expandedPaths.map((pathSegments) => [
        ...pathSegments,
        segment,
      ]);
      continue;
    }

    const baseSegment = indexedMatch[1];
    const indexToken = indexedMatch[2];
    if (!baseSegment || !indexToken) {
      continue;
    }

    const indexValues = expandIndexToken(indexToken);
    expandedPaths = expandedPaths.flatMap((pathSegments) =>
      indexValues.map((indexValue) => [
        ...pathSegments,
        baseSegment,
        indexValue,
      ]),
    );
  }

  return expandedPaths;
}

function createDocValueSpace(
  valuespace?: SchemaParameterValueSpace,
  defaultValue?: unknown,
) {
  if (!valuespace) {
    return undefined;
  }

  const docValueSpace: Record<string, unknown> = {};

  if (typeof defaultValue !== "undefined") {
    docValueSpace.default = defaultValue;
  }

  if (valuespace.Values) {
    docValueSpace.Value = valuespace.Values;
  }

  if (valuespace.Max) {
    docValueSpace.max = valuespace.Max;
  }

  if (valuespace.MaxLength) {
    docValueSpace.maxLength = valuespace.MaxLength;
  }

  if (valuespace.Min) {
    docValueSpace.min = valuespace.Min;
  }

  if (valuespace.MinLength) {
    docValueSpace.minLength = valuespace.MinLength;
  }

  if (valuespace.type) {
    docValueSpace.type = valuespace.type;
  }

  return docValueSpace;
}

function createCommandParameterDoc(parameter: SchemaParameter) {
  const parameterDoc: Record<string, unknown> = {
    id: "1",
    required: parameter.required ? "True" : "False",
  };

  const valueSpace = createDocValueSpace(parameter.valuespace);

  if (valueSpace) {
    parameterDoc.ValueSpace = valueSpace;
  }

  return parameterDoc;
}

function createCommandDocResult(schemaObject: SchemaObject) {
  const docResult: Record<string, unknown> = {
    access: "public-api",
    command: "True",
    description: "",
    privacyimpact: "False",
    role: "Admin;Integrator;RoomControl",
  };

  for (const parameter of schemaObject.attributes?.params ?? []) {
    docResult[parameter.name] = createCommandParameterDoc(parameter);
  }

  return docResult;
}

function createConfigurationDocResult(schemaObject: SchemaObject) {
  const docResult: Record<string, unknown> = {
    access: "public-api",
    description: "",
    include_for_extension: "mtr",
    read: "Admin;Integrator;RoomControl;User",
    role: "Admin",
  };

  const valueSpace = createDocValueSpace(
    schemaObject.attributes?.valuespace,
    schemaObject.attributes?.default,
  );

  if (valueSpace) {
    docResult.ValueSpace = valueSpace;
  }

  return docResult;
}

function createStatusDocResult(schemaObject: SchemaObject) {
  const docResult: Record<string, unknown> = {
    access: "public-api",
    description: "",
    include_for_extension: "mtr",
    privacyimpact: "False",
    read: "Admin;Integrator;User",
  };

  const valueSpace = createDocValueSpace(schemaObject.attributes?.valuespace);

  if (valueSpace) {
    docResult.ValueSpace = valueSpace;
  }

  return docResult;
}

function createEventDocResult(schemaObject: SchemaObject) {
  const docResult: Record<string, unknown> = {
    access: "public-api",
    event: "True",
    include_for_extension: "mtr",
    read: "Admin;User;Integrator;RoomControl",
  };

  if (schemaObject.path === "UserInterface Extensions Widget Action") {
    return {
      Origin: { type: "literal" },
      PeripheralId: { optional: "True", type: "string" },
      Type: { type: "string" },
      Value: { type: "string" },
      WidgetId: { type: "string" },
      ...docResult,
    };
  }

  return docResult;
}

function createSchemaDocResult(schemaObject: SchemaObject) {
  if (schemaObject.type === "Command") {
    return createCommandDocResult(schemaObject);
  }

  if (schemaObject.type === "Configuration") {
    return createConfigurationDocResult(schemaObject);
  }

  if (schemaObject.type === "Event") {
    return createEventDocResult(schemaObject);
  }

  return createStatusDocResult(schemaObject);
}

function addDocResults(docs: Map<string, unknown>, schemaObject: SchemaObject) {
  const docResult = createSchemaDocResult(schemaObject);

  for (const expandedPath of expandSchemaPath(schemaObject.path)) {
    const pathKey = expandedPath.join(".");

    docs.set([schemaObject.type, pathKey].join("."), docResult);

    if (schemaObject.type === "Configuration") {
      docs.set(["Config", pathKey].join("."), docResult);
    }
  }
}

function addProductPathPattern(
  productPaths: Map<SchemaDomain, ProductPathPattern[]>,
  schemaObject: SchemaObject,
) {
  const patterns = productPaths.get(schemaObject.type);

  if (!patterns) {
    return;
  }

  const pathPattern = parsePathPattern(schemaObject.path);

  patterns.push({
    path: pathPattern,
    products: createProductSet(schemaObject.products),
  });
}

function productScopedValueFromAttributes(schemaObject: SchemaObject) {
  const productScopedValue: ProductScopedValue = {
    path: parsePathPattern(schemaObject.path),
    products: createProductSet(schemaObject.products),
  };

  if (schemaObject.attributes?.valuespace) {
    productScopedValue.valuespace = schemaObject.attributes.valuespace;
  }

  return productScopedValue;
}

export function resolveSchemaChild(node: SchemaNode, prop: string) {
  const directChild = node.children.get(prop);
  if (directChild) {
    return directChild;
  }

  const indexedChild = node.indexedChild;
  if (!indexedChild) {
    return undefined;
  }

  if (prop === "*") {
    return indexedChild.node;
  }

  if (indexedChild.wildcard) {
    return indexedChild.node;
  }

  if (indexedChild.allowedValues.has(prop)) {
    return indexedChild.node;
  }

  const numericValue = Number(prop);
  if (!Number.isNaN(numericValue)) {
    for (const range of indexedChild.ranges) {
      if (numericValue >= range.min && numericValue <= range.max) {
        return indexedChild.node;
      }
    }
  }

  return undefined;
}

function createSchemaModel(
  schema: SchemaDocument,
  metadata: { majorVersion?: number; name?: string } = {},
) {
  const roots: Record<SchemaDomain, SchemaNode> = {
    Command: createSchemaNode(),
    Configuration: createSchemaNode(),
    Event: createSchemaNode(),
    Status: createSchemaNode(),
  };
  const commandSignatures = new Map<string, ProductScopedCommandSignature[]>();
  const configValues: ProductScopedValue[] = [];
  const defaults = new Map<string, unknown>();
  const docs = new Map<string, unknown>();
  const productCodes = new Set<string>();
  const productDefaults: ProductScopedDefaultValue[] = [];
  const productPaths: Map<SchemaDomain, ProductPathPattern[]> = new Map([
    ["Command", []],
    ["Configuration", []],
    ["Event", []],
    ["Status", []],
  ]);
  const statusValues: ProductScopedValue[] = [];

  for (const schemaObject of schema.objects) {
    for (const productCode of schemaObject.products ?? []) {
      productCodes.add(productCode);
    }

    addPath(roots[schemaObject.type], schemaObject.path);
    addDocResults(docs, schemaObject);
    addProductPathPattern(productPaths, schemaObject);

    if (schemaObject.type === "Command") {
      const commandPath = ["Command", ...schemaObject.path.split(" ")].join(".");
      const signatures = commandSignatures.get(commandPath) ?? [];
      const params = (schemaObject.attributes?.params ?? []).map((parameter) => {
        const commandParameter: CommandParameterSignature = {
          name: parameter.name,
          required: parameter.required ?? false,
        };

        if (parameter.valuespace) {
          commandParameter.valuespace = parameter.valuespace;
        }

        return commandParameter;
      });

      signatures.push({
        parameters: params,
        products: createProductSet(schemaObject.products),
      });
      commandSignatures.set(commandPath, signatures);
    }

    if (schemaObject.type === "Configuration") {
      configValues.push(productScopedValueFromAttributes(schemaObject));
    }

    if (schemaObject.type === "Status") {
      statusValues.push(productScopedValueFromAttributes(schemaObject));
    }

    if (schemaObject.type !== "Configuration") {
      continue;
    }

    if (typeof schemaObject.attributes?.default === "undefined") {
      continue;
    }

    const defaultPath = ["Config", ...schemaObject.path.split(" ")].join(".");
    defaults.set(defaultPath, schemaObject.attributes.default);

    for (const expandedPath of expandSchemaPath(schemaObject.path)) {
      productDefaults.push({
        path: expandedPath,
        products: createProductSet(schemaObject.products),
        value: schemaObject.attributes.default,
      });
    }
  }

  return {
    commandSignatures,
    configValues,
    defaults,
    docs,
    majorVersion: metadata.majorVersion ?? 0,
    name: metadata.name ?? "schema",
    productCodes,
    productDefaults,
    productPaths,
    roots,
    statusValues,
  } satisfies SchemaModel;
}

function compareCatalogEntries(left: SchemaCatalogEntry, right: SchemaCatalogEntry) {
  return right.majorVersion - left.majorVersion;
}

function createSchemaCatalog(schemas: Array<{
  majorVersion?: number;
  name?: string;
  schema: SchemaDocument;
}>) {
  const entries = schemas
    .map((schemaEntry) => {
      const majorVersion = schemaEntry.majorVersion ?? 0;
      const name = schemaEntry.name ?? `RoomOS ${majorVersion}`;
      const model = createSchemaModel(schemaEntry.schema, {
        majorVersion,
        name,
      });

      return {
        majorVersion,
        model,
        name,
      };
    })
    .sort(compareCatalogEntries);

  const defaultModel = entries[0]?.model;

  if (!defaultModel) {
    throw new Error("No RoomOS schemas were bundled with jest-mock-xapi.");
  }

  const combinedModel = createSchemaModel(
    {
      objects: schemas.flatMap((schemaEntry) => schemaEntry.schema.objects),
    },
    {
      majorVersion: defaultModel.majorVersion,
      name: "combined",
    },
  );

  return {
    defaultModel,
    getModelForProductCodes(productCodes: string[]) {
      if (productCodes.length === 0) {
        return defaultModel;
      }

      return (
        entries.find((entry) =>
          productCodes.some((productCode) => entry.model.productCodes.has(productCode)),
        )?.model ?? defaultModel
      );
    },
    models: entries,
    roots: combinedModel.roots,
  } satisfies SchemaCatalog;
}

export function loadSchemaModel() {
  const schemaUrl = new URL("../schemas/schema.json", import.meta.url);
  const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));

  if (Array.isArray(schema.schemas)) {
    return createSchemaCatalog(
      schema.schemas.map((schemaEntry: any) => ({
        majorVersion: schemaEntry.majorVersion,
        name: schemaEntry.name,
        schema: schemaEntry.schema,
      })),
    );
  }

  return createSchemaCatalog([
    {
      majorVersion: 0,
      name: "schema",
      schema: schema as SchemaDocument,
    },
  ]);
}
