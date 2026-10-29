/** Facebook web GraphQL contracts. A source definition is not a verified API. */
export type FacebookOperation = "groups.search" | "groups.inspect" | "groups.rules" | "groups.membership" | "groups.join" | "groups.questions" | "discussions.list" | "posts.create" | "posts.read" | "comments.create" | "comments.read" | "identity.read";
export type ContractEvidence = "source-derived" | "runtime-artifact-observed" | "browser-request-observed" | "api-readback-verified";
export interface FacebookContract {
    operation: FacebookOperation;
    name: string;
    documentId: string;
    kind: "query" | "mutation" | "unknown";
    variables: string[];
    responseFields: string[];
    evidence: ContractEvidence;
    sourceSha256: string;
    sourceModule: string;
    observedAt: string;
    limitations: string[];
    /** Exact JSON pointers established by authenticated request/readback evidence. */
    targetVariablePaths?: string[];
    /** Separately resolved identities retain their own exact verified pointers;
     * a Group, canonical post and feedback object are never treated as aliases. */
    targetVariableBindings?: Partial<Record<"groupId" | "postId" | "feedbackId", string[]>>;
    actorVariablePaths?: string[];
}
export declare const FACEBOOK_ORIGIN = "https://www.facebook.com";
export declare const FACEBOOK_GRAPHQL_URL: string;
/** The complete concern vocabulary, including checks still owned by the native
 * membership/campaign controllers. It is not a list of required GraphQL APIs. */
export declare const FACEBOOK_CONCERNS: readonly FacebookOperation[];
export type FacebookApiCapability = "groups.search" | "groups.join" | "posts.create" | "comments.create";
export declare const REQUIRED_API_OPERATIONS: readonly FacebookApiCapability[];
/** Compatible name for callers that inspect migration readiness. */
export declare const REQUIRED_OPERATIONS: readonly FacebookApiCapability[];
export type FacebookApiWorkflow = "membership" | "posting" | "commenting";
export interface FacebookApiContractReadiness {
    ready: boolean;
    missing: FacebookOperation[];
    unverified: FacebookOperation[];
    stale: FacebookOperation[];
}
export interface FacebookApiWorkflowReadiness {
    /** API readiness alone never grants native eligibility, ownership or dispatch. */
    api: FacebookApiContractReadiness;
    nativeOwner: "membership" | "campaign";
    nativeConcerns: readonly FacebookOperation[];
    nativeChecks: readonly string[];
    nativeVerification: "required_from_original_owner";
}
export declare function operationForName(name: string): FacebookOperation | undefined;
export declare function assertContract(contract: FacebookContract): void;
/** A workflow may have a complete API contract set while its native owner still
 * needs to verify the exact actor, eligibility, claim and authoritative outcome. */
export declare function facebookApiWorkflowReadiness(contracts: FacebookContract[], now?: number): Record<FacebookApiWorkflow, FacebookApiWorkflowReadiness>;
export declare function migrationReadiness(contracts: FacebookContract[], now?: number): FacebookApiContractReadiness & {
    workflows: Record<FacebookApiWorkflow, FacebookApiWorkflowReadiness>;
};
