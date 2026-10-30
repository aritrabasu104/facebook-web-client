import type { FacebookOperationCoordinator } from "./concurrency.js";
import { FACEBOOK_GRAPHQL_URL, type FacebookContract } from "./contracts.js";
import { inspect } from "node:util";
export interface FacebookGraphqlRequest {
    url: typeof FACEBOOK_GRAPHQL_URL;
    method: "POST";
    operation: FacebookContract;
    variables: Record<string, unknown>;
}
export interface FacebookGraphqlResponse {
    status: number;
    body: string;
    retryAfter?: string;
}
export type FacebookGraphqlResult = {
    state: "data";
    data: Record<string, unknown>[];
} | {
    state: "refused";
    errors: unknown[];
} | {
    state: "unknown";
    reason: string;
};
export interface FacebookRateLimitObservation {
    reason: "http_429" | "graphql_1675004";
    retryAfter?: string;
}
/** Classification only. A rate limit never proves non-delivery, retries a
 * request, changes an actor, or grants a new mutation allowance. */
export declare function facebookRateLimitObservation(response: FacebookGraphqlResponse): FacebookRateLimitObservation | undefined;
/** An unsubmitted identity/bootstrap read may expose its exact returned bytes
 * to the native owner's evidence store. Default serialization omits the body. */
export declare class FacebookRateLimitError extends Error {
    readonly observedAt: string;
    readonly observation: FacebookRateLimitObservation;
    readonly response: FacebookGraphqlResponse;
    readonly request: FacebookGraphqlRequest;
    constructor(response: FacebookGraphqlResponse, request: FacebookGraphqlRequest, observedAt?: string);
    toJSON(): {
        name: string;
        observation: FacebookRateLimitObservation;
        observedAt: string;
        operation: string;
        responseSha256: string;
    };
    [inspect.custom](): {
        name: string;
        observation: FacebookRateLimitObservation;
        observedAt: string;
        operation: string;
        responseSha256: string;
    };
}
/** Facebook returns JSON, anti-hijack prefixes, or newline-delimited patches. */
export declare function parseFacebookGraphqlResponse(response: FacebookGraphqlResponse): FacebookGraphqlResult;
export declare function graphqlRequest(operation: FacebookContract, variables: Record<string, unknown>): FacebookGraphqlRequest;
/** Session credentials are supplied inside the native transport, never here. */
export interface FacebookSessionTransport {
    /** Wrappers must forward this instance when they share an authenticated session. */
    readonly coordination?: FacebookOperationCoordinator;
    verifyActor(): Promise<{
        actorUrl: string;
        actorId: string;
        verifiedAt: string;
        sessionId: string;
    }>;
    execute(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse>;
}
