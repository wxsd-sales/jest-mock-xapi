import { jest } from "@jest/globals";
import { resolveSchemaChild, type SchemaNode } from "./schema.ts";

type ProxyOperation = "call" | "emit" | "get" | "on" | "set";

interface XapiErrorPayload {
  code: number;
  message: string;
}

interface ProxyInvocation {
  args: any[];
  node: SchemaNode;
  operation: ProxyOperation;
  path: string[];
}

interface SchemaProxyOptions {
  allowedMethods?: ProxyOperation[];
  callable?: boolean;
  invalidError?: XapiErrorPayload | undefined;
  isInvalid?: boolean;
  invoke: (invocation: ProxyInvocation) => unknown;
  node: SchemaNode;
  operation?: Exclude<ProxyOperation, "call">;
  path: string[];
}

const proxyCache = new Map<string, unknown>();

const passthroughProps = new Set([
  "_isMockFunction",
  "getMockImplementation",
  "mock",
  "mockClear",
  "mockReset",
  "mockRestore",
  "mockReturnValueOnce",
  "mockResolvedValueOnce",
  "mockRejectedValueOnce",
  "mockReturnValue",
  "mockResolvedValue",
  "mockRejectedValue",
  "mockImplementationOnce",
  "mockImplementation",
  "mockReturnThis",
  "mockName",
  "getMockName",
  "withImplementation",
  "bind",
  "apply",
  "call",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);

function createRejectedInvalidPathResult(invalidError: XapiErrorPayload) {
  return Promise.reject({
    code: invalidError.code,
    message: invalidError.message,
  });
}

export default function proxy(options: SchemaProxyOptions) {
  const {
    allowedMethods = [],
    callable = false,
    invalidError,
    isInvalid = false,
    invoke,
    node,
    operation,
    path,
  } = options;
  const pathKey = `${path.join(".")}::${operation ?? "path"}`;

  if (proxyCache.has(pathKey)) {
    return proxyCache.get(pathKey);
  }

  const mockFn = jest.fn((...args: any[]) => {
    if (isInvalid && invalidError) {
      return createRejectedInvalidPathResult(invalidError);
    }

    return invoke({
      args,
      node,
      operation: operation ?? "call",
      path,
    });
  });

  const proxiedMock = new Proxy(mockFn, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }

      if (prop === "then") {
        return undefined;
      }

      if (prop === "calls") {
        return {
          all: () => target.mock.calls.map((args) => ({ args })),
          count: () => target.mock.calls.length,
        };
      }

      if (prop === "all") {
        return () => target.mock.calls.map((args) => ({ args }));
      }

      if (isInvalid) {
        if (operation) {
          return proxy({
            allowedMethods,
            callable: true,
            invalidError,
            isInvalid: true,
            invoke,
            node,
            operation,
            path: [...path, prop],
          });
        }

        if (allowedMethods.includes(prop as ProxyOperation)) {
          return proxy({
            allowedMethods,
            callable: true,
            invalidError,
            isInvalid: true,
            invoke,
            node,
            operation: prop as Exclude<ProxyOperation, "call">,
            path: [...path, prop],
          });
        }

        return proxy({
          allowedMethods,
          callable: allowedMethods.length === 0,
          invalidError,
          isInvalid: true,
          invoke,
          node,
          path: [...path, prop],
        });
      }

      if (
        allowedMethods.includes(prop as ProxyOperation) &&
        (node.terminal || prop === "get" || prop === "on")
      ) {
        return proxy({
          callable: true,
          invoke,
          node,
          operation: prop as Exclude<ProxyOperation, "call">,
          path: [...path, prop],
        });
      }

      if (passthroughProps.has(prop) || prop in target) {
        return Reflect.get(target, prop, target);
      }

      const childNode = resolveSchemaChild(node, prop);
      if (childNode) {
        return proxy({
          allowedMethods,
          callable: childNode.terminal && allowedMethods.length === 0,
          invoke,
          node: childNode,
          path: [...path, prop],
        });
      }

      return proxy({
        allowedMethods,
        callable: allowedMethods.length === 0,
        invalidError,
        isInvalid: true,
        invoke,
        node,
        path: [...path, prop],
      });
    },

    apply(target, thisArg, args) {
      if (isInvalid && invalidError) {
        return createRejectedInvalidPathResult(invalidError);
      }

      if (!callable) {
        throw new Error(`xapi path is not callable: ${path.join(".")}`);
      }

      return Reflect.apply(target, thisArg, args);
    },
  });

  proxyCache.set(pathKey, proxiedMock);
  return proxiedMock;
}
