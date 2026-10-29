/** Reject transport credentials before invoking REA or retaining a capture. */
export function requireCredentialFreeFacebookHar(har: any): void {
  if (har?.log?.version !== "1.2" || !Array.isArray(har.log.entries)) throw new Error("Expected a HAR 1.2 capture");
  const secretHeaders = new Set(["authorization", "proxy-authorization", "cookie", "cookie2", "set-cookie", "x-fb-lsd", "x-csrf-token", "x-xsrf-token"]);
  const fields = new Set(["fb_api_req_friendly_name", "doc_id", "variables"]);
  for (const entry of har.log.entries) {
    if (entry.request?.url !== "https://www.facebook.com/api/graphql/" || entry.request.method !== "POST") throw new Error("Capture contains an unselected API destination");
    if (entry.request.cookies?.length || entry.response?.cookies?.length || entry.request.postData?.text ||
        [...(entry.request.headers ?? []), ...(entry.response?.headers ?? [])].some(h => secretHeaders.has(String(h.name).toLowerCase()))) throw new Error("Remove transport credentials before Facebook REA analysis");
    if (!Array.isArray(entry.request.postData?.params) || entry.request.postData.params.some((p: any) => !fields.has(p.name) || typeof p.value !== "string")) throw new Error("Capture form fields are not credential-free");
  }
}
