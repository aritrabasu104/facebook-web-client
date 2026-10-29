import { describe, expect, it } from "vitest";
import { contractFromObservedFacebookArtifact, verifyObservedFacebookGroupSearch } from "../src/verification.js";

function fixture() {
  const artifact = { name: "SearchCometResultsPaginatedResultsQuery", documentId: "10001", kind: "query" as const, variables: ["args", "count", "cursor"] };
  const observation = { observedAt: "2026-10-29T08:00:00.000Z", operation: artifact, httpStatus: 200, graphqlState: "data", groups: [{ id: "123", name: "Travel" }],
    dataKeys: [["serpResponse"]], bodySha256: "a".repeat(64), reaEvidenceId: "original-rea-evidence", pageActorVerified: false, credentialsExported: false, mutationDispatched: false };
  const rea = { evidence_id: "original-rea-evidence", operation: "list_browser_targets", normalized_result: { targets: [{ type: "page", origin: "https://www.facebook.com", url: "https://www.facebook.com/search/groups/?q=travel" }] } };
  return { artifact, observation, rea };
}
describe("source-owned Facebook read verification", () => {
  it("verifies a business read without claiming Page identity or Group eligibility", () => {
    const f = fixture(), result = verifyObservedFacebookGroupSearch(f.artifact, "b".repeat(64), f.observation, f.rea);
    expect(result.evidence).toBe("api-readback-verified"); expect(result.kind).toBe("query");
    expect(result.limitations.join(" ")).toContain("configured Page API actor remains unverified");
  });
  it.each(["HTTP-only", "different-document", "missing-Group", "duplicate-Group", "different-REA", "credential-export", "mutation"])("rejects %s evidence", reason => {
    const f = fixture();
    if (reason === "HTTP-only") f.observation.graphqlState = "unknown";
    if (reason === "different-document") f.observation.operation = { ...f.artifact, documentId: "other" };
    if (reason === "missing-Group") f.observation.groups = [];
    if (reason === "duplicate-Group") f.observation.groups.push({ ...f.observation.groups[0]! });
    if (reason === "different-REA") f.rea.evidence_id = "another";
    if (reason === "credential-export") f.observation.credentialsExported = true;
    if (reason === "mutation") f.observation.mutationDispatched = true;
    expect(() => verifyObservedFacebookGroupSearch(f.artifact, "b".repeat(64), f.observation, f.rea)).toThrow();
  });
  it("retains a newly observed join variant without upgrading its effect to provider success", () => {
    const c = contractFromObservedFacebookArtifact({ name: "GroupCometJoinForumMutation", documentId: "10002", kind: "mutation", variables: ["groupID", "input"] }, "b".repeat(64), "2026-10-29T08:00:00.000Z");
    expect(c.operation).toBe("groups.join"); expect(c.evidence).toBe("runtime-artifact-observed");
  });
});
