type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (isPlainObject(value)) {
    const out: Record<string, JsonValue> = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      out[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return null;
}

export function canonicalizeJsonValue(value: unknown): JsonValue {
  return normalizeValue(value);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}
