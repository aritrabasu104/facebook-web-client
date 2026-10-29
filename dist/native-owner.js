import { stableStringify } from "./util.js";
/** Adapts the existing native claim after its SQLite/ledger readback. There is
 * no claim writer, generated operation ID, account owner, journal or retry here.
 * Persistence and CAS remain with the original source-owned action boundary. */
export class ExistingNativeFacebookMutationOwner {
    expected;
    native;
    adoptionEntered = false;
    dispatchEntered = false;
    dispatchCommitted = false;
    retainedUnsubmitted = false;
    outcomeEntered = false;
    record;
    constructor(expected, native) {
        this.expected = expected;
        this.native = native;
        if (!expected.operationId)
            throw new Error("An existing native Facebook operation ID is required");
        this.expected = { ...expected };
    }
    async authorizeFirstOriginalApiVerification(proof) {
        return await this.native.authorizeFirstOriginalApiVerification?.(structuredClone(proof)) === true;
    }
    validateRecord(record) {
        if (record.intent?.operationId !== this.expected.operationId || record.intent.sourceOwner !== this.expected.sourceOwner ||
            record.intent.state !== "claimed" || record.dispatchState !== "not_started" || !/^[a-f0-9]{64}$/u.test(record.claimFingerprint)) {
            throw new Error("Original native Facebook claim is absent, changed or already dispatched");
        }
    }
    assertIntent(intent) {
        if (!this.record || stableStringify(intent) !== stableStringify(this.record.intent))
            throw new Error("Original native Facebook intent changed");
        return this.record;
    }
    async claim(input) {
        if (this.adoptionEntered)
            throw new Error("Original native Facebook claim adoption is already consumed");
        this.adoptionEntered = true;
        const expected = structuredClone(input), record = structuredClone(await this.native.readOriginalClaim());
        this.validateRecord(record);
        const { operationId: _operationId, state: _state, ...retained } = record.intent;
        if (stableStringify(retained) !== stableStringify(expected))
            throw new Error("Original native Facebook request binding changed");
        this.record = record;
        return structuredClone(record.intent);
    }
    async dispatchStarted(intent) {
        const record = this.assertIntent(intent);
        if (this.dispatchEntered || this.retainedUnsubmitted)
            throw new Error("Original native Facebook dispatch is already consumed or fenced");
        // Consume this adapter's path before the original owner's awaited CAS.
        // An unresolved CAS is not permission to enter it again.
        this.dispatchEntered = true;
        const current = structuredClone(await this.native.readOriginalClaim());
        this.validateRecord(current);
        if (stableStringify(current) !== stableStringify(record))
            throw new Error("Original native Facebook claim changed before dispatch");
        const committed = await this.native.compareAndSetDispatchStarted(structuredClone(record));
        if (committed !== true)
            throw new Error("Original native Facebook dispatch CAS refused");
        this.dispatchCommitted = true;
    }
    async dispatchNotStarted(intent, reason) {
        const record = this.assertIntent(intent);
        if (this.retainedUnsubmitted || this.outcomeEntered)
            throw new Error("Original native Facebook no-dispatch retention is already consumed");
        this.retainedUnsubmitted = true;
        await this.native.retainUnsubmitted({ ...structuredClone(record),
            dispatchState: this.dispatchCommitted ? "started" : record.dispatchState }, reason);
    }
    async recordOutcome(intent, outcome) {
        this.assertIntent(intent);
        if (!this.dispatchCommitted || this.retainedUnsubmitted || this.outcomeEntered)
            throw new Error("Original native Facebook outcome has no single committed dispatch");
        this.outcomeEntered = true;
        await this.native.recordOutcome(structuredClone(intent), structuredClone(outcome));
    }
    async readBack(intent) {
        this.assertIntent(intent);
        if (!this.outcomeEntered || this.retainedUnsubmitted)
            throw new Error("Original native Facebook outcome has not been persisted");
        const result = await this.native.readBack(structuredClone(intent));
        if (result.operationId !== this.expected.operationId)
            throw new Error("Original native Facebook outcome readback changed operation");
        return result;
    }
}
