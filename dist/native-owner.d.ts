import type { FacebookFirstOriginalApiVerification, FacebookMutationClaim, FacebookMutationIntent, FacebookMutationOutcome, NativeFacebookMutationOwner } from "./client.js";
export interface ExistingNativeFacebookClaimRecord {
    intent: FacebookMutationIntent;
    /** Hash of the original native claim's immutable provenance/request. */
    claimFingerprint: string;
    /** Unknown, started and terminal native attempts are never adopted. */
    dispatchState: "not_started" | "started" | "settled" | "unknown";
}
export interface ExistingNativeFacebookOwnerPorts {
    authorizeFirstOriginalApiVerification?(proof: FacebookFirstOriginalApiVerification): Promise<boolean>;
    readOriginalClaim(): Promise<ExistingNativeFacebookClaimRecord>;
    /** The original account/journal owner atomically checks the unchanged claim,
     * consumes its one dispatch, and refuses any earlier UI/API attempt. */
    compareAndSetDispatchStarted(record: ExistingNativeFacebookClaimRecord): Promise<boolean>;
    /** Record that the caller sent no provider bytes, retaining the consumed
     * native intent/fence even if its pre-dispatch CAS already committed. */
    retainUnsubmitted(record: ExistingNativeFacebookClaimRecord, reason: string): Promise<void>;
    recordOutcome(intent: FacebookMutationIntent, outcome: FacebookMutationOutcome): Promise<void>;
    readBack(intent: FacebookMutationIntent): Promise<{
        state: string;
        operationId: string;
    }>;
}
/** Adapts the existing native claim after its SQLite/ledger readback. There is
 * no claim writer, generated operation ID, account owner, journal or retry here.
 * Persistence and CAS remain with the original source-owned action boundary. */
export declare class ExistingNativeFacebookMutationOwner implements NativeFacebookMutationOwner {
    private readonly expected;
    private readonly native;
    private adoptionEntered;
    private dispatchEntered;
    private dispatchCommitted;
    private retainedUnsubmitted;
    private outcomeEntered;
    private record?;
    constructor(expected: {
        operationId: string;
        sourceOwner: "membership" | "campaign";
    }, native: ExistingNativeFacebookOwnerPorts);
    authorizeFirstOriginalApiVerification(proof: FacebookFirstOriginalApiVerification): Promise<boolean>;
    private validateRecord;
    private assertIntent;
    claim(input: FacebookMutationClaim): Promise<FacebookMutationIntent>;
    dispatchStarted(intent: FacebookMutationIntent): Promise<void>;
    dispatchNotStarted(intent: FacebookMutationIntent, reason: string): Promise<void>;
    recordOutcome(intent: FacebookMutationIntent, outcome: FacebookMutationOutcome): Promise<void>;
    readBack(intent: FacebookMutationIntent): Promise<{
        state: string;
        operationId: string;
    }>;
}
