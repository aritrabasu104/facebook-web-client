import { assertContract, operationForName, type FacebookContract } from "./contracts.js";

export interface ObservedFacebookRelayArtifact {
  name: string; documentId: string; kind: "query" | "mutation"; variables: string[];
}
export function contractFromObservedFacebookArtifact(artifact: ObservedFacebookRelayArtifact,
  sourceSha256: string, observedAt: string): FacebookContract {
  const operation = operationForName(artifact.name);
  if (!operation || !Array.isArray(artifact.variables) || artifact.variables.some(v => typeof v !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(v))) throw new Error("Observed Relay artifact is incomplete");
  const contract: FacebookContract = { ...structuredClone(artifact), operation, variables: [...new Set(artifact.variables)],
    responseFields: [], evidence: "runtime-artifact-observed", sourceSha256,
    sourceModule: "observed runtime artifact: " + artifact.name + ".graphql", observedAt,
    limitations: ["Client artifact observed; complete server input schema and mutation outcome remain unverified."] };
  assertContract(contract); return contract;
}

/** This narrow verifier admits only the observed read-only Group search. It
 * cannot promote a Join, post, comment or an HTTP-only success observation. */
export function verifyObservedFacebookGroupSearch(artifact: ObservedFacebookRelayArtifact, sourceSha256: string,
  observation: {
    observedAt: string; operation: ObservedFacebookRelayArtifact; httpStatus: number; graphqlState: string;
    groups: { id: string; name: string }[]; dataKeys: string[][]; bodySha256: string;
    reaEvidenceId: string; pageActorVerified: boolean; credentialsExported: boolean; mutationDispatched: boolean;
  }, rea: { evidence_id: string; operation: string; normalized_result: { targets: { type: string; origin: string; url: string }[] } }): FacebookContract {
  const contract = contractFromObservedFacebookArtifact(artifact, sourceSha256, observation.observedAt);
  const target = rea.normalized_result.targets.filter(t => t.type === "page" && t.origin === "https://www.facebook.com" &&
    t.url.startsWith("https://www.facebook.com/search/groups/?"));
  if (contract.operation !== "groups.search" || contract.kind !== "query" || artifact.name !== "SearchCometResultsPaginatedResultsQuery" ||
      observation.operation.name !== artifact.name || observation.operation.documentId !== artifact.documentId || observation.operation.kind !== "query" ||
      observation.httpStatus !== 200 || observation.graphqlState !== "data" || !/^[a-f0-9]{64}$/u.test(observation.bodySha256) ||
      observation.credentialsExported !== false || observation.mutationDispatched !== false ||
      rea.operation !== "list_browser_targets" || rea.evidence_id !== observation.reaEvidenceId || target.length !== 1 ||
      !observation.dataKeys.some(keys => keys.includes("serpResponse")) || !observation.groups.length || observation.groups.length > 100 ||
      observation.groups.some(g => !/^\d+$/u.test(g.id) || typeof g.name !== "string" || !g.name.trim()) ||
      new Set(observation.groups.map(g => g.id)).size !== observation.groups.length) {
    throw new Error("Original Group search readback does not verify this query contract");
  }
  return { ...contract, evidence: "api-readback-verified", responseFields: ["serpResponse"],
    limitations: ["Read query verified; search results do not establish Group eligibility or membership.",
      ...(observation.pageActorVerified ? [] : ["Verified in the research session; configured Page API actor remains unverified."])] };
}
