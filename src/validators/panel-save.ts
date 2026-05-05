type NormalizedPathSegment = string | number;
const panelSavePath = ["UserInterface", "Extensions", "Panel", "Save"];
const failedToParseXmlError = {
  code: 1,
  message: "Failed to parse xml",
};

function isPanelSavePath(normalizedPath: NormalizedPathSegment[]) {
  return (
    normalizedPath.length === panelSavePath.length &&
    normalizedPath.every((segment, index) => String(segment) === panelSavePath[index])
  );
}

function hasInvalidXmlEntity(value: string) {
  return /&(?!(?:amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-fA-F]+);)/.test(value);
}

function hasBalancedAttributeQuotes(value: string) {
  let quote: "\"" | "'" | null = null;

  for (const char of value) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    }
  }

  return quote === null;
}

function getTagName(value: string) {
  return value.match(/^([A-Za-z_][A-Za-z0-9:._-]*)/)?.[1] ?? null;
}

function createPanelCount(body: unknown) {
  if (typeof body !== "string" || body.trim() === "") {
    return null;
  }

  let index = 0;
  let panelCount = 0;
  let rootClosed = false;
  let rootName: string | null = null;
  const stack: string[] = [];

  while (index < body.length) {
    const tagStart = body.indexOf("<", index);
    const text = tagStart === -1 ? body.slice(index) : body.slice(index, tagStart);

    if (stack.length === 0 && text.trim() !== "") {
      return null;
    }

    if (hasInvalidXmlEntity(text)) {
      return null;
    }

    if (tagStart === -1) {
      break;
    }

    if (body.startsWith("<!--", tagStart)) {
      const commentEnd = body.indexOf("-->", tagStart + 4);

      if (commentEnd === -1) {
        return null;
      }

      index = commentEnd + 3;
      continue;
    }

    if (body.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = body.indexOf("]]>", tagStart + 9);

      if (cdataEnd === -1) {
        return null;
      }

      index = cdataEnd + 3;
      continue;
    }

    if (body.startsWith("<?", tagStart)) {
      const declarationEnd = body.indexOf("?>", tagStart + 2);

      if (declarationEnd === -1) {
        return null;
      }

      index = declarationEnd + 2;
      continue;
    }

    const tagEnd = body.indexOf(">", tagStart + 1);

    if (tagEnd === -1) {
      return null;
    }

    const rawTag = body.slice(tagStart + 1, tagEnd).trim();

    if (!rawTag) {
      return null;
    }

    if (rawTag.startsWith("!")) {
      index = tagEnd + 1;
      continue;
    }

    if (rawTag.startsWith("/")) {
      const closingTag = rawTag.slice(1).trim();
      const closingName = getTagName(closingTag);

      if (!closingName || closingTag.slice(closingName.length).trim() !== "") {
        return null;
      }

      if (stack.at(-1) !== closingName) {
        return null;
      }

      stack.pop();

      if (stack.length === 0) {
        rootClosed = true;
      }

      index = tagEnd + 1;
      continue;
    }

    const selfClosing = /\/\s*$/.test(rawTag);
    const openingTag = selfClosing
      ? rawTag.replace(/\/\s*$/, "").trimEnd()
      : rawTag;
    const tagName = getTagName(openingTag);

    if (!tagName) {
      return null;
    }

    const attributes = openingTag.slice(tagName.length);

    if (
      hasInvalidXmlEntity(attributes) ||
      !hasBalancedAttributeQuotes(attributes)
    ) {
      return null;
    }

    if (stack.length === 0) {
      if (rootName !== null && rootClosed) {
        return null;
      }

      rootName = tagName;
    }

    if (
      tagName === "Panel" &&
      stack.length === 1 &&
      stack[0] === "Extensions"
    ) {
      panelCount += 1;
    }

    if (!selfClosing) {
      stack.push(tagName);
    } else if (stack.length === 0) {
      rootClosed = true;
    }

    index = tagEnd + 1;
  }

  if (!rootName || stack.length > 0) {
    return null;
  }

  return rootName === "Extensions" ? panelCount : 0;
}

export function validatePanelSaveBody(
  normalizedPath: NormalizedPathSegment[],
  body: unknown,
) {
  if (!isPanelSavePath(normalizedPath)) {
    return null;
  }

  const panelCount = createPanelCount(body);

  if (panelCount === null) {
    return { ...failedToParseXmlError };
  }

  if (panelCount !== 1) {
    return {
      code: 1,
      message: `Expected a single Panel, got ${panelCount}`,
    };
  }

  return null;
}
