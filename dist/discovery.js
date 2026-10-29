import { parse } from "acorn";
import { sha256 } from "./util.js";
import { operationForName } from "./contracts.js";
function walk(node, visit) {
    visit(node);
    for (const value of Object.values(node)) {
        const children = Array.isArray(value) ? value : [value];
        for (const child of children)
            if (child && typeof child === "object" && typeof child.type === "string" && typeof child.start === "number")
                walk(child, visit);
    }
}
function ownString(node, key) {
    const props = node.properties.filter(p => p.type === "Property" && !p.computed &&
        (p.key?.name ?? p.key?.value) === key && p.value?.type === "Literal" && typeof p.value.value === "string");
    return props.length === 1 ? props[0].value.value : undefined;
}
/** Parse Relay definitions as data. Downloaded JavaScript is never executed. */
export function discoverRelayContracts(source, observedAt) {
    const file = parse(source, { ecmaVersion: "latest", sourceType: "script" });
    const modules = new Map();
    walk(file, node => {
        if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "__d" &&
            node.arguments?.[0]?.type === "Literal" && typeof node.arguments[0].value === "string") {
            const name = node.arguments[0].value;
            if (modules.has(name))
                throw new Error("Conflicting Facebook module definitions");
            modules.set(name, node);
        }
    });
    function exportedId(name) {
        const node = modules.get(name);
        if (!node)
            return undefined;
        const ids = new Set();
        walk(node, n => {
            if (n.type === "AssignmentExpression" && n.operator === "=" && n.left?.type === "MemberExpression" &&
                (n.left.property?.name ?? n.left.property?.value) === "exports" && n.right?.type === "Literal" &&
                typeof n.right.value === "string" && /^\d+$/u.test(n.right.value))
                ids.add(n.right.value);
        });
        return ids.size === 1 ? [...ids][0] : undefined;
    }
    const found = [];
    for (const [moduleName, node] of modules) {
        if (!moduleName.endsWith(".graphql"))
            continue;
        const name = moduleName.slice(0, -8), operation = operationForName(name);
        if (!operation)
            continue;
        const params = [];
        walk(node, n => {
            if (n.type === "Property" && !n.computed && (n.key?.name ?? n.key?.value) === "params" && n.value?.type === "ObjectExpression")
                params.push(n.value);
        });
        if (params.length !== 1)
            continue;
        const kind = ownString(params[0], "operationKind");
        if (kind !== "query" && kind !== "mutation")
            continue;
        const id = ownString(params[0], "id") ?? exportedId(name + "_facebookRelayOperation");
        if (!id || !/^\d+$/u.test(id))
            continue;
        const variables = new Set(), response = new Set();
        walk(node, n => {
            if (n.type !== "ObjectExpression")
                return;
            const ownKind = ownString(n, "kind"), ownName = ownString(n, "name");
            if (ownKind === "LocalArgument" && ownName)
                variables.add(ownName);
            if (["ScalarField", "LinkedField"].includes(ownKind ?? "") && ownName)
                response.add(ownName);
        });
        found.push({ operation, name, documentId: id, kind, variables: [...variables].sort(), responseFields: [...response].sort(),
            evidence: "source-derived", sourceSha256: sha256(source), sourceModule: moduleName, observedAt,
            limitations: ["Static client definition; authenticated API success and complete server input schema are unverified."] });
    }
    return found;
}
