import type { FacebookFirstOriginalApiVerification, FacebookMutationClaim, FacebookMutationIntent, FacebookMutationOutcome, NativeFacebookMutationOwner } from "./client.js";
import { stableStringify } from "./util.js";

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
  readBack(intent: FacebookMutationIntent): Promise<{ state: string; operationId: string }>;
}

/** Adapts the existing native claim after its SQLite/ledger readback. There is
 * no claim writer, generated operation ID, account owner, journal or retry here.
 * Persistence and CAS remain with the original source-owned action boundary. */
export class ExistingNativeFacebookMutationOwner implements NativeFacebookMutationOwner {
  private adoptionEntered = false;
  private dispatchEntered = false;
  private dispatchCommitted = false;
  private retainedUnsubmitted = false;
  private outcomeEntered = false;
  private record?: ExistingNativeFacebookClaimRecord;
  constructor(private readonly expected: { operationId: string; sourceOwner: "membership" | "campaign" },
    private readonly native: ExistingNativeFacebookOwnerPorts) {
    if (!expected.operationId) throw new Error("An existing native Facebook operation ID is required");
    this.expected = { ...expected };
  }
  async authorizeFirstOriginalApiVerification(proof: FacebookFirstOriginalApiVerification): Promise<boolean> {
    return await this.native.authorizeFirstOriginalApiVerification?.(structuredClone(proof)) === true;
  }
  private validateRecord(record: ExistingNativeFacebookClaimRecord): void {
    if (record.intent?.operationId !== this.expected.operationId || record.intent.sourceOwner !== this.expected.sourceOwner ||
        record.intent.state !== "claimed" || record.dispatchState !== "not_started" || !/^[a-f0-9]{64}$/u.test(record.claimFingerprint)) {
      throw new Error("Original native Facebook claim is absent, changed or already dispatched");
    }
  }
  private assertIntent(intent: FacebookMutationIntent): ExistingNativeFacebookClaimRecord {
    if (!this.record || stableStringify(intent) !== stableStringify(this.record.intent)) throw new Error("Original native Facebook intent changed");
    return this.record;
  }
  async claim(input: FacebookMutationClaim): Promise<FacebookMutationIntent> {
    if (this.adoptionEntered) throw new Error("Original native Facebook claim adoption is already consumed");
    this.adoptionEntered = true;
    const expected = structuredClone(input), record = structuredClone(await this.native.readOriginalClaim());
    this.validateRecord(record);
    const { operationId: _operationId, state: _state, ...retained } = record.intent;
    if (stableStringify(retained) !== stableStringify(expected)) throw new Error("Original native Facebook request binding changed");
    this.record = record;
    return structuredClone(record.intent);
  }
  async dispatchStarted(intent: FacebookMutationIntent): Promise<void> {
    const record = this.assertIntent(intent);
    if (this.dispatchEntered || this.retainedUnsubmitted) throw new Error("Original native Facebook dispatch is already consumed or fenced");
    // Consume this adapter's path before the original owner's awaited CAS.
    // An unresolved CAS is not permission to enter it again.
    this.dispatchEntered = true;
    const current = structuredClone(await this.native.readOriginalClaim());
    this.validateRecord(current);
    if (stableStringify(current) !== stableStringify(record)) throw new Error("Original native Facebook claim changed before dispatch");
    const committed = await this.native.compareAndSetDispatchStarted(structuredClone(record));
    if (committed !== true) throw new Error("Original native Facebook dispatch CAS refused");
    this.dispatchCommitted = true;
  }
  async dispatchNotStarted(intent: FacebookMutationIntent, reason: string): Promise<void> {
    const record = this.assertIntent(intent);
    if (this.retainedUnsubmitted || this.outcomeEntered) throw new Error("Original native Facebook no-dispatch retention is already consumed");
    this.retainedUnsubmitted = true;
    await this.native.retainUnsubmitted({ ...structuredClone(record),
      dispatchState: this.dispatchCommitted ? "started" : record.dispatchState }, reason);
  }
  async recordOutcome(intent: FacebookMutationIntent, outcome: FacebookMutationOutcome): Promise<void> {
    this.assertIntent(intent);
    if (!this.dispatchCommitted || this.retainedUnsubmitted || this.outcomeEntered) throw new Error("Original native Facebook outcome has no single committed dispatch");
    this.outcomeEntered = true;
    await this.native.recordOutcome(structuredClone(intent), structuredClone(outcome));
  }
  async readBack(intent: FacebookMutationIntent): Promise<{ state: string; operationId: string }> {
    this.assertIntent(intent);
    if (!this.outcomeEntered || this.retainedUnsubmitted) throw new Error("Original native Facebook outcome has not been persisted");
    const result = await this.native.readBack(structuredClone(intent));
    if (result.operationId !== this.expected.operationId) throw new Error("Original native Facebook outcome readback changed operation");
    return result;
  }
}
