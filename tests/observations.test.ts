import { describe, expect, it } from "vitest";
import type { FacebookContract } from "../src/contracts.js";
import { observeFacebookMutation, outcomeFromNativeFacebookReadback, type NativeFacebookActionReadback } from "../src/observations.js";
import { prepareFacebookComment, prepareFacebookGroupJoin, prepareFacebookPost } from "../src/requests.js";

const now = Date.parse("2026-10-29T08:00:00.000Z");
function contract(operation: FacebookContract["operation"]): FacebookContract {
  return { operation, name: operation === "groups.join" ? "useGroupRequestToJoinMutation" : operation === "posts.create" ? "ComposerStoryCreateMutation" : "useCometUFICreateCommentMutation",
    documentId: "123", kind: "mutation", variables: ["input"], responseFields: [], evidence: "source-derived", sourceSha256: "a".repeat(64), sourceModule: "fixture", observedAt: new Date(now).toISOString(), limitations: [] };
}
describe("source-bound Facebook mutation observations", () => {
  it.each([["MEMBER", "joined"], ["REQUESTED", "pending"]])("treats server %s as a candidate requiring native readback", (state, hint) => {
    expect(observeFacebookMutation(contract("groups.join"), { state: "data", data: [{ group_request_to_join: { group: { id: "123", viewer_join_state: state } } }] }, { targetId: "123", actorId: "456" }))
      .toEqual({ kind: "candidate", resultId: "123", membershipHint: hint, requiresNativeReadback: true });
  });
  it("does not credit an optimistic client ID or a conflicting Group", () => {
    for (const id of ["client:original", "789"]) expect(observeFacebookMutation(contract("groups.join"), { state: "data", data: [{ group_request_to_join: { group: { id } } }] }, { targetId: "123", actorId: "456" }).kind).toBe("unknown");
  });
  it("reads the observed comment path without treating it as publication proof", () => {
    expect(observeFacebookMutation(contract("comments.create"), { state: "data", data: [{ comment_create: { feedback_comment_edge: { node: { id: "comment:123", author: { id: "456" } } } } }] }, { targetId: "post", actorId: "456" }))
      .toEqual({ kind: "candidate", resultId: "comment:123", actorId: "456", requiresNativeReadback: true });
  });
  it("does not infer moderation from a pending renderer or a null story", () => {
    expect(observeFacebookMutation(contract("posts.create"), { state: "data", data: [{ story_create: { story: null, comet_pending_post_cards: {} } }] }, { targetId: "123", actorId: "456" }).kind).toBe("unknown");
  });
  it("rejects different incremental object IDs and foreign actors", () => {
    const a = { story_create: { story: { id: "story:1", default_actor: { id: "456" } } } };
    const b = { story_create: { story: { id: "story:2" } } };
    expect(observeFacebookMutation(contract("posts.create"), { state: "data", data: [a, b] }, { targetId: "123", actorId: "456" }).kind).toBe("unknown");
    expect(observeFacebookMutation(contract("posts.create"), { state: "data", data: [a] }, { targetId: "123", actorId: "789" }).kind).toBe("unknown");
  });
  it("preserves provider errors without inferring an unsubmitted mutation", () => {
    expect(observeFacebookMutation(contract("posts.create"), { state: "refused", errors: [{ code: 1 }] }, { targetId: "123", actorId: "456" })).toMatchObject({ kind: "provider-error", requiresNativeReadback: true });
  });
});

describe("original native outcome binding", () => {
  function input(state: NativeFacebookActionReadback["state"], operation: "groups.join" | "posts.create" | "comments.create") {
    return { operation, operationId: "original", requestSha256: "a".repeat(64), actorId: "456", sessionId: "native", targetId: "123", dispatchedAt: new Date(now - 2_000).toISOString(),
      observation: { operationId: "original", requestSha256: "a".repeat(64), actorId: "456", sessionId: "native", targetId: "123", resultId: "123", observedAt: new Date(now - 1_000).toISOString(), state, source: "original_native_action_readback" as const } };
  }
  it.each([["groups.join", "joined", "verified"], ["groups.join", "admin_pending", "pending"], ["posts.create", "published", "verified"], ["posts.create", "moderation_pending", "pending"], ["comments.create", "commented", "verified"]] as const)("keeps %s %s separate", (operation, state, expected) => {
    expect(outcomeFromNativeFacebookReadback(input(state, operation), now)).toEqual({ state: expected, resultId: "123" });
  });
  it.each(["actorId", "sessionId", "operationId", "requestSha256", "targetId", "observedAt"] as const)("fences a changed %s", field => {
    const value = input("joined", "groups.join"); value.observation[field] = "changed";
    expect(outcomeFromNativeFacebookReadback(value, now).state).toBe("unknown");
  });
  it("does not count membership as post publication", () => {
    expect(outcomeFromNativeFacebookReadback(input("joined", "posts.create"), now).state).toBe("unknown");
  });
});

describe("reviewed Facebook wire templates", () => {
  it("binds a Group join without creating fields, IDs or changing frozen content", () => {
    const c = { ...contract("groups.join"), targetVariablePaths: ["/groupID", "/input/group_id"] };
    const original = { groupID: "old", input: { group_id: "old", client_mutation_id: "original" } };
    const prepared = prepareFacebookGroupJoin(c, original, { actorId: "456", targetId: "123" });
    expect(prepared.variables).toEqual({ groupID: "123", input: { group_id: "123", client_mutation_id: "original" } }); expect(original.groupID).toBe("old"); expect(prepared.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("binds opaque comment feedback separately from Group and canonical post", () => {
    const c = { ...contract("comments.create"), targetVariableBindings: { groupId: ["/groupID"], feedbackId: ["/input/feedback_id"] }, actorVariablePaths: ["/input/actor_id"] };
    const result = prepareFacebookComment(c, { groupID: "old", input: { feedback_id: "old-feedback", actor_id: "old-actor", message: { text: "Frozen approved text" }, idempotence_token: "original" } },
      { actorId: "456", targetId: "12_34", targets: { groupId: "123", postId: "12_34", feedbackId: "ZmVlZGJhY2s6MTI=" } });
    expect(result.variables).toMatchObject({ groupID: "123", input: { feedback_id: "ZmVlZGJhY2s6MTI=", actor_id: "456", idempotence_token: "original" } });
  });
  it("rejects a fabricated, overlapping or unsafe path before dispatch", () => {
    for (const paths of [["/missing"], ["/input/__proto__/id"], ["/input/target", "/input/target"]]) {
      expect(() => prepareFacebookPost({ ...contract("posts.create"), targetVariablePaths: paths }, { input: { target: "old" } }, { actorId: "456", targetId: "123" })).toThrow();
    }
  });
});
