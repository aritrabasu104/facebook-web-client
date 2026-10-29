import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookBrowserSessionTransport } from "../src/browser-session.js";
import { graphqlRequest } from "../src/protocol.js";
import type { FacebookContract } from "../src/contracts.js";

const origin = "https://www.facebook.com", at = "2026-10-29T08:00:00.000Z";
const contract: FacebookContract = { operation: "groups.search", name: "SearchCometResultsPaginatedResultsQuery", documentId: "123", kind: "query", variables: [], responseFields: [],
  evidence: "api-readback-verified", sourceSha256: "a".repeat(64), sourceModule: "fixture", observedAt: at, limitations: [] };
function fixture() {
  const initial = { USER_ID: "101", ACCOUNT_ID: "202" }, params: Record<string, any> = { __user: "202", __a: 1, fb_dtsg: "fixture-CSRF", lsd: "fixture-LSD", __req: "original" };
  const load = vi.fn((name: string) => { if (name === "CurrentUserInitialData") return initial; if (name === "getAsyncParams") return (method: string) => { expect(method).toBe("POST"); return { ...params }; }; throw Error("Unexpected module"); });
  vi.stubGlobal("window", { require: load }); vi.stubGlobal("location", { origin });
  const fetcher = vi.fn(async () => new Response('{"data":{"serpResponse":{}}}', { status: 200 })); vi.stubGlobal("fetch", fetcher);
  const page = { url: () => origin + "/groups/321/", evaluate: async (fn: any, arg: any) => fn(arg) };
  const actor = vi.fn(async () => ({ actorId: "101", actorUrl: origin + "/profile.php?id=101", sessionId: "original", verifiedAt: at }));
  return { initial, params, fetcher, actor, transport: new FacebookBrowserSessionTransport(page, "original", actor) };
}
afterEach(() => vi.unstubAllGlobals());
describe("first-party Facebook session parameters", () => {
  it("keeps the acting Page distinct from the authenticated principal and exports no credentials", async () => {
    const f = fixture(), result = await f.transport.execute(graphqlRequest(contract, {}));
    const [, options] = (f.fetcher.mock.calls as any[])[0], body: URLSearchParams = options.body;
    expect(body.get("av")).toBe("101"); expect(body.get("__user")).toBe("202");
    expect(body.get("__req")).toBe("original"); expect(body.get("fb_dtsg")).toBe("fixture-CSRF");
    expect(options.credentials).toBe("same-origin"); expect(options.redirect).toBe("error");
    expect(result).toEqual({ status: 200, body: '{"data":{"serpResponse":{}}}' });
    expect(JSON.stringify(result)).not.toContain("fixture-CSRF");
  });
  it.each(["actor", "principal", "CSRF", "LSD", "complex-param"])("refuses changed %s before sending bytes", async kind => {
    const f = fixture();
    if (kind === "actor") f.initial.USER_ID = "303";
    if (kind === "principal") f.params.__user = "404";
    if (kind === "CSRF") delete f.params.fb_dtsg;
    if (kind === "LSD") delete f.params.lsd;
    if (kind === "complex-param") f.params.unobserved = { unsupported: true };
    await expect(f.transport.execute(graphqlRequest(contract, {}))).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("preserves the observed Page-mode first-party principal without substituting the account", async () => {
    const f = fixture(); f.params.__user = "101";
    await f.transport.execute(graphqlRequest(contract, {}));
    const body = (f.fetcher.mock.calls as any[])[0][1].body as URLSearchParams;
    expect(body.get("__user")).toBe("101"); expect(body.get("av")).toBe("101");
  });
});
