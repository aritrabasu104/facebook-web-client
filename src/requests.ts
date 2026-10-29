import { assertContract, type FacebookContract } from "./contracts.js";
import { facebookApiRequestSha256, type FacebookTargetBindings } from "./client.js";

export type FacebookMutationIdentity = { actorId: string; targetId: string; targets?: FacebookTargetBindings };
function replaceExisting(root: Record<string, unknown>, path: string, value: string): void {
  if (!path.startsWith("/") || path === "/") throw new Error("A verified JSON pointer is required");
  const keys = path.slice(1).split("/").map(k => k.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  if (keys.some(k => ["__proto__", "prototype", "constructor"].includes(k) || !k)) throw new Error("Unsafe Facebook template pointer");
  let parent: any = root;
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) throw new Error("Observed Facebook template field is missing");
    parent = parent[key];
  }
  const key = keys.at(-1)!;
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key) || typeof parent[key] !== "string") throw new Error("Observed Facebook template field is missing or changed");
  parent[key] = value;
}

/** Bind only observed fields in an original reviewed wire template. No input
 * schema, actor alias, content, idempotency token or execution ID is invented. */
function bind(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity) {
  assertContract(contract);
  if (contract.kind !== "mutation" || !/^\d+$/u.test(identity.actorId) || !identity.targetId) throw new Error("A mutation and exact native identities are required");
  const variables = structuredClone(template), named = Object.entries(contract.targetVariableBindings ?? {});
  if (!contract.targetVariablePaths?.length && !named.length) throw new Error("Observed target binding paths are required");
  if (contract.operation !== "comments.create" && identity.targets?.groupId && identity.targets.groupId !== identity.targetId) throw new Error("Group target bindings disagree");
  const allPaths = [...(contract.targetVariablePaths ?? []), ...(contract.actorVariablePaths ?? []), ...named.flatMap(([, paths]) => paths ?? [])];
  if (new Set(allPaths).size !== allPaths.length) throw new Error("Facebook template bindings overlap");
  if (contract.operation === "comments.create" && (!identity.targets?.groupId || !identity.targets.postId || !identity.targets.feedbackId ||
      identity.targetId !== identity.targets.postId || !contract.targetVariableBindings?.groupId?.length || !contract.targetVariableBindings.feedbackId?.length)) {
    throw new Error("Comments require distinct native Group, canonical post and feedback bindings");
  }
  if (contract.operation === "comments.create" && contract.targetVariablePaths?.length) throw new Error("Comment identities cannot share the legacy equal-target binding");
  for (const path of contract.targetVariablePaths ?? []) replaceExisting(variables, path, identity.targetId);
  for (const [name, paths] of named) {
    const value = identity.targets?.[name as keyof FacebookTargetBindings];
    if (typeof value !== "string" || !value || value.length > 2_048 || /[\u0000-\u0020]/u.test(value) || !paths?.length) throw new Error("Native Facebook named target identity is missing");
    for (const path of paths) replaceExisting(variables, path, value);
  }
  for (const path of contract.actorVariablePaths ?? []) replaceExisting(variables, path, identity.actorId);
  return { variables, requestSha256: facebookApiRequestSha256(contract, variables) };
}
export function prepareFacebookGroupJoin(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity) {
  if (contract.operation !== "groups.join" || !/^\d+$/u.test(identity.targetId)) throw new Error("An exact Group join contract is required");
  return bind(contract, template, identity);
}
export function prepareFacebookPost(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity) {
  if (contract.operation !== "posts.create" || !/^\d+$/u.test(identity.targetId)) throw new Error("An exact Group post contract is required");
  return bind(contract, template, identity);
}
export function prepareFacebookComment(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity) {
  if (contract.operation !== "comments.create") throw new Error("An exact comment contract is required");
  return bind(contract, template, identity);
}
