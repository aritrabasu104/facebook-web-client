import { FACEBOOK_GRAPHQL_URL, assertContract } from "./contracts.js";
/** Facebook returns JSON, anti-hijack prefixes, or newline-delimited patches. */
export function parseFacebookGraphqlResponse(response) {
    if (response.status < 200 || response.status >= 300)
        return { state: "unknown", reason: "non_success_http_status" };
    const data = [], errors = [];
    try {
        const body = response.body.replace(/^\s*for\s*\(;;\);\s*/u, "").trim();
        if (!body || body.length > 8 * 1024 * 1024)
            return { state: "unknown", reason: "missing_or_oversized_graphql_body" };
        let frames;
        try {
            frames = [JSON.parse(body)];
        }
        catch {
            frames = body.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
        }
        for (const frame of frames) {
            if (!frame || typeof frame !== "object" || Array.isArray(frame))
                return { state: "unknown", reason: "invalid_graphql_envelope" };
            const row = frame;
            if (Array.isArray(row.errors))
                errors.push(...row.errors);
            if (row.error || row.errorSummary || row.errorDescription)
                errors.push({ code: row.error });
            if (row.data && typeof row.data === "object" && !Array.isArray(row.data))
                data.push(row.data);
            if (Array.isArray(row.incremental))
                for (const patch of row.incremental)
                    if (Array.isArray(patch?.errors))
                        errors.push(...patch.errors);
        }
        // A partial-data error cannot establish a successful write.
        if (errors.length && data.length)
            return { state: "unknown", reason: "partial_data_with_graphql_errors" };
        if (errors.length)
            return { state: "refused", errors };
        return data.length ? { state: "data", data } : { state: "unknown", reason: "graphql_data_unavailable" };
    }
    catch {
        return { state: "unknown", reason: "graphql_body_unreadable" };
    }
}
export function graphqlRequest(operation, variables) {
    assertContract(operation);
    if (JSON.stringify(variables).length > 1_048_576)
        throw new Error("Facebook request exceeds the supported foreground payload budget");
    return { url: FACEBOOK_GRAPHQL_URL, method: "POST", operation, variables };
}
