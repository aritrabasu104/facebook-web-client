import type { FacebookContract } from "./contracts.js";
import type { FacebookGraphqlResult } from "./protocol.js";

/** A mutation response is a readback candidate, never delivery or Join credit.
 * Only the original native owner can establish the actor and final outcome. */
export type FacebookMutationObservation = {
  kind: "candidate"; resultId: string; actorId?: string;
  membershipHint?: "joined" | "pending"; requiresNativeReadback: true;
} | { kind: "unknown" | "provider-error"; reason: string; requiresNativeReadback: true };

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}
function identity(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 &&
    !/^client:/u.test(value) && !/[\u0000-\u0020]/u.test(value) ? value : undefined;
}

/** Exact response paths observed in the retained Relay artifacts. Pending
 * moderation is intentionally not inferred from a renderer or field presence. */
export function observeFacebookMutation(contract: FacebookContract, result: FacebookGraphqlResult,
  expected: { targetId: string; actorId: string }): FacebookMutationObservation {
  const unknown = (reason: string): FacebookMutationObservation => ({ kind: "unknown", reason, requiresNativeReadback: true });
  if (result.state === "unknown") return unknown(result.reason);
  if (result.state === "refused") return { kind: "provider-error", reason: "graphql_error_observed_without_authoritative_outcome", requiresNativeReadback: true };
  if (contract.kind !== "mutation") return unknown("mutation_contract_required");
  const candidates: Extract<FacebookMutationObservation, { kind: "candidate" }>[] = [];
  for (const frame of result.data) {
    let node: Record<string, any> | undefined;
    if (contract.operation === "groups.join" && contract.name === "useGroupRequestToJoinMutation") node = record(record(frame.group_request_to_join)?.group);
    else if (contract.operation === "posts.create" && contract.name === "ComposerStoryCreateMutation") node = record(record(frame.story_create)?.story);
    else if (contract.operation === "comments.create" && contract.name === "useCometUFICreateCommentMutation") node = record(record(record(frame.comment_create)?.feedback_comment_edge)?.node);
    else return unknown("response_variant_not_observed");
    const id = identity(node?.id); if (!id) continue;
    if (contract.operation === "groups.join" && id !== expected.targetId) return unknown("response_Group_identity_changed");
    const actorId = identity(record(node?.author)?.id ?? record(node?.default_actor)?.id);
    if (actorId && actorId !== expected.actorId) return unknown("response_actor_identity_changed");
    const state = node?.viewer_join_state;
    candidates.push({ kind: "candidate", resultId: id, ...(actorId ? { actorId } : {}),
      ...(contract.operation === "groups.join" && state === "MEMBER" ? { membershipHint: "joined" as const } : {}),
      ...(contract.operation === "groups.join" && state === "REQUESTED" ? { membershipHint: "pending" as const } : {}), requiresNativeReadback: true });
  }
  if (!candidates.length) return unknown("authoritative_result_identity_unavailable");
  const distinct = new Set(candidates.map(c => JSON.stringify(c)));
  return distinct.size === 1 ? candidates[0]! : unknown("conflicting_incremental_result_identities");
}

export interface NativeFacebookActionReadback {
  operationId: string; requestSha256: string; actorId: string; sessionId: string;
  targetId: string; observedAt: string; resultId?: string;
  state: "joined" | "admin_pending" | "published" | "moderation_pending" | "commented" | "unknown" | "refused";
  /** The original account/Group or campaign execution owns these proofs. */
  source: "original_native_action_readback";
}

/** Convert only an exact, fresh original native observation into an outcome.
 * The response candidate can help locate an object; it never supplies credit. */
export function outcomeFromNativeFacebookReadback(input: {
  operation: "groups.join" | "posts.create" | "comments.create";
  operationId: string; requestSha256: string; actorId: string; sessionId: string;
  targetId: string; dispatchedAt: string; observation: NativeFacebookActionReadback;
}, now = Date.now()): { state: "verified" | "pending" | "unknown" | "refused"; resultId?: string; reason?: string } {
  const o = input.observation, at = Date.parse(o.observedAt), dispatch = Date.parse(input.dispatchedAt);
  if (o.source !== "original_native_action_readback" || !input.operationId || !input.sessionId ||
      o.operationId !== input.operationId || o.requestSha256 !== input.requestSha256 || !/^[a-f0-9]{64}$/u.test(input.requestSha256) ||
      o.actorId !== input.actorId || o.sessionId !== input.sessionId || o.targetId !== input.targetId ||
      !Number.isFinite(at) || !Number.isFinite(dispatch) || dispatch > at || at > now || now - at > 60_000) {
    return { state: "unknown", reason: "original_native_readback_binding_unverified" };
  }
  if (o.state === "refused") return { state: "refused", reason: "original_native_refusal_observed" };
  if (o.state === "unknown") return { state: "unknown", reason: "original_native_outcome_unknown" };
  const states: Partial<Record<NativeFacebookActionReadback["state"], "verified" | "pending">> = input.operation === "groups.join" ? { joined: "verified", admin_pending: "pending" } :
    input.operation === "posts.create" ? { published: "verified", moderation_pending: "pending" } : { commented: "verified" };
  const state = states[o.state];
  if (!state || !identity(o.resultId) || input.operation === "groups.join" && o.resultId !== input.targetId) {
    return { state: "unknown", reason: "original_native_result_identity_unverified" };
  }
  return { state, resultId: o.resultId };
}
