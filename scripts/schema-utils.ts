type SchemaDomain = "Command" | "Configuration" | "Event" | "Status";

interface SchemaValueSpace {
  Max?: string;
  MaxLength?: string;
  Min?: string;
  MinLength?: string;
  Step?: string;
  Values?: string[];
  type?: string;
}

interface SchemaParameter {
  name: string;
  required?: boolean;
  valuespace?: SchemaValueSpace;
}

interface SchemaAttributes {
  default?: unknown;
  params?: SchemaParameter[];
  valuespace?: SchemaValueSpace;
}

export interface SchemaObject {
  attributes?: SchemaAttributes;
  path: string;
  products?: string[];
  type: SchemaDomain;
}

export interface SchemaDocument {
  objects: SchemaObject[];
}

export const schemaValueSpaceKeys = [
  "Max",
  "MaxLength",
  "Min",
  "MinLength",
  "Step",
  "Values",
  "type",
] as const;

function hasOwn(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function keepValuespace(valuespace?: SchemaValueSpace) {
  if (!valuespace) {
    return undefined;
  }

  const kept: Record<string, unknown> = {};

  for (const key of schemaValueSpaceKeys) {
    if (hasOwn(valuespace, key)) {
      kept[key] = valuespace[key];
    }
  }

  return Object.keys(kept).length > 0 ? kept as Partial<SchemaValueSpace> : undefined;
}

export function keepCommandParameter(parameter: SchemaParameter) {
  const kept: SchemaParameter = {
    name: parameter.name,
  };
  const valuespace = keepValuespace(parameter.valuespace);

  if (parameter.required === true) {
    kept.required = true;
  }

  if (valuespace) {
    kept.valuespace = valuespace;
  }

  return kept;
}

export function keepAttributes(schemaObject: SchemaObject) {
  const attributes = schemaObject.attributes ?? {};
  const kept: SchemaAttributes = {};

  if (
    schemaObject.type === "Command" &&
    Array.isArray(attributes.params) &&
    attributes.params.length > 0
  ) {
    kept.params = attributes.params.map(keepCommandParameter);
  }

  if (schemaObject.type === "Configuration") {
    if (hasOwn(attributes, "default")) {
      kept.default = attributes.default;
    }

    const valuespace = keepValuespace(attributes.valuespace);
    if (valuespace) {
      kept.valuespace = valuespace;
    }
  }

  if (schemaObject.type === "Status") {
    const valuespace = keepValuespace(attributes.valuespace);
    if (valuespace) {
      kept.valuespace = valuespace;
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

export function pruneSchema(schema: SchemaDocument): SchemaDocument {
  return {
    objects: schema.objects.map((schemaObject) => {
      const kept: SchemaObject = {
        path: schemaObject.path,
        type: schemaObject.type,
      };
      const attributes = keepAttributes(schemaObject);

      if (Array.isArray(schemaObject.products) && schemaObject.products.length > 0) {
        kept.products = schemaObject.products;
      }

      if (attributes) {
        kept.attributes = attributes;
      }

      return kept;
    }),
  };
}
