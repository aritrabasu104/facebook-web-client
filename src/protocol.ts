import type { FacebookOperationCoordinator } from "./concurrency.js";
import { FACEBOOK_GRAPHQL_URL, assertContract, type FacebookContract } from "./contracts.js";
import { inspect } from "node:util";
import { sha256 } from "./util.js";

export interface FacebookGraphqlRequest { url: typeof FACEBOOK_GRAPHQL_URL; method: "POST"; operation: FacebookContract; variables: Record<string, unknown> }
export interface FacebookGraphqlResponse { status: number; body: string; retryAfter?: string }
export type FacebookGraphqlResult = { state: "data"; data: Record<string, unknown>[] } |
  { state: "refused"; errors: unknown[] } | { state: "unknown"; reason: string };

function graphqlFrames(body: string): unknown[] {
  const text = body.replace(/^\s*for\s*\(;;\);\s*/u, "").trim();
  try { return [JSON.parse(text)]; } catch { return text.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)); }
}
export interface FacebookRateLimitObservation { reason: "http_429" | "graphql_1675004"; retryAfter?: string }
/** Classification only. A rate limit never proves non-delivery, retries a
 * request, changes an actor, or grants a new mutation allowance. */
export function facebookRateLimitObservation(response: FacebookGraphqlResponse): FacebookRateLimitObservation | undefined {
  let limited = response.status === 429;
  if (!limited && typeof response.body === "string" && response.body.length <= 8 * 1024 * 1024) {
    try {
      limited = graphqlFrames(response.body).some(frame => {
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
        const row = frame as Record<string, any>;
        const errors = [...(Array.isArray(row.errors) ? row.errors : []),
          ...(Array.isArray(row.incremental) ? row.incremental.flatMap(patch => Array.isArray(patch?.errors) ? patch.errors : []) : []),
          ...(row.error ? [{code: row.error}] : [])];
        return errors.some(error => error && typeof error === "object" &&
          (error.code === 1675004 || error.code === "1675004"));
      });
    } catch { /* An unreadable body never invents a GraphQL refusal. */ }
  }
  if (!limited) return undefined;
  const value = response.retryAfter;
  const retryAfter = typeof value === "string" && value.length <= 128 && !/[\r\n]/u.test(value) &&
    (/^\d+(?:\.\d+)?$/u.test(value) || Number.isFinite(Date.parse(value))) ? value : undefined;
  return {reason: response.status === 429 ? "http_429" : "graphql_1675004", ...(retryAfter ? {retryAfter} : {})};
}
/** An unsubmitted identity/bootstrap read may expose its exact returned bytes
 * to the native owner's evidence store. Default serialization omits the body. */
export class FacebookRateLimitError extends Error {
  readonly observation: FacebookRateLimitObservation;
  readonly response: FacebookGraphqlResponse;
  readonly request: FacebookGraphqlRequest;
  constructor(response: FacebookGraphqlResponse, request: FacebookGraphqlRequest, readonly observedAt = new Date().toISOString()) {
    super("Facebook API rate limit exceeded"); this.name = "FacebookRateLimitError";
    const observation = facebookRateLimitObservation(response);
    if (!observation || !Number.isFinite(Date.parse(observedAt))) throw new Error("An actual rate-limited response is required");
    this.observation = observation; this.response = structuredClone(response); this.request = structuredClone(request);
  }
  toJSON() { return {name: this.name, observation: this.observation, observedAt: this.observedAt,
    operation: this.request.operation.name, responseSha256: sha256(this.response.body)}; }
  [inspect.custom]() { return this.toJSON(); }
}

/** Facebook returns JSON, anti-hijack prefixes, or newline-delimited patches. */
export function parseFacebookGraphqlResponse(response: FacebookGraphqlResponse): FacebookGraphqlResult {
  if (response.status < 200 || response.status >= 300) return { state: "unknown", reason: "non_success_http_status" };
  const data: Record<string, unknown>[] = [], errors: unknown[] = [];
  try {
    const body = response.body.replace(/^\s*for\s*\(;;\);\s*/u, "").trim();
    if (!body || body.length > 8 * 1024 * 1024) return { state: "unknown", reason: "missing_or_oversized_graphql_body" };
    const frames = graphqlFrames(body);
    for (const frame of frames) {
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) return { state: "unknown", reason: "invalid_graphql_envelope" };
      const row = frame as Record<string, unknown>;
      if (Array.isArray(row.errors)) errors.push(...row.errors);
      if (row.error || row.errorSummary || row.errorDescription) errors.push({ code: row.error });
      if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) data.push(row.data as Record<string, unknown>);
      if (Array.isArray(row.incremental)) for (const patch of row.incremental) if (Array.isArray(patch?.errors)) errors.push(...patch.errors);
    }
    // A partial-data error cannot establish a successful write.
    if (errors.length && data.length) return { state: "unknown", reason: "partial_data_with_graphql_errors" };
    if (errors.length) return { state: "refused", errors };
    return data.length ? { state: "data", data } : { state: "unknown", reason: "graphql_data_unavailable" };
  } catch { return { state: "unknown", reason: "graphql_body_unreadable" }; }
}

export function graphqlRequest(operation: FacebookContract, variables: Record<string, unknown>): FacebookGraphqlRequest {
  assertContract(operation);
  if (JSON.stringify(variables).length > 1_048_576) throw new Error("Facebook request exceeds the supported foreground payload budget");
  return { url: FACEBOOK_GRAPHQL_URL, method: "POST", operation, variables };
}

/** Session credentials are supplied inside the native transport, never here. */
export interface FacebookSessionTransport {
  /** Wrappers must forward this instance when they share an authenticated session. */
  readonly coordination?: FacebookOperationCoordinator;
  verifyActor(): Promise<{ actorUrl: string; actorId: string; verifiedAt: string; sessionId: string }>;
  execute(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse>;
}
