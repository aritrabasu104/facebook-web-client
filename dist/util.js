import { createHash } from "node:crypto";
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(item => stableStringify(item)).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
}
