import { type FacebookContract } from "./contracts.js";
export interface ObservedFacebookRelayArtifact {
    name: string;
    documentId: string;
    kind: "query" | "mutation";
    variables: string[];
}
export declare function contractFromObservedFacebookArtifact(artifact: ObservedFacebookRelayArtifact, sourceSha256: string, observedAt: string): FacebookContract;
/** This narrow verifier admits only the observed read-only Group search. It
 * cannot promote a Join, post, comment or an HTTP-only success observation. */
export declare function verifyObservedFacebookGroupSearch(artifact: ObservedFacebookRelayArtifact, sourceSha256: string, observation: {
    observedAt: string;
    operation: ObservedFacebookRelayArtifact;
    httpStatus: number;
    graphqlState: string;
    groups: {
        id: string;
        name: string;
    }[];
    dataKeys: string[][];
    bodySha256: string;
    reaEvidenceId: string;
    pageActorVerified: boolean;
    credentialsExported: boolean;
    mutationDispatched: boolean;
}, rea: {
    evidence_id: string;
    operation: string;
    normalized_result: {
        targets: {
            type: string;
            origin: string;
            url: string;
        }[];
    };
}): FacebookContract;
