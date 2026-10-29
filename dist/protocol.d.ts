import { FACEBOOK_GRAPHQL_URL, type FacebookContract } from "./contracts.js";
export interface FacebookGraphqlRequest {
    url: typeof FACEBOOK_GRAPHQL_URL;
    method: "POST";
    operation: FacebookContract;
    variables: Record<string, unknown>;
}
export interface FacebookGraphqlResponse {
    status: number;
    body: string;
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
/** Facebook returns JSON, anti-hijack prefixes, or newline-delimited patches. */
export declare function parseFacebookGraphqlResponse(response: FacebookGraphqlResponse): FacebookGraphqlResult;
export declare function graphqlRequest(operation: FacebookContract, variables: Record<string, unknown>): FacebookGraphqlRequest;
/** Session credentials are supplied inside the native transport, never here. */
export interface FacebookSessionTransport {
    verifyActor(): Promise<{
        actorUrl: string;
        actorId: string;
        verifiedAt: string;
        sessionId: string;
    }>;
    execute(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse>;
}
