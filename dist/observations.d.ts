import type { FacebookContract } from "./contracts.js";
import type { FacebookGraphqlResult } from "./protocol.js";
/** A mutation response is a readback candidate, never delivery or Join credit.
 * Only the original native owner can establish the actor and final outcome. */
export type FacebookMutationObservation = {
    kind: "candidate";
    resultId: string;
    actorId?: string;
    membershipHint?: "joined" | "pending";
    requiresNativeReadback: true;
} | {
    kind: "unknown" | "provider-error";
    reason: string;
    requiresNativeReadback: true;
};
/** Exact response paths observed in the retained Relay artifacts. Pending
 * moderation is intentionally not inferred from a renderer or field presence. */
export declare function observeFacebookMutation(contract: FacebookContract, result: FacebookGraphqlResult, expected: {
    targetId: string;
    actorId: string;
}): FacebookMutationObservation;
export interface NativeFacebookActionReadback {
    operationId: string;
    requestSha256: string;
    actorId: string;
    sessionId: string;
    targetId: string;
    observedAt: string;
    resultId?: string;
    state: "joined" | "admin_pending" | "published" | "moderation_pending" | "commented" | "unknown" | "refused";
    /** The original account/Group or campaign execution owns these proofs. */
    source: "original_native_action_readback";
}
/** Convert only an exact, fresh original native observation into an outcome.
 * The response candidate can help locate an object; it never supplies credit. */
export declare function outcomeFromNativeFacebookReadback(input: {
    operation: "groups.join" | "posts.create" | "comments.create";
    operationId: string;
    requestSha256: string;
    actorId: string;
    sessionId: string;
    targetId: string;
    dispatchedAt: string;
    observation: NativeFacebookActionReadback;
}, now?: number): {
    state: "verified" | "pending" | "unknown" | "refused";
    resultId?: string;
    reason?: string;
};
