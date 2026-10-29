import type { FacebookContract, FacebookOperation } from "./contracts.js";
import { type FacebookSessionTransport, type FacebookGraphqlResult } from "./protocol.js";
export declare function facebookApiRequestSha256(contract: FacebookContract, variables: Record<string, unknown>): string;
export interface FacebookTargetBindings {
    groupId?: string;
    postId?: string;
    feedbackId?: string;
}
export interface FacebookMutationClaim {
    operation: FacebookOperation;
    actorUrl: string;
    actorId: string;
    targetId: string;
    targetBindings?: FacebookTargetBindings;
    requestSha256: string;
    sourceOwner: "membership" | "campaign";
}
export interface FacebookMutationIntent extends FacebookMutationClaim {
    operationId: string;
    state: "claimed";
}
export interface FacebookMutationOutcome {
    state: "verified" | "pending" | "unknown" | "refused";
    resultId?: string;
    reason?: string;
}
export interface FacebookOriginalApiResponse {
    httpStatus: number;
    responseSha256: string;
    receivedAt: string;
    result: FacebookGraphqlResult;
}
export interface NativeFacebookMutationOwner {
    /** The original durable owner verifies the actual explicit-human authority
     * audit before admitting a first original API verification attempt. */
    authorizeFirstOriginalApiVerification?(proof: FacebookFirstOriginalApiVerification): Promise<boolean>;
    /** Persist a fresh claim, or adopt the exact already persisted native claim. */
    claim(input: FacebookMutationClaim): Promise<FacebookMutationIntent>;
    dispatchStarted(intent: FacebookMutationIntent): Promise<void>;
    /** Retain the original claim and its fences; this never releases or retries it. */
    dispatchNotStarted?(intent: FacebookMutationIntent, reason: string): Promise<void>;
    recordOutcome(intent: FacebookMutationIntent, outcome: FacebookMutationOutcome): Promise<void>;
    readBack(intent: FacebookMutationIntent): Promise<{
        state: string;
        operationId: string;
    }>;
}
export interface FacebookFirstOriginalApiVerification {
    version: "facebook-first-original-api-verification-v1";
    authorizationAuditId: string;
    contractSha256: string;
    sourceSha256: string;
}
export interface FacebookMutationEligibility {
    actorUrl: string;
    actorId: string;
    targetId: string;
    targetBindings?: FacebookTargetBindings;
    operation: FacebookOperation;
    sourceOwner: "membership" | "campaign";
    checkedAt: string;
    languageVerified: boolean;
    subjectVerified: boolean;
    rulesComplete: boolean;
    pagesAllowed: boolean;
    memberQualifications: "none" | "restricted_or_uncertain";
    qualificationQuote: string;
    membership?: "joined" | "pending" | "unknown" | "not_joined";
    actionPermissionVerified: boolean;
}
export declare class FacebookUndispatchedClaimError extends Error {
    readonly operationId: string;
    readonly reason: string;
    readonly dispatched = false;
    constructor(operationId: string, reason: string);
}
/** Protocol execution is below the existing native claim owner. No retries,
 * browser fallback, new queue, or success inferred from HTTP 200. */
export declare class FacebookApiClient {
    private readonly transport;
    private readonly now;
    constructor(transport: FacebookSessionTransport, now?: () => number);
    query(contract: FacebookContract, variables: Record<string, unknown>): Promise<FacebookGraphqlResult>;
    mutate(input: {
        contract: FacebookContract;
        variables: Record<string, unknown>;
        requestSha256: string;
        eligibility: FacebookMutationEligibility;
        owner: NativeFacebookMutationOwner;
        firstOriginalApiVerification?: FacebookFirstOriginalApiVerification;
        retainOriginalResponse?(receipt: FacebookOriginalApiResponse, intent: FacebookMutationIntent): Promise<void>;
        verifyOutcome(result: FacebookGraphqlResult, intent: FacebookMutationIntent): Promise<FacebookMutationOutcome>;
    }): Promise<{
        state: string;
        operationId: string;
    }>;
}
