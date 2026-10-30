import { describe, it, expect, vi } from "vitest";
import { FacebookHttpSessionTransport, FacebookSessionRecoveryRequired, bootstrapFacebookHttpSession } from "../src/http-session.js";
import { graphqlRequest, FacebookRateLimitError } from "../src/protocol.js";
import type { FacebookContract } from "../src/contracts.js";
const at = Date.parse("2026-10-29T11:00:00Z");
const actor = { actorUrl: "https://www.facebook.com/profile.php?id=615", actorId: "615", verifiedAt: new Date(at).toISOString(), sessionId: "original" };
const contract: FacebookContract = { name: "SearchCometResultsPaginatedResultsQuery", operation: "groups.search", documentId: "123", kind: "query", variables: [], responseFields: [],
  evidence: "api-readback-verified", sourceSha256: "a".repeat(64), sourceModule: "fixture", observedAt: actor.verifiedAt, limitations: [] };
const identityContract: FacebookContract = { ...contract, name: "CometSettingsDropdownTriggerQuery", operation: "identity.read", documentId: "456" };
const identityResponse = () => new Response('{"data":{"viewer":{"actor":{"id":"615","name":"Brand"}}}}');
function fixture(response = new Response('{"data":{"serpResponse":{}}}'), ttlMs = 120_000) {
  let now = at; const fetcher = vi.fn(async () => response.clone());
  const seed = { actor, params: { __user: "615", fb_dtsg: "secret-csrf", lsd: "secret-lsd" }, userAgent: "Chrome fixture", referer: actor.actorUrl,
    cookies: [{ name: "c_user", value: "secret-cookie", domain: ".facebook.com", path: "/", secure: true }] };
  const transport = new FacebookHttpSessionTransport(seed, { fetch: fetcher as typeof fetch, now: () => now, ttlMs });
  return { seed, fetcher, transport, now: () => now, setNow: (value: number) => { now = value; } };
}
function verifiedReader(f: ReturnType<typeof fixture>) {
  f.transport.setActorReadback(async query => { await query(graphqlRequest(identityContract, {})); return { ...actor, verifiedAt: new Date(f.now()).toISOString() }; });
}

describe('parallel HTTP actor verification', () => {
  it('shares one real in-flight identity read across concurrent campaigns', async () => {
    const f = fixture(identityResponse()); verifiedReader(f);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
    f.fetcher.mockImplementation(async () => { enter(); await gate; return identityResponse(); });
    const reads = [f.transport.verifyActor(), f.transport.verifyActor(), f.transport.verifyActor()];
    await entered; expect(f.fetcher).toHaveBeenCalledTimes(1); release();
    const actors = await Promise.all(reads);
    expect(actors.map(a => a.actorId)).toEqual(['615', '615', '615']);
    expect(actors[1]).not.toBe(actors[2]); actors[1]!.actorId = 'changed-by-one-caller';
    expect(actors[2]!.actorId).toBe('615');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('propagates an identity refusal to every waiter without a retry or credential revival', async () => {
    const f = fixture(new Response(null, { status: 403 })); verifiedReader(f);
    const results = await Promise.allSettled([f.transport.verifyActor(), f.transport.verifyActor()]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']); expect(f.fetcher).toHaveBeenCalledTimes(1); cleared(f);
  });
});
function cleared(f: ReturnType<typeof fixture>) {
  expect((f.transport as any).params.size).toBe(0); expect((f.transport as any).cookies.size).toBe(0); expect(f.transport.toJSON().destroyed).toBe(true);
}
describe("Facebook API-first memory-only HTTP session", () => {
  it('retains a rate-limited identity read without renewing its idle lease, then requires a real successful read',async()=>{
    const f=fixture(new Response('{"errors":[{"code":1675004}]}',{headers:{'Retry-After':'30'}}));verifiedReader(f);
    f.setNow(at+60_000);
    await expect(f.transport.verifyActor()).rejects.toBeInstanceOf(FacebookRateLimitError);
    expect(f.fetcher).toHaveBeenCalledTimes(1);expect((f.transport as any).expiresAt).toBe(at+120_000);
    f.setNow(at+90_000);f.fetcher.mockImplementation(async()=>identityResponse());
    await expect(f.transport.verifyActor()).resolves.toMatchObject({actorId:'615'});
    expect((f.transport as any).expiresAt).toBe(at+210_000);expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('never revives an identity lease which expired during the native cooldown',async()=>{
    const f=fixture(new Response('',{status:429,headers:{'Retry-After':'900'}}));verifiedReader(f);
    await expect(f.transport.verifyActor()).rejects.toBeInstanceOf(FacebookRateLimitError);
    f.setNow(at+120_001);await expect(f.transport.verifyActor()).rejects.toThrow('expired');
    expect(f.fetcher).toHaveBeenCalledTimes(1);cleared(f);
  });
  it("sends directly to Facebook after bootstrap, preserves first-party principal and exposes no secrets", async () => {
    const f = fixture(), result = await f.transport.execute(graphqlRequest(contract, {}));
    expect(result.status).toBe(200); expect(f.fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = (f.fetcher.mock.calls as any[])[0];
    expect(url).toBe("https://www.facebook.com/api/graphql/"); expect(options.redirect).toBe("manual");
    expect(options.headers.cookie).toBe("c_user=secret-cookie"); expect(options.body.get("__user")).toBe("615"); expect(options.body.get("av")).toBe("615");
    expect(f.seed.cookies).toEqual([]); expect(f.seed.params).toEqual({});
    expect(JSON.stringify(f.transport)).not.toMatch(/secret-/); expect(JSON.stringify(result)).not.toMatch(/secret-/);
  });
  it("never follows a session redirect or retries the original HTTP operation", async () => {
    const f = fixture(new Response(null, { status: 302, headers: { location: "https://www.facebook.com/checkpoint/" } }));
    await expect(f.transport.execute(graphqlRequest(contract, {}))).rejects.toBeInstanceOf(FacebookSessionRecoveryRequired);
    expect(f.fetcher).toHaveBeenCalledTimes(1); cleared(f);
  });
  it.each([401, 403])("requires browser recovery for HTTP %i without resubmission", async status => {
    const f = fixture(new Response(null, { status })); await expect(f.transport.execute(graphqlRequest(contract, {}))).rejects.toBeInstanceOf(FacebookSessionRecoveryRequired);
    expect(f.fetcher).toHaveBeenCalledTimes(1); cleared(f);
  });
  it("rejects non-GraphQL egress and destroys expired credentials", async () => {
    const f = fixture(); await expect(f.transport.execute({ ...graphqlRequest(contract, {}), url: "https://other.invalid/" as any })).rejects.toThrow("escaped");
    expect(f.fetcher).not.toHaveBeenCalled(); f.transport.destroy(); await expect(f.transport.verifyActor()).rejects.toThrow("expired");
  });
  it("requires actual fresh actor readback rather than renewing timestamps locally", async () => {
    const f = fixture(); f.setNow(at + 61_000); await expect(f.transport.verifyActor()).rejects.toThrow("identity_unverified"); cleared(f);
    expect(() => f.transport.setActorReadback(async () => ({ ...actor, verifiedAt: new Date(at + 61_000).toISOString() }))).toThrow("expired");
    const current = fixture(identityResponse()); verifiedReader(current); current.setNow(at + 61_000);
    expect((await current.transport.verifyActor()).verifiedAt).toBe(new Date(at + 61_000).toISOString());
    current.transport.setActorReadback(async query => { await query(graphqlRequest(identityContract, {})); return { ...actor, actorId: "other" }; });
    await expect(current.transport.verifyActor()).rejects.toThrow("identity_unverified"); cleared(current);
  });
  it("extends only the bounded idle lease after a real same-actor/session HTTP identity read", async () => {
    const f = fixture(identityResponse()); verifiedReader(f); f.setNow(at + 90_000);
    await expect(f.transport.verifyActor()).resolves.toMatchObject({ actorId: "615", sessionId: "original" });
    expect((f.transport as any).expiresAt).toBe(at + 210_000);
    f.setNow(at + 180_000); await f.transport.verifyActor(); expect((f.transport as any).expiresAt).toBe(at + 300_000);
    expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.transport.toJSON().destroyed).toBe(false);
  });
  it("does not extend expiry from cached identity or ordinary API success", async () => {
    const f = fixture(undefined, 30_000); f.setNow(at + 20_000);
    await f.transport.verifyActor(); await f.transport.execute(graphqlRequest(contract, {}));
    expect((f.transport as any).expiresAt).toBe(at + 30_000); expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.setNow(at + 30_000); await expect(f.transport.verifyActor()).rejects.toThrow("expired"); cleared(f); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not treat a locally renewed actor timestamp or unrelated query as a verified identity read", async () => {
    const f = fixture(identityResponse()); f.transport.setActorReadback(async () => ({ ...actor, verifiedAt: new Date(f.now()).toISOString() })); f.setNow(at + 90_000);
    await expect(f.transport.verifyActor()).rejects.toThrow("identity_unverified"); cleared(f); expect(f.fetcher).not.toHaveBeenCalled();
    const unrelated = fixture(identityResponse()); unrelated.transport.setActorReadback(async query => {
      await query(graphqlRequest(contract, {})); return { ...actor, verifiedAt: new Date(unrelated.now()).toISOString() };
    }); await expect(unrelated.transport.verifyActor()).rejects.toThrow("identity_unverified"); cleared(unrelated); expect(unrelated.fetcher).not.toHaveBeenCalled();
  });
  it.each(["actor", "session", "HTTP-actor", "GraphQL-error", "challenge", "failed-read"])("never renews and clears credentials after %s verification failure", async kind => {
    const f = fixture(identityResponse()); f.setNow(at + 90_000);
    if (kind === "HTTP-actor") f.fetcher.mockResolvedValue(new Response('{"data":{"viewer":{"actor":{"id":"999"}}}}'));
    if (kind === "GraphQL-error") f.fetcher.mockResolvedValue(new Response('{"errors":[{"message":"identity unavailable"}]}'));
    if (kind === "challenge") f.fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    if (kind === "failed-read") f.fetcher.mockRejectedValue(new Error("original identity read failed"));
    f.transport.setActorReadback(async query => { await query(graphqlRequest(identityContract, {})); return { ...actor,
      ...(kind === "actor" ? { actorId: "999" } : {}), ...(kind === "session" ? { sessionId: "other-session" } : {}), verifiedAt: new Date(f.now()).toISOString() }; });
    await expect(f.transport.verifyActor()).rejects.toThrow(); expect((f.transport as any).expiresAt).toBe(at + 120_000); cleared(f);
    await expect(f.transport.verifyActor()).rejects.toThrow("expired"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["during-HTTP", "after-HTTP"])("cannot resurrect an old lease that expires %s identity readback", async kind => {
    const f = fixture(identityResponse()); f.setNow(at + 119_000);
    if (kind === "during-HTTP") f.fetcher.mockImplementation(async () => { f.setNow(at + 121_000); return identityResponse(); });
    f.transport.setActorReadback(async query => { await query(graphqlRequest(identityContract, {}));
      if (kind === "after-HTTP") f.setNow(at + 121_000); return { ...actor, verifiedAt: new Date(f.now()).toISOString() }; });
    await expect(f.transport.verifyActor()).rejects.toThrow("expired"); expect((f.transport as any).expiresAt).toBe(at + 120_000); cleared(f);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires fresh identity before expiry and cannot revive a dead lease by installing a reader", async () => {
    const f = fixture(identityResponse()); verifiedReader(f); f.setNow(at + 120_000);
    await expect(f.transport.verifyActor()).rejects.toThrow("expired"); cleared(f); expect(f.fetcher).not.toHaveBeenCalled();
    expect(() => verifiedReader(f)).toThrow("expired");
  });
  it("does not renew from an old HTTP identity read relabeled with a fresh local timestamp", async () => {
    const f = fixture(identityResponse()); f.setNow(at + 10_000);
    f.transport.setActorReadback(async query => { await query(graphqlRequest(identityContract, {})); f.setNow(at + 80_001);
      return { ...actor, verifiedAt: new Date(f.now()).toISOString() }; });
    await expect(f.transport.verifyActor()).rejects.toThrow("identity_unverified"); cleared(f);
    expect((f.transport as any).expiresAt).toBe(at + 120_000); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps the configured idle TTL capped at thirty minutes", async () => {
    expect(() => fixture(identityResponse(), 30 * 60_000 + 1)).toThrow("Exact Facebook session bootstrap");
    const f = fixture(identityResponse(), 30 * 60_000); verifiedReader(f); f.setNow(at + 29 * 60_000); await f.transport.verifyActor();
    expect((f.transport as any).expiresAt - f.now()).toBe(30 * 60_000);
    f.setNow(at + 59 * 60_000); await expect(f.transport.verifyActor()).rejects.toThrow("expired"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns one already-started HTTP response after expiry without renewing or retrying it", async () => {
    const f = fixture(undefined, 30_000); f.setNow(at + 20_000);
    f.fetcher.mockImplementation(async () => { f.setNow(at + 31_000); return new Response('{"data":{"original":"returned"}}', { headers: { "set-cookie": "new_cookie=never-retain; Path=/" } }); });
    expect(await f.transport.execute(graphqlRequest(contract, {}))).toEqual({ status: 200, body: '{"data":{"original":"returned"}}' });
    expect(f.fetcher).toHaveBeenCalledTimes(1); cleared(f); expect((f.transport as any).expiresAt).toBe(at + 30_000);
  });
  it("refreshes exact Page identity by HTTP without a browser or evaluating returned scripts", async () => {
    let now = at; const calls: string[] = [];
    const fetcher = vi.fn(async (url: any) => { calls.push(String(url)); return String(url).endsWith('/me/')
      ? new Response(null, {status:302,headers:{location:actor.actorUrl}})
      : new Response('<script>throw Error("never execute");</script>["CurrentUserInitialData",[],{"USER_ID":"615","ACCOUNT_ID":"202"},1]'); });
    const session = new FacebookHttpSessionTransport({actor,params:{__user:'615',fb_dtsg:'x',lsd:'y'},cookies:[{name:'c_user',value:'private',domain:'.facebook.com',path:'/'}],userAgent:'Chrome',referer:actor.actorUrl}, {now:()=>now,fetch:fetcher as typeof fetch});
    now += 61_000; expect((await session.verifyActor()).verifiedAt).toBe(new Date(now).toISOString());
    expect(calls).toEqual(['https://www.facebook.com/me/',actor.actorUrl]);
  });
  it("never loads another origin's cookies or persists a bootstrap", async () => {
    const page = { url: () => actor.actorUrl, evaluate: vi.fn(async () => ({ params: { __user: "615", fb_dtsg: "x", lsd: "y" }, userAgent: "Chrome", referer: actor.actorUrl })),
      facebookCookies: vi.fn(async () => [{ name: "private", value: "other", domain: ".other.invalid", path: "/" }]) };
    await expect(bootstrapFacebookHttpSession({ page: page as any, nativeActor: actor })).rejects.toThrow("escaped");
  });
  it("refuses nonnumeric or missing authenticated session parameters", () => {
    expect(() => new FacebookHttpSessionTransport({ actor, params: { __user: "other", fb_dtsg: "x", lsd: "y" }, userAgent: "Chrome", referer: actor.actorUrl, cookies: [] })).toThrow("unavailable");
  });
});
