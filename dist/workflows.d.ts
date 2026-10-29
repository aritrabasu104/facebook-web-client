import { FacebookApiClient, type FacebookMutationEligibility, type NativeFacebookMutationOwner, type FacebookMutationIntent, type FacebookFirstOriginalApiVerification, type FacebookOriginalApiResponse } from "./client.js";
import type { FacebookContract } from "./contracts.js";
import type { FacebookGraphqlResult } from "./protocol.js";
/** Native orchestration supplies the reviewed payload and existing claim owner.
 * These separate workflow facades share one protocol/session implementation. */
export interface PreparedFacebookAction {
    variables: Record<string, unknown>;
    requestSha256: string;
    eligibility: FacebookMutationEligibility;
    owner: NativeFacebookMutationOwner;
    firstOriginalApiVerification?: FacebookFirstOriginalApiVerification;
    retainOriginalResponse?(receipt: FacebookOriginalApiResponse, intent: FacebookMutationIntent): Promise<void>;
    verifyOutcome(result: FacebookGraphqlResult, intent: FacebookMutationIntent): Promise<{
        state: "verified" | "pending" | "unknown" | "refused";
        resultId?: string;
        reason?: string;
    }>;
}
export declare class FacebookGroupMembershipApi {
    private readonly api;
    constructor(api: FacebookApiClient);
    search(contract: FacebookContract, variables: Record<string, unknown>): Promise<FacebookGraphqlResult>;
    join(contract: FacebookContract, action: PreparedFacebookAction): Promise<{
        state: string;
        operationId: string;
    }>;
}
export declare class FacebookPostingApi {
    private readonly api;
    constructor(api: FacebookApiClient);
    create(contract: FacebookContract, action: PreparedFacebookAction): Promise<{
        state: string;
        operationId: string;
    }>;
}
export declare class FacebookCommentingApi {
    private readonly api;
    constructor(api: FacebookApiClient);
    create(contract: FacebookContract, action: PreparedFacebookAction): Promise<{
        state: string;
        operationId: string;
    }>;
}
