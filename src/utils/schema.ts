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

export interface SchemaModel {
  commandSignatures: Map<string, ProductScopedCommandSignature[]>;
  configValues: ProductScopedValue[];
  defaults: Map<string, unknown>;
  productPaths: Map<SchemaDomain, ProductPathPattern[]>;
  roots: Record<SchemaDomain, SchemaNode>;
  statusValues: ProductScopedValue[];
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

export function loadSchemaModel() {
  const schemaUrl = new URL("../schemas/26.4.1 March 2026.json", import.meta.url);
  const schema = JSON.parse(
    readFileSync(schemaUrl, "utf8"),
  ) as SchemaDocument;

  const roots: Record<SchemaDomain, SchemaNode> = {
    Command: createSchemaNode(),
    Configuration: createSchemaNode(),
    Event: createSchemaNode(),
    Status: createSchemaNode(),
  };
  const commandSignatures = new Map<string, ProductScopedCommandSignature[]>();
  const configValues: ProductScopedValue[] = [];
  const defaults = new Map<string, unknown>();
  const productPaths: Map<SchemaDomain, ProductPathPattern[]> = new Map([
    ["Command", []],
    ["Configuration", []],
    ["Event", []],
    ["Status", []],
  ]);
  const statusValues: ProductScopedValue[] = [];

  for (const schemaObject of schema.objects) {
    addPath(roots[schemaObject.type], schemaObject.path);
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
  }

  return {
    commandSignatures,
    configValues,
    defaults,
    productPaths,
    roots,
    statusValues,
  } satisfies SchemaModel;
}
