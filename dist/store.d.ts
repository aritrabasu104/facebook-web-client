import { DatabaseSync } from "node:sqlite";
import { type FacebookContract } from "./contracts.js";
/** Current protocol evidence, compressed and deduplicated in native SQLite.
 * This is a capability projection, not an action journal or another queue. */
export declare class FacebookApiEvidenceStore {
    private readonly db;
    constructor(db: DatabaseSync);
    putEvidence(bytes: Uint8Array): string;
    evidence(hash: string): Buffer;
    install(contracts: FacebookContract[], sources: Record<string, Uint8Array>, supporting: Record<string, Uint8Array>): void;
    contracts(): FacebookContract[];
    /** Called by the foreground evidence owner after installing a new catalog.
     * Native accepted/unknown operations supply any original evidence pins. */
    pruneUnreferenced(protectedNativeHashes: readonly string[]): number;
}
