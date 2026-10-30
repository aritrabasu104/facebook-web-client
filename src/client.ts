import { hasObservedFacebookContractSource, type FacebookContract, type FacebookOperation } from "./contracts.js";
import { graphqlRequest, parseFacebookGraphqlResponse, type FacebookSessionTransport, type FacebookGraphqlResult } from "./protocol.js";
import { sha256, stableStringify } from "./util.js";
import { facebookOperationCoordinator, type FacebookOperationCoordinator } from "./concurrency.js";

export function facebookApiRequestSha256(contract: FacebookContract, variables: Record<string, unknown>): string {
  return sha256(stableStringify(graphqlRequest(contract, variables)));
}
function pointed(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/") || pointer === "/") throw new Error("Malformed verified Facebook variable binding");
  return pointer.slice(1).split("/").reduce<unknown>((current, key) => current && typeof current === "object" ?
    (current as Record<string, unknown>)[key.replace(/~1/gu, "/").replace(/~0/gu, "~")] : undefined, value);
}
export interface FacebookTargetBindings {
  groupId?: string;
  postId?: string;
  feedbackId?: string;
}
export interface FacebookMutationClaim {
  operation: FacebookOperation; actorUrl: string; actorId: string;
  targetId: string; targetBindings?: FacebookTargetBindings;
  requestSha256: string; sourceOwner: "membership" | "campaign";
}
export interface FacebookMutationIntent extends FacebookMutationClaim {
  operationId: string; state: "claimed";
}
export interface FacebookMutationOutcome {
  state: "verified" | "pending" | "unknown" | "refused"; resultId?: string; reason?: string;
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
  readBack(intent: FacebookMutationIntent): Promise<{ state: string; operationId: string }>;
}
export interface FacebookFirstOriginalApiVerification {
  version: "facebook-first-original-api-verification-v1";
  authorizationAuditId: string;
  contractSha256: string;
  sourceSha256: string;
}
export interface FacebookMutationEligibility {
  actorUrl: string; actorId: string; targetId: string; targetBindings?: FacebookTargetBindings; operation: FacebookOperation;
  sourceOwner: "membership" | "campaign"; checkedAt: string;
  languageVerified: boolean; subjectVerified: boolean; rulesComplete: boolean; pagesAllowed: boolean;
  memberQualifications: "none" | "restricted_or_uncertain"; qualificationQuote: string;
  membership?: "joined" | "pending" | "unknown" | "not_joined";
  actionPermissionVerified: boolean;
}
export class FacebookUndispatchedClaimError extends Error {
  readonly dispatched = false;
  constructor(readonly operationId: string, readonly reason: string) {
    super("Original Facebook claim remains fenced and unsubmitted: " + reason);
    this.name = "FacebookUndispatchedClaimError";
  }
}
function fresh(at: string, maximumAge: number, now: number): boolean {
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maximumAge;
}
function targetBindingsVerified(contract: FacebookContract, e: FacebookMutationEligibility, variables: Record<string, unknown>): boolean {
  const named = contract.targetVariableBindings, values = e.targetBindings;
  const numeric = (value: string | undefined) => typeof value === "string" && /^\d+$/u.test(value);
  const identifier = (value: string | undefined) => typeof value === "string" && /^[A-Za-z0-9_.:/=+-]{1,4096}$/u.test(value);
  if (values && Object.keys(values).some(key => !["groupId", "postId", "feedbackId"].includes(key))) return false;
  if (named && Object.keys(named).some(key => !["groupId", "postId", "feedbackId"].includes(key))) return false;
  if (e.operation === "comments.create") {
    // The wire feedback identity is opaque. It is not the canonical post ID,
    // and neither identity can be substituted for the containing Group.
    if (!values || !numeric(values.groupId) || !identifier(values.postId) || !identifier(values.feedbackId) ||
        values.postId !== e.targetId || !named?.groupId?.length || !named.feedbackId?.length) return false;
  } else {
    if (!numeric(e.targetId) || values && (values.groupId !== e.targetId || values.postId !== undefined || values.feedbackId !== undefined)) return false;
    if (named && !named.groupId?.length) return false;
  }
  const entries = Object.entries(named ?? {});
  if (entries.some(([role, paths]) => !paths?.length || !values?.[role as keyof FacebookTargetBindings] ||
      paths.some(path => pointed(variables, path) !== values[role as keyof FacebookTargetBindings]))) return false;
  const legacy = contract.targetVariablePaths;
  if (legacy?.some(path => pointed(variables, path) !== e.targetId)) return false;
  return entries.length > 0 || e.operation !== "comments.create" && Boolean(legacy?.length);
}
function assertEligible(contract: FacebookContract, e: FacebookMutationEligibility, variables: Record<string, unknown>, digest: string, now: number,
  first?: FacebookFirstOriginalApiVerification): void {
  const admittedOriginalVerification = first?.version === "facebook-first-original-api-verification-v1" &&
    /^evt_[a-f0-9]{64}$/u.test(first.authorizationAuditId) && first.sourceSha256 === contract.sourceSha256 &&
    first.contractSha256 === sha256(stableStringify(contract)) && ["runtime-artifact-observed", "browser-request-observed"].includes(contract.evidence);
  if (contract.kind !== "mutation" || contract.evidence !== "api-readback-verified" && !admittedOriginalVerification || contract.operation !== e.operation ||
      !hasObservedFacebookContractSource(contract, now) || !targetBindingsVerified(contract, e, variables) ||
      contract.actorVariablePaths?.some(path => pointed(variables, path) !== e.actorId) ||
      facebookApiRequestSha256(contract, variables) !== digest || !/^[a-f0-9]{64}$/u.test(digest) ||
      !fresh(e.checkedAt, 60_000, now) || !e.languageVerified || !e.subjectVerified || !e.rulesComplete ||
      !e.pagesAllowed || !e.actionPermissionVerified || e.memberQualifications !== "none" || e.qualificationQuote !== "" || !/^\d+$/u.test(e.actorId) ||
      (e.operation === "groups.join" ? e.sourceOwner !== "membership" || e.membership !== "not_joined" :
        e.sourceOwner !== "campaign" || e.membership !== "joined" || !["posts.create", "comments.create"].includes(e.operation))) {
    throw new Error("Facebook mutation lacks fresh native eligibility and a verified operation contract");
  }
}
function actorVerified(actor: Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>, e: FacebookMutationEligibility, now: number, sessionId?: string): boolean {
  return actor.actorUrl === e.actorUrl && actor.actorId === e.actorId && Boolean(actor.sessionId) &&
    (!sessionId || actor.sessionId === sessionId) && fresh(actor.verifiedAt, 60_000, now);
}

/** Protocol execution is below the existing native claim owner. No retries,
 * browser fallback, new queue, or success inferred from HTTP 200. */
export class FacebookApiClient {
  constructor(private readonly transport: FacebookSessionTransport, private readonly now = () => Date.now(),
    private readonly coordination: FacebookOperationCoordinator = facebookOperationCoordinator(transport)) {}
  async query(contract: FacebookContract, variables: Record<string, unknown>): Promise<FacebookGraphqlResult> {
    contract = structuredClone(contract); variables = structuredClone(variables);
    if (contract.kind !== "query" || contract.evidence !== "api-readback-verified" || !hasObservedFacebookContractSource(contract, this.now())) throw new Error("Facebook read contract has no verified retained source");
    return parseFacebookGraphqlResponse(await this.transport.execute(graphqlRequest(contract, variables)));
  }
  async mutate(input: {
    contract: FacebookContract; variables: Record<string, unknown>; requestSha256: string;
    eligibility: FacebookMutationEligibility; owner: NativeFacebookMutationOwner;
    firstOriginalApiVerification?: FacebookFirstOriginalApiVerification;
    retainOriginalResponse?(receipt: FacebookOriginalApiResponse, intent: FacebookMutationIntent): Promise<void>;
    verifyOutcome(result: FacebookGraphqlResult, intent: FacebookMutationIntent): Promise<FacebookMutationOutcome>;
  }): Promise<{ state: string; operationId: string }> {
    // Snapshot before waiting. Eligibility is rechecked inside the admitted turn,
    // before the original durable owner can claim or dispatch anything.
    const frozen = { ...input, contract: structuredClone(input.contract), variables: structuredClone(input.variables),
      eligibility: structuredClone(input.eligibility),
      ...(input.firstOriginalApiVerification ? { firstOriginalApiVerification: structuredClone(input.firstOriginalApiVerification) } : {}) };
    return this.coordination.mutate({ actorUrl: frozen.eligibility.actorUrl,
      groupId: frozen.eligibility.targetBindings?.groupId ?? frozen.eligibility.targetId }, () => this.mutateAdmitted(frozen));
  }
  private async mutateAdmitted(input: Parameters<FacebookApiClient["mutate"]>[0]): Promise<{ state: string; operationId: string }> {
    input = { ...input, contract: structuredClone(input.contract), variables: structuredClone(input.variables), eligibility: structuredClone(input.eligibility),
      ...(input.firstOriginalApiVerification ? { firstOriginalApiVerification: structuredClone(input.firstOriginalApiVerification) } : {}) };
    const { contract, eligibility: e, owner } = input;
    if (input.firstOriginalApiVerification && await owner.authorizeFirstOriginalApiVerification?.(structuredClone(input.firstOriginalApiVerification)) !== true) {
      throw new Error("Original Facebook API verification lacks durable human authorization");
    }
    const eligible = () => assertEligible(contract, e, input.variables, input.requestSha256, this.now(), input.firstOriginalApiVerification);
    eligible();
    const before = structuredClone(await this.transport.verifyActor());
    eligible();
    if (!actorVerified(before, e, this.now())) throw new Error("Facebook API actor mismatch");
    const request = graphqlRequest(contract, input.variables);
    const intent = structuredClone(await owner.claim({ operation: e.operation, actorUrl: e.actorUrl, actorId: e.actorId,
      targetId: e.targetId, ...(e.targetBindings ? { targetBindings: structuredClone(e.targetBindings) } : {}),
      requestSha256: input.requestSha256, sourceOwner: e.sourceOwner }));
    if (intent.state !== "claimed" || intent.operation !== e.operation || intent.actorUrl !== e.actorUrl || intent.actorId !== e.actorId ||
        intent.targetId !== e.targetId || stableStringify(intent.targetBindings ?? null) !== stableStringify(e.targetBindings ?? null) ||
        intent.requestSha256 !== input.requestSha256 || intent.sourceOwner !== e.sourceOwner || !intent.operationId) throw new Error("Original Facebook claim readback changed");
    const retainUnsubmitted = async (reason: string): Promise<never> => {
      await owner.dispatchNotStarted?.(structuredClone(intent), reason);
      throw new FacebookUndispatchedClaimError(intent.operationId, reason);
    };
    try { eligible(); } catch { return retainUnsubmitted("native_eligibility_or_contract_expired_after_claim"); }
    let actor: Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
    try { actor = structuredClone(await this.transport.verifyActor()); }
    catch { return retainUnsubmitted("native_actor_unverified_after_claim"); }
    try { eligible(); } catch { return retainUnsubmitted("native_eligibility_or_contract_expired_after_actor_read"); }
    if (!actorVerified(actor, e, this.now(), before.sessionId)) return retainUnsubmitted("native_actor_changed_after_claim");
    await owner.dispatchStarted(structuredClone(intent));
    // Native CAS/persistence is awaited too. Expiry here keeps its dispatch
    // intent fenced, records no submission, and never sends provider bytes.
    try { eligible(); } catch { return retainUnsubmitted("native_eligibility_or_contract_expired_before_dispatch"); }
    if (!actorVerified(actor, e, this.now(), before.sessionId)) return retainUnsubmitted("native_actor_proof_expired_before_dispatch");
    let outcome: FacebookMutationOutcome;
    try {
      const response = await this.transport.execute(request), result = parseFacebookGraphqlResponse(response);
      await input.retainOriginalResponse?.({ httpStatus: response.status, responseSha256: sha256(response.body),
        receivedAt: new Date(this.now()).toISOString(), result: structuredClone(result) }, structuredClone(intent));
      outcome = await input.verifyOutcome(result, structuredClone(intent));
      if (!["verified", "pending", "unknown", "refused"].includes(outcome?.state)) throw new Error("Invalid native outcome");
    } catch { outcome = { state: "unknown", reason: "original_api_dispatch_or_readback_unsettled" }; }
    if ((outcome.state === "verified" || outcome.state === "pending") && (!outcome.resultId ||
        e.operation === "groups.join" && outcome.resultId !== e.targetId)) outcome = { state: "unknown", reason: "authoritative_result_identity_unavailable" };
    await owner.recordOutcome(structuredClone(intent), structuredClone(outcome));
    const readback = await owner.readBack(structuredClone(intent));
    if (readback.operationId !== intent.operationId || readback.state !== outcome.state) throw new Error("Original Facebook outcome lacks native durable readback");
    return readback;
  }
}
