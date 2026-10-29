export const FACEBOOK_ORIGIN = "https://www.facebook.com";
export const FACEBOOK_GRAPHQL_URL = FACEBOOK_ORIGIN + "/api/graphql/";
/** The complete concern vocabulary, including checks still owned by the native
 * membership/campaign controllers. It is not a list of required GraphQL APIs. */
export const FACEBOOK_CONCERNS = ["identity.read", "groups.search", "groups.inspect",
    "groups.rules", "groups.membership", "groups.join", "groups.questions", "discussions.list", "posts.create",
    "posts.read", "comments.create", "comments.read"];
export const REQUIRED_API_OPERATIONS = ["groups.search", "groups.join", "posts.create", "comments.create"];
/** Compatible name for callers that inspect migration readiness. */
export const REQUIRED_OPERATIONS = REQUIRED_API_OPERATIONS;
const WORKFLOW_API_OPERATIONS = {
    membership: ["groups.search", "groups.join"], posting: ["posts.create"], commenting: ["comments.create"],
};
const WORKFLOW_NATIVE_CONCERNS = {
    membership: ["identity.read", "groups.inspect", "groups.rules", "groups.membership", "groups.questions"],
    posting: ["identity.read", "groups.inspect", "groups.rules", "groups.membership", "posts.read"],
    commenting: ["identity.read", "groups.inspect", "groups.rules", "groups.membership", "discussions.list", "posts.read", "comments.read"],
};
const COMMON_NATIVE_CHECKS = ["exact_configured_Page_actor", "authored_language_and_subject", "complete_displayed_rules",
    "Page_and_action_permission", "member_qualifications", "original_claim_no_replay_and_outcome_readback"];
// Map observed client definition names, never guess a document ID or endpoint.
export function operationForName(name) {
    if (name === "CometSettingsDropdownTriggerQuery")
        return "identity.read";
    if (name === "CometGroupAboutRootQuery")
        return "groups.inspect";
    if (["CometGroupRootQuery", "useGroupsCometHeaderControlsQuery"].includes(name))
        return "groups.membership";
    if (name === "CometGroupDiscussionRootSuccessQuery")
        return "discussions.list";
    if (name === "CometUFICommentRefetchQuery")
        return "comments.read";
    if (name === "GroupCometComposerCreateDialogQuery")
        return "groups.inspect";
    if (/^SearchCometResults(?:PaginatedResults|InitialResults(?:ParallelFetch)?)Query$/u.test(name))
        return "groups.search";
    if (/^(?:useGroupRequestToJoinMutation|GroupCometJoinForumMutation)$/u.test(name))
        return "groups.join";
    if (/^(?:useCometUFICreateCommentMutation|CometUFICreateCommentMutation)$/u.test(name))
        return "comments.create";
    if (/^(?:ComposerStoryCreateMutation|CometComposerStoryCreateMutation)$/u.test(name))
        return "posts.create";
    if (/^GroupsComet.*(?:About|Description).*Query$/u.test(name))
        return "groups.inspect";
    if (/^GroupsComet.*Rules.*Query$/u.test(name))
        return "groups.rules";
    if (/^GroupsComet.*(?:Feed|Discussion).*Query$/u.test(name))
        return "discussions.list";
    if (/^CometUFI.*Comments.*Query$/u.test(name))
        return "comments.read";
    if (/^(?:CometSinglePost|CometFocusedStoryView).*Query$/u.test(name))
        return "posts.read";
    return undefined;
}
export function assertContract(contract) {
    if (!FACEBOOK_CONCERNS.includes(contract.operation) || !/^\d+$/u.test(contract.documentId) ||
        !/^[A-Za-z][A-Za-z0-9_]+$/u.test(contract.name) || !/^[a-f0-9]{64}$/u.test(contract.sourceSha256) ||
        !Number.isFinite(Date.parse(contract.observedAt)) || !["query", "mutation", "unknown"].includes(contract.kind)) {
        throw new Error("Malformed Facebook operation contract");
    }
    if (!["source-derived", "runtime-artifact-observed", "browser-request-observed", "api-readback-verified"].includes(contract.evidence))
        throw new Error("Malformed Facebook contract evidence level");
    const mutation = ["groups.join", "groups.questions", "posts.create", "comments.create"].includes(contract.operation);
    if (operationForName(contract.name) !== contract.operation)
        throw new Error("Facebook document does not belong to this operation");
    if (contract.kind === "unknown" ? contract.evidence === "api-readback-verified" : mutation !== (contract.kind === "mutation"))
        throw new Error("Facebook operation effect is not established");
}
function readinessFor(contracts, required, now) {
    const missing = required.filter(operation => !contracts.some(c => c.operation === operation));
    const unverified = required.filter(operation => contracts.some(c => c.operation === operation) &&
        !contracts.some(c => c.operation === operation && c.evidence === "api-readback-verified"));
    // A fresh unverified variant cannot renew an older verified document.
    const stale = required.filter(operation => contracts.some(c => c.operation === operation && c.evidence === "api-readback-verified") &&
        !contracts.some(c => c.operation === operation && c.evidence === "api-readback-verified" && Date.parse(c.observedAt) <= now && now - Date.parse(c.observedAt) <= 86_400_000));
    return { ready: !missing.length && !unverified.length && !stale.length, missing, unverified, stale };
}
/** A workflow may have a complete API contract set while its native owner still
 * needs to verify the exact actor, eligibility, claim and authoritative outcome. */
export function facebookApiWorkflowReadiness(contracts, now = Date.now()) {
    contracts.forEach(assertContract);
    const workflow = (name) => ({
        api: readinessFor(contracts, WORKFLOW_API_OPERATIONS[name], now),
        nativeOwner: name === "membership" ? "membership" : "campaign",
        nativeConcerns: [...WORKFLOW_NATIVE_CONCERNS[name]],
        nativeChecks: [...COMMON_NATIVE_CHECKS, ...(name === "membership" ? ["questionnaire_admission_checks"] :
                ["confirmed_joined_Group_inventory", "frozen_original_campaign_content", ...(name === "commenting" ? ["canonical_discussion_and_non_self_target"] : [])])],
        nativeVerification: "required_from_original_owner",
    });
    return { membership: workflow("membership"), posting: workflow("posting"), commenting: workflow("commenting") };
}
export function migrationReadiness(contracts, now = Date.now()) {
    const workflows = facebookApiWorkflowReadiness(contracts, now);
    return { ...readinessFor(contracts, REQUIRED_API_OPERATIONS, now), workflows };
}
