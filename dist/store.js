import { deflateSync, inflateSync } from "node:zlib";
import { sha256, stableStringify } from "./util.js";
import { assertContract } from "./contracts.js";
// REA's bounded source-analysis reply can contain up to 96 MiB. Keep that
// complete original Evidence compressed once, rather than copying projections.
const MAX_EVIDENCE_BYTES = 96 * 1024 * 1024;
/** Current protocol evidence, compressed and deduplicated in native SQLite.
 * This is a capability projection, not an action journal or another queue. */
export class FacebookApiEvidenceStore {
    db;
    constructor(db) {
        this.db = db;
        db.exec(`CREATE TABLE IF NOT EXISTS facebook_api_evidence_blobs (
      sha256 TEXT PRIMARY KEY, codec TEXT NOT NULL CHECK(codec='deflate'), raw_bytes INTEGER NOT NULL, content BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS facebook_api_contracts (
      name TEXT PRIMARY KEY, operation TEXT NOT NULL, contract_json TEXT NOT NULL, source_sha256 TEXT NOT NULL REFERENCES facebook_api_evidence_blobs(sha256));
      CREATE TABLE IF NOT EXISTS facebook_api_catalog_sources (
      role TEXT PRIMARY KEY, sha256 TEXT NOT NULL REFERENCES facebook_api_evidence_blobs(sha256));`);
    }
    putEvidence(bytes) {
        if (bytes.byteLength > MAX_EVIDENCE_BYTES)
            throw new Error("API evidence exceeds REA's supported evidence-transfer budget");
        const hash = sha256(Buffer.from(bytes));
        this.db.prepare("INSERT OR IGNORE INTO facebook_api_evidence_blobs VALUES (?,'deflate',?,?)").run(hash, bytes.byteLength, deflateSync(bytes));
        return hash;
    }
    evidence(hash) {
        const row = this.db.prepare("SELECT * FROM facebook_api_evidence_blobs WHERE sha256=?").get(hash);
        if (!row)
            throw new Error("Missing original Facebook API evidence");
        const bytes = inflateSync(row.content, { maxOutputLength: MAX_EVIDENCE_BYTES });
        if (sha256(bytes) !== hash || bytes.length !== row.raw_bytes)
            throw new Error("Facebook evidence integrity failed");
        return bytes;
    }
    install(contracts, sources, supporting) {
        contracts.forEach(assertContract);
        if (new Set(contracts.map(c => c.name)).size !== contracts.length)
            throw new Error("Conflicting Facebook contracts");
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const existing = new Map(this.contracts().map(c => [c.name, c]));
            this.db.exec("DELETE FROM facebook_api_contracts; DELETE FROM facebook_api_catalog_sources;");
            for (const [expectedHash, bytes] of Object.entries(sources))
                if (this.putEvidence(bytes) !== expectedHash)
                    throw new Error("Facebook source digest changed");
            for (const c of contracts) {
                if (!sources[c.sourceSha256])
                    throw new Error("Contract lacks its exact static source");
                // A discovery rerun must never silently overwrite an API verification
                // with a different document or source revision.
                const old = existing.get(c.name);
                if (old?.evidence === "api-readback-verified" && stableStringify(old) !== stableStringify(c))
                    throw new Error("Verified Facebook contract needs explicit source-owned retirement");
                this.db.prepare("INSERT INTO facebook_api_contracts VALUES (?,?,?,?)").run(c.name, c.operation, JSON.stringify(c), c.sourceSha256);
            }
            for (const [role, bytes] of Object.entries(supporting))
                this.db.prepare("INSERT INTO facebook_api_catalog_sources VALUES (?,?)").run(role, this.putEvidence(bytes));
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    contracts() {
        return this.db.prepare("SELECT contract_json FROM facebook_api_contracts ORDER BY operation,name").all().map(r => JSON.parse(r.contract_json));
    }
    /** Called by the foreground evidence owner after installing a new catalog.
     * Native accepted/unknown operations supply any original evidence pins. */
    pruneUnreferenced(protectedNativeHashes) {
        const keep = new Set([...protectedNativeHashes,
            ...this.db.prepare("SELECT source_sha256 sha256 FROM facebook_api_contracts UNION SELECT sha256 FROM facebook_api_catalog_sources").all().map(r => String(r.sha256))]);
        // Existing native audits own restart/refusal receipts independently of the
        // current research catalog. Catalog refresh must not orphan their custody.
        if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_events'").get()) {
            for (const row of this.db.prepare(`SELECT DISTINCT j.value sha256 FROM audit_events a,json_tree(a.payload_json) j
        WHERE a.event_type LIKE 'facebook.%' AND j.type='text' AND length(j.value)=64`).all()) {
                if (/^[a-f0-9]{64}$/u.test(String(row.sha256)))
                    keep.add(String(row.sha256));
            }
        }
        let removed = 0;
        for (const row of this.db.prepare("SELECT sha256 FROM facebook_api_evidence_blobs").all())
            if (!keep.has(String(row.sha256)))
                removed += Number(this.db.prepare("DELETE FROM facebook_api_evidence_blobs WHERE sha256=?").run(row.sha256).changes);
        return removed;
    }
}
