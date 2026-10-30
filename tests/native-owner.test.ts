import { describe, expect, it, vi } from "vitest";
import { FacebookApiClient, facebookApiRequestSha256, FacebookUndispatchedClaimError,
  type FacebookMutationEligibility, type FacebookMutationIntent, type FacebookMutationOutcome } from "../src/client.js";
import { ExistingNativeFacebookMutationOwner, type ExistingNativeFacebookClaimRecord } from "../src/native-owner.js";
import type { FacebookContract } from "../src/contracts.js";
import type { FacebookGraphqlRequest } from "../src/protocol.js";

const at = "2026-10-29T06:00:00.000Z", actorUrl = "https://www.facebook.com/profile.php?id=101";
function fixture(comment = false) {
  let now = Date.parse(at), outcome: FacebookMutationOutcome | undefined;
  const contract: FacebookContract = { operation: comment ? "comments.create" : "groups.join",
    name: comment ? "useCometUFICreateCommentMutation" : "useGroupRequestToJoinMutation", documentId: "123456", kind: "mutation",
    variables: ["input", "groupID"], responseFields: [], evidence: "api-readback-verified", sourceSha256: "a".repeat(64),
    sourceModule: "fixture.graphql", observedAt: at, limitations: [], actorVariablePaths: ["/input/actor_id"],
    ...(comment ? { targetVariableBindings: { groupId: ["/groupID"], feedbackId: ["/input/feedback_id"] } } : { targetVariablePaths: ["/input/group_id"] }) };
  const variables: Record<string, any> = comment ? { groupID: "321", input: { feedback_id: "ZmVlZGJhY2s6NjU0", actor_id: "101" } } :
    { input: { group_id: "321", actor_id: "101" } };
  const eligibility: FacebookMutationEligibility = { actorUrl, actorId: "101", targetId: comment ? "321_654" : "321",
    ...(comment ? { targetBindings: { groupId: "321", postId: "321_654", feedbackId: "ZmVlZGJhY2s6NjU0" } } : {}),
    operation: contract.operation, sourceOwner: comment ? "campaign" : "membership", checkedAt: at,
    languageVerified: true, subjectVerified: true, rulesComplete: true, pagesAllowed: true, memberQualifications: "none", qualificationQuote: "",
    membership: comment ? "joined" : "not_joined", actionPermissionVerified: true };
  const intent: FacebookMutationIntent = { operationId: "original-native-operation", state: "claimed", operation: contract.operation,
    actorUrl, actorId: eligibility.actorId, targetId: eligibility.targetId,
    ...(eligibility.targetBindings ? { targetBindings: structuredClone(eligibility.targetBindings) } : {}),
    requestSha256: facebookApiRequestSha256(contract, variables), sourceOwner: eligibility.sourceOwner };
  const record: ExistingNativeFacebookClaimRecord = { intent, claimFingerprint: "b".repeat(64), dispatchState: "not_started" };
  const native = {
    readOriginalClaim: vi.fn(async () => structuredClone(record)),
    compareAndSetDispatchStarted: vi.fn(async (_record: ExistingNativeFacebookClaimRecord) => { record.dispatchState = "started"; return true; }),
    retainUnsubmitted: vi.fn(async (_record: ExistingNativeFacebookClaimRecord, _reason: string) => undefined),
    recordOutcome: vi.fn(async (_intent: FacebookMutationIntent, value: FacebookMutationOutcome) => { outcome = value; }),
    readBack: vi.fn(async (_intent: FacebookMutationIntent) => ({ state: outcome!.state, operationId: intent.operationId })),
  };
  const owner = new ExistingNativeFacebookMutationOwner({ operationId: intent.operationId, sourceOwner: intent.sourceOwner }, native);
  const transport = {
    verifyActor: vi.fn(async () => ({ actorUrl, actorId: eligibility.actorId, verifiedAt: new Date(now).toISOString(), sessionId: "original-native-session" })),
    execute: vi.fn(async (_request: FacebookGraphqlRequest) => ({ status: 200, body: '{"data":{"original":true}}' })),
  };
  const client = new FacebookApiClient(transport, () => now);
  const input = { contract, variables, eligibility, owner, requestSha256: intent.requestSha256,
    verifyOutcome: vi.fn(async (): Promise<FacebookMutationOutcome> => ({ state: comment ? "verified" : "pending", resultId: comment ? "777" : "321" })) };
  return { client, input, native, owner, transport, record, intent, advance: (ms: number) => { now += ms; } };
}
describe("existing native Facebook claim adapter", () => {
  it("adopts one persisted claim and keeps the original dispatch/outcome/readback owner", async () => {
    const f = fixture();
    expect(await f.client.mutate(f.input)).toEqual({ state: "pending", operationId: "original-native-operation" });
    expect(f.native.readOriginalClaim).toHaveBeenCalledTimes(2); expect(f.native.compareAndSetDispatchStarted).toHaveBeenCalledTimes(1);
    expect(f.native.recordOutcome).toHaveBeenCalledWith(f.intent, { state: "pending", resultId: "321" });
    expect(f.native.readBack).toHaveBeenCalledWith(f.intent);
    expect(f.native.compareAndSetDispatchStarted.mock.invocationCallOrder[0]).toBeLessThan(f.transport.execute.mock.invocationCallOrder[0]!);
    // There is deliberately no claim-writing callback for the adapter to call.
    expect(Object.keys(f.native)).not.toContain("claim");
  });
  it.each(["started", "settled", "unknown"] as const)("refuses an original %s attempt", async state => {
    const f = fixture(); f.record.dispatchState = state;
    await expect(f.client.mutate(f.input)).rejects.toThrow("already dispatched");
    expect(f.native.compareAndSetDispatchStarted).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it.each(["operationId", "actor", "target", "request", "sourceOwner"])("refuses changed original %s without creating a claim", async kind => {
    const f = fixture();
    if (kind === "operationId") f.record.intent.operationId = "replacement";
    if (kind === "actor") f.record.intent.actorId = "1";
    if (kind === "target") f.record.intent.targetId = "999";
    if (kind === "request") f.record.intent.requestSha256 = "c".repeat(64);
    if (kind === "sourceOwner") f.record.intent.sourceOwner = "campaign";
    await expect(f.client.mutate(f.input)).rejects.toThrow(); expect(f.transport.execute).not.toHaveBeenCalled();
    expect(f.native.compareAndSetDispatchStarted).not.toHaveBeenCalled();
  });
  it("does not repeat an unresolved original dispatch CAS", async () => {
    const f = fixture(), { operationId: _id, state: _state, ...claim } = f.intent;
    const adopted = await f.owner.claim(claim);
    f.native.compareAndSetDispatchStarted.mockRejectedValue(new Error("original CAS reply lost"));
    await expect(f.owner.dispatchStarted(adopted)).rejects.toThrow("reply lost");
    await expect(f.owner.dispatchStarted(adopted)).rejects.toThrow("already consumed");
    expect(f.native.compareAndSetDispatchStarted).toHaveBeenCalledTimes(1);
    await expect(f.owner.claim(claim)).rejects.toThrow("adoption is already consumed");
  });
  it("refuses the original owner's failed CAS before any provider request", async () => {
    const f = fixture(); f.native.compareAndSetDispatchStarted.mockResolvedValue(false);
    await expect(f.client.mutate(f.input)).rejects.toThrow("CAS refused");
    expect(f.transport.execute).not.toHaveBeenCalled(); expect(f.native.recordOutcome).not.toHaveBeenCalled();
  });
  it("fences an expired claim explicitly without another claim or provider call", async () => {
    const f = fixture(); f.native.readOriginalClaim.mockImplementation(async () => { f.advance(61_000); return structuredClone(f.record); });
    await expect(f.client.mutate(f.input)).rejects.toMatchObject({ name: "FacebookUndispatchedClaimError", operationId: "original-native-operation", dispatched: false });
    expect(f.native.readOriginalClaim).toHaveBeenCalledTimes(1); expect(f.native.retainUnsubmitted).toHaveBeenCalledWith(f.record, "native_eligibility_or_contract_expired_after_claim");
    expect(f.native.compareAndSetDispatchStarted).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
    expect(f.native.recordOutcome).not.toHaveBeenCalled(); expect(f.record.intent.state).toBe("claimed");
  });
  it("rechecks eligibility after the final actor read", async () => {
    const f = fixture(); f.transport.verifyActor.mockImplementationOnce(async () => ({ actorUrl, actorId: "101", verifiedAt: at, sessionId: "original-native-session" }))
      .mockImplementationOnce(async () => { f.advance(61_000); return { actorUrl, actorId: "101", verifiedAt: at, sessionId: "original-native-session" }; });
    await expect(f.client.mutate(f.input)).rejects.toBeInstanceOf(FacebookUndispatchedClaimError);
    expect(f.native.retainUnsubmitted.mock.calls[0]![1]).toBe("native_eligibility_or_contract_expired_after_actor_read");
    expect(f.native.compareAndSetDispatchStarted).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it("does not adopt a claim when the first actor read exhausts eligibility freshness", async () => {
    const f = fixture(); f.transport.verifyActor.mockImplementation(async () => {
      f.advance(61_000); return { actorUrl, actorId: "101", verifiedAt: at, sessionId: "original-native-session" };
    });
    await expect(f.client.mutate(f.input)).rejects.toThrow("fresh native eligibility");
    expect(f.native.readOriginalClaim).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it("keeps a retained protocol definition valid across a day boundary with fresh native eligibility", async () => {
    const f = fixture();
    f.input.contract.observedAt = new Date(Date.parse(at) - 86_399_999).toISOString();
    f.input.requestSha256 = facebookApiRequestSha256(f.input.contract, f.input.variables);
    f.record.intent.requestSha256 = f.input.requestSha256;
    f.native.readOriginalClaim.mockImplementation(async () => { f.advance(2); return structuredClone(f.record); });
    await expect(f.client.mutate(f.input)).resolves.toMatchObject({state:'pending'});
    expect(f.native.compareAndSetDispatchStarted).toHaveBeenCalledOnce();expect(f.transport.execute).toHaveBeenCalledOnce();
    expect(f.input.contract.observedAt).toBe(new Date(Date.parse(at)-86_399_999).toISOString());
  });
  it("rechecks eligibility after awaited native dispatch persistence", async () => {
    const f = fixture(); f.native.compareAndSetDispatchStarted.mockImplementation(async () => { f.advance(61_000); return true; });
    await expect(f.client.mutate(f.input)).rejects.toBeInstanceOf(FacebookUndispatchedClaimError);
    expect(f.native.retainUnsubmitted.mock.calls[0]![1]).toBe("native_eligibility_or_contract_expired_before_dispatch");
    expect(f.native.retainUnsubmitted.mock.calls[0]![0].dispatchState).toBe("started");
    expect(f.transport.execute).not.toHaveBeenCalled(); expect(f.native.recordOutcome).not.toHaveBeenCalled();
  });
  it("retains the original claim if the native actor/session changes after it", async () => {
    const f = fixture(); f.transport.verifyActor.mockResolvedValueOnce({ actorUrl, actorId: "101", verifiedAt: at, sessionId: "original-native-session" })
      .mockResolvedValueOnce({ actorUrl, actorId: "101", verifiedAt: at, sessionId: "replacement-session" });
    await expect(f.client.mutate(f.input)).rejects.toBeInstanceOf(FacebookUndispatchedClaimError);
    expect(f.native.retainUnsubmitted.mock.calls[0]![1]).toBe("native_actor_changed_after_claim"); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it("keeps Group, canonical post and opaque feedback identities distinct for comments", async () => {
    const f = fixture(true);
    expect(await f.client.mutate(f.input)).toEqual({ state: "verified", operationId: "original-native-operation" });
    expect(f.native.compareAndSetDispatchStarted.mock.calls[0]![0].intent.targetBindings).toEqual({ groupId: "321", postId: "321_654", feedbackId: "ZmVlZGJhY2s6NjU0" });
    expect(f.transport.execute.mock.calls[0]![0].variables).toEqual(f.input.variables);
  });
  it.each(["group", "post", "feedback", "legacy"])("refuses an unverified comment %s binding", async kind => {
    const f = fixture(true);
    if (kind === "group") f.input.variables.groupID = "321_654";
    if (kind === "post") f.input.eligibility.targetBindings!.postId = "other-post";
    if (kind === "feedback") f.input.variables.input.feedback_id = "321_654";
    if (kind === "legacy") { delete f.input.contract.targetVariableBindings; f.input.contract.targetVariablePaths = ["/input/feedback_id"]; }
    // Recomputing a digest cannot establish the missing native binding.
    f.input.requestSha256 = facebookApiRequestSha256(f.input.contract, f.input.variables);
    await expect(f.client.mutate(f.input)).rejects.toThrow("fresh native eligibility");
    expect(f.native.readOriginalClaim).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it("detects a changed named identity between native claim reads", async () => {
    const f = fixture(true);
    f.native.readOriginalClaim.mockResolvedValueOnce(structuredClone(f.record)).mockImplementationOnce(async () => {
      const changed = structuredClone(f.record); changed.intent.targetBindings!.feedbackId = "other-feedback"; return changed;
    });
    await expect(f.client.mutate(f.input)).rejects.toThrow("changed before dispatch");
    expect(f.native.compareAndSetDispatchStarted).not.toHaveBeenCalled(); expect(f.transport.execute).not.toHaveBeenCalled();
  });
  it("preserves reviewed named bindings while callers mutate their objects during claim reads", async () => {
    const f = fixture(true), reviewed = structuredClone(f.input.variables);
    f.native.readOriginalClaim.mockImplementation(async () => {
      f.input.eligibility.targetBindings!.groupId = "999";
      f.input.eligibility.targetBindings!.feedbackId = "unreviewed-feedback";
      f.input.variables.groupID = "999";
      f.input.variables.input.feedback_id = "unreviewed-feedback";
      return structuredClone(f.record);
    });
    await f.client.mutate(f.input);
    expect(f.transport.execute.mock.calls[0]![0].variables).toEqual(reviewed);
    expect(f.native.compareAndSetDispatchStarted.mock.calls[0]![0].intent.targetBindings).toEqual({ groupId: "321", postId: "321_654", feedbackId: "ZmVlZGJhY2s6NjU0" });
  });
});
