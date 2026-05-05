export type HttpClientMethod = "Delete" | "Get" | "Patch" | "Post" | "Put";
export type HttpClientResultBody = "None" | "PlainText" | "Base64";
export type HttpClientNormalizedPathSegment = string | number;

export interface HttpClientHeader {
  Key: string;
  Value: string;
  id: string;
}

export type HttpClientHeadersInit =
  | Record<string, boolean | number | string>
  | Array<
      | [string, boolean | number | string]
      | {
          Key?: boolean | number | string;
          Value?: boolean | number | string;
          id?: boolean | number | string;
          key?: boolean | number | string;
          value?: boolean | number | string;
        }
    >;

export interface HttpClientResponseInit {
  body?: string;
  delayMs?: number;
  headers?: HttpClientHeadersInit;
  statusCode?: number | string;
}

interface HttpClientSuccessResult {
  delayMs: number;
  ok: true;
  value: Record<string, unknown>;
}

interface HttpClientErrorResult {
  delayMs: number;
  error: {
    code: number;
    data: Record<string, unknown>;
    message: string;
  };
  ok: false;
}

export type HttpClientCommandResult = HttpClientSuccessResult | HttpClientErrorResult;

export const defaultHttpClientConnectionLimit = 3;
export const defaultHttpClientResponseDelayMs = 10;
export const httpClientDisabledError = {
  code: 1,
  message: "Use of HttpClient disabled",
};
export const httpClientHttpProtocolNotAllowedError = {
  code: 1,
  message: "HTTP protocol is not allowed",
};
export const httpClientInsecureHttpsNotAllowedError = {
  code: 1,
  message: "Insecure HTTPS not allowed",
};
export const httpClientNoAvailableConnectionsError = {
  code: 1,
  message: "No available http connections",
};

const commandRoot = "HttpClient";
const commandMethods = new Set(["Delete", "Get", "Patch", "Post", "Put"]);
const defaultResultBodyByMethod = new Map<string, HttpClientResultBody>([
  ["Delete", "None"],
  ["Get", "PlainText"],
  ["Patch", "None"],
  ["Post", "None"],
  ["Put", "None"],
]);
const commandError = {
  code: 1,
  message: "Command returned an error.",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHttpClientCommandPath(
  normalizedPath: HttpClientNormalizedPathSegment[],
) {
  return getHttpClientMethod(normalizedPath) !== null;
}

export function getHttpClientCommandPath(
  normalizedPath: HttpClientNormalizedPathSegment[],
) {
  const normalizedStringPath = normalizedPath.map(String);
  const commandPath =
    normalizedStringPath.length === 1 &&
    commandMethods.has(normalizedStringPath[0] ?? "")
      ? [commandRoot, normalizedStringPath[0] ?? ""]
      : normalizedStringPath;

  if (
    commandPath.length !== 2 ||
    commandPath[0] !== commandRoot ||
    !commandMethods.has(commandPath[1] ?? "")
  ) {
    throw new Error(
      `Expected an HttpClient command path or method, received ${normalizedStringPath.join(" ")}.`,
    );
  }

  return commandPath;
}

function getHttpClientMethod(normalizedPath: HttpClientNormalizedPathSegment[]) {
  if (
    normalizedPath.length !== 2 ||
    String(normalizedPath[0]) !== commandRoot
  ) {
    return null;
  }

  const method = String(normalizedPath[1]);
  return commandMethods.has(method) ? method : null;
}

function getHttpClientResultBody(method: string, params?: unknown) {
  if (isPlainObject(params)) {
    const resultBody = params.ResultBody;

    if (
      resultBody === "Base64" ||
      resultBody === "None" ||
      resultBody === "PlainText"
    ) {
      return resultBody;
    }
  }

  return defaultResultBodyByMethod.get(method) ?? "None";
}

function normalizeHttpClientStatusCode(response: HttpClientResponseInit) {
  const statusCode = response.statusCode ?? 200;
  const statusNumber =
    typeof statusCode === "string" ? Number(statusCode) : statusCode;

  if (
    !Number.isInteger(statusNumber) ||
    statusNumber < 100 ||
    statusNumber > 599
  ) {
    throw new Error("HttpClient response statusCode must be an integer from 100 to 599.");
  }

  return String(statusNumber);
}

function normalizeHttpClientResponseDelayMs(response: HttpClientResponseInit) {
  const delayMs = response.delayMs ?? defaultHttpClientResponseDelayMs;

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("HttpClient response delayMs must be a non-negative number.");
  }

  return delayMs;
}

function normalizeHttpClientHeaders(headers: HttpClientHeadersInit | undefined) {
  const entries: Array<{ id?: unknown; key: unknown; value: unknown }> = [];

  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (Array.isArray(header)) {
        entries.push({ key: header[0], value: header[1] });
        continue;
      }

      entries.push({
        id: header.id,
        key: header.Key ?? header.key,
        value: header.Value ?? header.value ?? "",
      });
    }
  } else if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      entries.push({ key, value });
    }
  }

  return entries
    .filter((header) => typeof header.key !== "undefined" && header.key !== "")
    .map((header, index) => ({
      Key: String(header.key),
      Value: String(header.value ?? ""),
      id: String(header.id ?? index + 1),
    }));
}

function getHttpClientBody(response: HttpClientResponseInit) {
  return typeof response.body === "string" ? response.body : "";
}

function formatHttpClientBody(body: string, resultBody: HttpClientResultBody) {
  return resultBody === "Base64"
    ? Buffer.from(body, "utf8").toString("base64")
    : body;
}

function createHttpClientResponsePayload(
  response: HttpClientResponseInit,
  resultBody: HttpClientResultBody,
) {
  const payload: Record<string, unknown> = {
    Headers: normalizeHttpClientHeaders(response.headers),
    StatusCode: normalizeHttpClientStatusCode(response),
    status: "OK",
  };

  if (resultBody !== "None") {
    payload.Body = formatHttpClientBody(
      getHttpClientBody(response),
      resultBody,
    );
  }

  return payload;
}

export function createHttpClientCommandResult({
  normalizedPath,
  params,
  response = {},
}: {
  normalizedPath: HttpClientNormalizedPathSegment[];
  params?: unknown;
  response?: HttpClientResponseInit;
}): HttpClientCommandResult | null {
  const method = getHttpClientMethod(normalizedPath);

  if (!method) {
    return null;
  }

  const resultBody = getHttpClientResultBody(method, params);
  const delayMs = normalizeHttpClientResponseDelayMs(response);
  const payload = createHttpClientResponsePayload(response, resultBody);
  const statusCode = Number(payload.StatusCode);

  if (statusCode >= 200 && statusCode < 300) {
    return {
      delayMs,
      ok: true,
      value: payload,
    };
  }

  const { status: _status, ...errorData } = payload;

  return {
    delayMs,
    error: {
      ...commandError,
      data: errorData,
    },
    ok: false,
  };
}
