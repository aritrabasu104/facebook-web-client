import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapFacebookApiFirstSession } from "../src/session-bootstrap.js";
import { CapturedFacebookRequestSession } from "../src/http-session.js";
import type { FacebookContract } from "../src/contracts.js";
const actorId = "101", actorUrl = `https://www.facebook.com/profile.php?id=${actorId}`, displayName = "Example Page";
afterEach(() => { vi.unstubAllGlobals(); });
function fixture() {
  const at = new Date().toISOString(), actor = { actorId, actorUrl, sessionId: "original-native-session", verifiedAt: at };
  const contract = (identity = false): FacebookContract => ({ name: identity ? "CometSettingsDropdownTriggerQuery" : "CometGroupAboutRootQuery", operation: identity ? "identity.read" : "groups.inspect",
    documentId: identity ? "10003" : "10004", kind: "query", variables: [], responseFields: [], evidence: "api-readback-verified",
    sourceSha256: "a".repeat(64), sourceModule: "first-party-source", observedAt: at, limitations: [] });
  const captured = new CapturedFacebookRequestSession({ cookie: "c_user=unit-test-private; xs=unit-test-private", "user-agent": "Chrome test", referer: actorUrl }, "__user=202&fb_dtsg=unit-test-private&lsd=unit-test-private&av=615");
  const destroy = vi.spyOn(captured, "destroy"), consume = vi.spyOn(captured, "consume");
  const page: any = { url: vi.fn(() => actorUrl), evaluate: vi.fn(async (_fn: any, arg: any) => typeof arg === "string" ? true : { status: 200, body: '{"data":{"group":{"id":"123"}}}' }),
    captureQuerySessionBootstrap: vi.fn(async (_name: string, probe: () => Promise<unknown>) => ({ result: await probe(), bootstrap: captured })) };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { viewer: { actor: { id: actorId, name: displayName } } } })));
  vi.stubGlobal("fetch", fetcher);
  const input = { page, originalSessionId: actor.sessionId, configuredActor: { actorId, actorUrl, displayName }, nativeActorProof: vi.fn(async () => ({ ...actor })),
    identity: { contract: contract(true), variables: {} }, probe: { contract: contract(), variables: { groupID: "123" } } };
  return { input, captured, consume, destroy, page, fetcher };
}
describe("Facebook API session bootstrap is a bounded read-only recovery boundary", () => {
  it('returns an exact quota error before consuming the captured session and never retries the bootstrap read',async()=>{
    const f=fixture(),response={status:200,body:'{"errors":[{"code":1675004,"message":"Rate limit exceeded"}]}',retryAfter:'900'};
    f.page.evaluate.mockImplementation(async(_fn:any,arg:any)=>typeof arg==='string'?true:response);
    await expect(bootstrapFacebookApiFirstSession(f.input)).rejects.toMatchObject({name:'FacebookRateLimitError',response,observation:{reason:'graphql_1675004',retryAfter:'900'}});
    expect(f.consume).not.toHaveBeenCalled();expect(f.destroy).toHaveBeenCalledOnce();expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.page.captureQuerySessionBootstrap).toHaveBeenCalledOnce();
  });
  it("requires native Page proof and a successful captured read before direct HTTP identity", async () => {
    const f = fixture(), session = await bootstrapFacebookApiFirstSession(f.input);
    expect(f.input.nativeActorProof).toHaveBeenCalledTimes(2); expect(f.consume).toHaveBeenCalledTimes(1); expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(f.page.captureQuerySessionBootstrap).toHaveBeenCalledWith("CometGroupAboutRootQuery", expect.any(Function));
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const options: any = (f.fetcher.mock.calls as any[])[0][1]; expect(options.body.get("fb_api_req_friendly_name")).toBe("CometSettingsDropdownTriggerQuery");
    const browserCalls = f.page.evaluate.mock.calls.length;
    expect((await session.verifyActor()).actorId).toBe(actorId); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.page.evaluate).toHaveBeenCalledTimes(browserCalls); expect(JSON.stringify(session)).not.toContain("unit-test-private");
    session.destroy(); expect(() => f.captured.consume({ actorId, actorUrl, sessionId: "original-native-session", verifiedAt: new Date().toISOString() })).toThrow(/already consumed/);
  });
  it("refuses a different native actor before the captured request is dispatched", async () => {
    const f = fixture(); f.input.nativeActorProof.mockResolvedValue({ ...await f.input.nativeActorProof(), actorId: "999" });
    await expect(bootstrapFacebookApiFirstSession(f.input)).rejects.toThrow(/identity_unverified/);
    expect(f.page.evaluate).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.consume).not.toHaveBeenCalled();
  });
  it("rejects a captured read failure without consuming credentials", async () => {
    const f = fixture(); f.page.evaluate.mockImplementation(async (_fn: any, arg: any) => typeof arg === "string" ? true : { status: 200, body: '{"errors":[{"message":"read unavailable"}]}' });
    await expect(bootstrapFacebookApiFirstSession(f.input)).rejects.toThrow(/unavailable/);
    expect(f.consume).not.toHaveBeenCalled(); expect(f.destroy).toHaveBeenCalledTimes(1); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects a mismatched HTTP Page and destroys the consumed session without retry", async () => {
    const f = fixture(); f.fetcher.mockImplementation(async () => new Response('{"data":{"viewer":{"actor":{"id":"999","name":"Other"}}}}'));
    await expect(bootstrapFacebookApiFirstSession(f.input)).rejects.toThrow(/identity_unverified/);
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.consume).toHaveBeenCalledTimes(1); expect(f.destroy).toHaveBeenCalledTimes(1);
  });
  it("rejects mutation or future-dated probe templates before any browser or HTTP call", async () => {
    for (const kind of ["mutation", "future"] as const) {
      const f = fixture(); if (kind === "mutation") f.input.probe.contract.kind = "mutation"; else f.input.probe.contract.observedAt = "2999-01-01T00:00:00.000Z";
      await expect(bootstrapFacebookApiFirstSession(f.input)).rejects.toThrow(); expect(f.page.captureQuerySessionBootstrap).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it('reuses a retained identity definition while requiring fresh browser and HTTP actor verification',async()=>{
    const f=fixture();f.input.identity.contract.observedAt=f.input.probe.contract.observedAt='2020-01-01T00:00:00.000Z';
    const session=await bootstrapFacebookApiFirstSession(f.input);
    expect(f.input.nativeActorProof).toHaveBeenCalledTimes(2);expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.input.identity.contract.observedAt).toBe('2020-01-01T00:00:00.000Z');session.destroy();
  });
});
