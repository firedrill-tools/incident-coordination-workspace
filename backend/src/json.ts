export function parseJSON(text: string): unknown {
  let i = 0;
  const ws = () => {
    while (/[ \t\r\n]/.test(text[i] ?? "") && i < text.length) i++;
  };
  const str = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i)) as string;
    }
    throw new Error("unterminated JSON string");
  };
  const value = (): unknown => {
    ws();
    if (text[i] === '"') return str();
    if (text[i] === "{") {
      i++;
      ws();
      const result: Record<string, unknown> = Object.create(null);
      if (text[i] === "}") {
        i++;
        return result;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') throw new Error("invalid JSON key");
        const key = str();
        if (Object.hasOwn(result, key))
          throw new Error(`duplicate JSON key: ${key}`);
        ws();
        if (text[i++] !== ":") throw new Error("invalid JSON object");
        result[key] = value();
        ws();
        const sep = text[i++];
        if (sep === "}") return result;
        if (sep !== ",") throw new Error("invalid JSON object");
      }
    }
    if (text[i] === "[") {
      i++;
      ws();
      const result: unknown[] = [];
      if (text[i] === "]") {
        i++;
        return result;
      }
      for (;;) {
        result.push(value());
        ws();
        const sep = text[i++];
        if (sep === "]") return result;
        if (sep !== ",") throw new Error("invalid JSON array");
      }
    }
    const match =
      /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      );
    if (!match) throw new Error("invalid JSON value");
    i += match[0].length;
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed === "number" && !Number.isFinite(parsed))
      throw new Error("nonfinite JSON number");
    return parsed;
  };
  const parsed = value();
  ws();
  if (i !== text.length) throw new Error("trailing JSON data");
  return parsed;
}
