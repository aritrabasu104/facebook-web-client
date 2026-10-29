import { FacebookOperationCoordinator } from "./concurrency.js";
import { inspect } from "node:util";
import { FACEBOOK_GRAPHQL_URL, FACEBOOK_ORIGIN, assertContract } from "./contracts.js";
import type { FacebookOriginPage } from "./browser-session.js";
import { parseFacebookGraphqlResponse, type FacebookGraphqlRequest, type FacebookGraphqlResponse, type FacebookSessionTransport } from "./protocol.js";

type Actor = Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
export interface FacebookSessionCookie { name: string; value: string; domain: string; path: string; secure?: boolean; expires?: number }
export class FacebookSessionRecoveryRequired extends Error {
  constructor(readonly reason: "expired" | "challenge" | "identity_unverified" | "unavailable") {
    super("Facebook session recovery required: " + reason); this.name = "FacebookSessionRecoveryRequired";
  }
}
interface Seed { actor: Actor; params: Record<string, string>; cookies: FacebookSessionCookie[]; userAgent: string; referer: string; headers?: Record<string, string> }
/** A single same-origin read's actual browser request context. It is consumed
 * once in memory and is deliberately nonserializable as credential evidence. */
export class CapturedFacebookRequestSession {
  #headers: Record<string, string>; #form: string;
  constructor(headers: Record<string, string>, form: string) { this.#headers = { ...headers }; this.#form = form; }
  consume(actor: Actor): FacebookHttpSessionTransport {
    if (!this.#form) throw new Error("Original Facebook request bootstrap was already consumed");
    const headers = Object.fromEntries(Object.entries(this.#headers).map(([k, v]) => [k.toLowerCase(), v])), form = new URLSearchParams(this.#form);
    this.#form = ""; this.#headers = {};
    const params = Object.fromEntries([...form].filter(([k]) => !["variables", "doc_id", "fb_api_req_friendly_name", "fb_api_caller_class", "server_timestamps", "av"].includes(k)));
    const cookies = (headers.cookie ?? "").split(/;\s*/u).filter(Boolean).map(pair => { const at = pair.indexOf("=");
      if (at < 1) throw new Error("Original Facebook Cookie header is malformed");
      return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "www.facebook.com", path: "/", secure: true }; });
    const extra = Object.fromEntries(Object.entries(headers).filter(([k]) => ["accept", "accept-language", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "x-asbd-id"].includes(k)));
    return new FacebookHttpSessionTransport({ actor, params, cookies, userAgent: headers["user-agent"] ?? "", referer: headers.referer ?? "", headers: extra });
  }
  destroy() { this.#form = ""; this.#headers = {}; }
  toJSON() { return { bootstrap: "captured_facebook_read", credentials: "redacted" }; }
  [inspect.custom]() { return this.toJSON(); }
}
export type FacebookApiActorReadback = (query: (request: FacebookGraphqlRequest) => Promise<FacebookGraphqlResponse>) => Promise<Actor>;

/** Memory-only session handoff. Browser use ends at bootstrap; routine GraphQL
 * traffic goes directly to the same Facebook origin. No cookie/token file,
 * credential logging, credential refresh, redirects or mutation retry exists.
 * Its bounded idle lease renews only after actual exact-actor HTTP readback. */
export class FacebookHttpSessionTransport implements FacebookSessionTransport {
  readonly coordination = new FacebookOperationCoordinator();
  private actorVerification?: Promise<Actor>;
  private readonly params = new Map<string, string>();
  private readonly cookies = new Map<string, FacebookSessionCookie>();
  private expiresAt: number;
  private readonly idleTtlMs: number;
  private readonly identity: Pick<Actor, "actorId" | "actorUrl" | "sessionId">;
  private actor: Actor;
  private actorReadback?: FacebookApiActorReadback;
  private destroyed = false;
  private readonly requestContext: { userAgent: string; referer: string; headers: Record<string, string> };
  constructor(seed: Seed, private readonly options: { fetch?: typeof fetch; now?: () => number; ttlMs?: number } = {}) {
    const ttl = options.ttlMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 30 * 60_000 || !/^\d+$/u.test(seed.actor.actorId) || !seed.actor.sessionId ||
        seed.actor.actorUrl !== `https://www.facebook.com/profile.php?id=${seed.actor.actorId}` || new URL(seed.referer).origin !== FACEBOOK_ORIGIN ||
        !seed.userAgent || /[\r\n]/u.test(seed.userAgent)) throw new Error("Exact Facebook session bootstrap is required");
    this.actor = { ...seed.actor }; this.idleTtlMs = ttl; this.expiresAt = this.now() + ttl;
    this.identity = Object.freeze({ actorId: seed.actor.actorId, actorUrl: seed.actor.actorUrl, sessionId: seed.actor.sessionId });
    const headers = { ...seed.headers };
    if (Object.entries(headers).some(([key, value]) => !["accept", "accept-language", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "x-asbd-id"].includes(key) || typeof value !== "string" || /[\r\n]/u.test(value))) throw new Error("Unsupported observed Facebook request header");
    this.requestContext = { userAgent: seed.userAgent, referer: seed.referer, headers };
    for (const [key, value] of Object.entries(seed.params)) {
      if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/u.test(key) || /[\r\n]/u.test(value)) throw new Error("Invalid first-party Facebook session parameter");
      this.params.set(key, value);
    }
    if (!this.params.get("fb_dtsg") || !this.params.get("lsd") || !/^\d+$/u.test(this.params.get("__user") ?? "")) throw new Error("First-party Facebook session is unavailable");
    for (const cookie of seed.cookies) this.retainCookie(cookie);
    if (!this.cookies.size) throw new Error("Facebook session cookies are unavailable");
    // Do not retain the caller's second copy of secret material.
    seed.cookies.length = 0; for (const key of Object.keys(seed.params)) delete seed.params[key];
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private assertLive() {
    if (this.destroyed || this.now() >= this.expiresAt) { this.destroy(); throw new FacebookSessionRecoveryRequired("expired"); }
  }
  private fail(reason: FacebookSessionRecoveryRequired["reason"]): never { this.destroy(); throw new FacebookSessionRecoveryRequired(reason); }
  private retainVerifiedIdentity(observed: Actor): Actor {
    // Readback may itself outlive the old idle lease. It cannot resurrect it.
    this.assertLive();
    const now = this.now(), age = now - Date.parse(observed.verifiedAt);
    if (now >= this.expiresAt) return this.fail("expired");
    if (observed.actorUrl !== this.identity.actorUrl || observed.actorId !== this.identity.actorId || observed.sessionId !== this.identity.sessionId ||
        !Number.isFinite(age) || age < 0 || age > 60_000) return this.fail("identity_unverified");
    this.actor = { ...observed }; this.expiresAt = now + this.idleTtlMs; return { ...this.actor };
  }
  private retainCookie(cookie: FacebookSessionCookie): void {
    if (!["facebook.com", ".facebook.com", "www.facebook.com", ".www.facebook.com"].includes(cookie.domain) ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(cookie.name) || /[;\r\n]/u.test(cookie.value) ||
        !cookie.path.startsWith("/") || cookie.path.length > 1024) throw new Error("Session cookie escaped the exact Facebook scope");
    const key = cookie.domain + cookie.path + ":" + cookie.name;
    if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires * 1000 <= this.now()) this.cookies.delete(key);
    else this.cookies.set(key, { ...cookie });
    if (this.cookies.size > 128 || [...this.cookies.values()].reduce((n, c) => n + c.name.length + c.value.length, 0) > 65_536) throw new Error("Facebook cookie budget exceeded");
  }
  setActorReadback(readback: FacebookApiActorReadback): void { this.assertLive(); this.actorReadback = readback; }
  async verifyActor(): Promise<Actor> {
    this.assertLive();
    if (this.actorVerification) return { ...await this.actorVerification };
    const pending = this.verifyActorOnce(); this.actorVerification = pending;
    try { return { ...await pending }; }
    finally { if (this.actorVerification === pending) this.actorVerification = undefined; }
  }
  private async verifyActorOnce(): Promise<Actor> {
    this.assertLive();
    try {
      const readback = this.actorReadback;
      if (readback) {
        let actualIdentityReadAt: number | undefined;
        const observed = await readback(async request => {
          if (request.operation.kind !== "query" || request.operation.operation !== "identity.read") return this.fail("identity_unverified");
          assertContract(request.operation);
          const response = await this.send(request); this.assertLive();
          const parsed = parseFacebookGraphqlResponse(response);
          const actors = parsed.state === "data" ? parsed.data.map(frame => (frame as any).viewer?.actor).filter(Boolean) : [];
          if (!actors.length || actors.some(actor => actor.id !== this.identity.actorId)) return this.fail("identity_unverified");
          actualIdentityReadAt = this.now(); return response;
        });
        if (actualIdentityReadAt === undefined || this.now() - actualIdentityReadAt < 0 || this.now() - actualIdentityReadAt > 60_000) return this.fail("identity_unverified");
        return this.retainVerifiedIdentity(observed);
      }
      const age = this.now() - Date.parse(this.actor.verifiedAt);
      if (Number.isFinite(age) && age > 60_000) return await this.verifyHttpActor();
      if (!Number.isFinite(age) || age < 0 || age > 60_000 || this.actor.actorId !== this.identity.actorId ||
          this.actor.actorUrl !== this.identity.actorUrl || this.actor.sessionId !== this.identity.sessionId) return this.fail("identity_unverified");
      // Returning a still-fresh bootstrap/cached proof is not an HTTP read and
      // cannot renew the lease.
      return { ...this.actor };
    } catch (error) { this.destroy(); throw error; }
  }
  /** First-party /me/ HTTP read, without browser navigation or JavaScript
   * execution. The returned current-user module and canonical route must both
   * identify this exact Page; a public Page URL by itself is insufficient. */
  async verifyHttpActor(): Promise<Actor> {
    this.assertLive();
    try { return await this.readHttpActor(); } catch (error) { this.destroy(); throw error; }
  }
  private async readHttpActor(): Promise<Actor> {
    let url = FACEBOOK_ORIGIN + "/me/";
    for (let redirects = 0; redirects <= 3; redirects++) {
      this.assertLive();
      const cookie = [...this.cookies.values()].filter(c => new URL(url).pathname.startsWith(c.path) &&
        (!c.expires || c.expires < 0 || c.expires * 1000 > this.now())).map(c => c.name + "=" + c.value).join("; ");
      const response = await (this.options.fetch ?? fetch)(url, { redirect: "manual", signal: AbortSignal.timeout(30_000),
        headers: { cookie, "user-agent": this.requestContext.userAgent, accept: "text/html", referer: this.requestContext.referer } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location"); if (!location) throw new FacebookSessionRecoveryRequired("challenge");
        const next = new URL(location, url);
        if (next.origin !== FACEBOOK_ORIGIN || !["/me/", "/me", "/profile.php", "/" + this.identity.actorId, "/" + this.identity.actorId + "/"].includes(next.pathname)) throw new FacebookSessionRecoveryRequired("challenge");
        url = next.href; await response.body?.cancel(); continue;
      }
      if (response.status !== 200) throw new FacebookSessionRecoveryRequired("challenge");
      const reader = response.body?.getReader(); if (!reader) throw new FacebookSessionRecoveryRequired("unavailable");
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.length;
        if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Facebook HTTP identity exceeds its byte bound"); } chunks.push(item.value); }
      const bytes = new Uint8Array(length); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
      const html = new TextDecoder().decode(bytes), pattern = /"CurrentUserInitialData"\s*,\s*\[\s*\]\s*,\s*/gu;
      const users = new Set<string>();
      while (pattern.exec(html)) {
        const start = pattern.lastIndex; if (html[start] !== "{") continue;
        let depth = 0, quoted = false, escaped = false;
        for (let end = start; end < Math.min(html.length, start + 65_536); end++) {
          const c = html[end];
          if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
          else if (c === '"') quoted = true;
          else if (c === "{") depth++;
          else if (c === "}" && --depth === 0) { try { const value = JSON.parse(html.slice(start, end + 1)); if (/^\d+$/u.test(String(value.USER_ID))) users.add(String(value.USER_ID)); } catch { /* No inferred identity from malformed input. */ } break; }
        }
      }
      const route = new URL(url), routeMatches = route.pathname === "/profile.php" ? route.searchParams.get("id") === this.identity.actorId :
        ["/" + this.identity.actorId, "/" + this.identity.actorId + "/"].includes(route.pathname);
      if (!routeMatches || users.size !== 1 || !users.has(this.identity.actorId)) throw new FacebookSessionRecoveryRequired("identity_unverified");
      return this.retainVerifiedIdentity({ ...this.identity, verifiedAt: new Date(this.now()).toISOString() });
    }
    throw new FacebookSessionRecoveryRequired("challenge");
  }
  async execute(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse> { const original = structuredClone(request); await this.verifyActor(); return this.send(original); }
  private async send(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse> {
    this.assertLive();
    if (request.url !== FACEBOOK_GRAPHQL_URL || request.method !== "POST" || JSON.stringify(request.variables).length > 1_048_576) throw new Error("Facebook HTTP request escaped its supported scope");
    const form = new URLSearchParams(Object.fromEntries(this.params)); form.set("av", this.identity.actorId);
    form.set("fb_api_caller_class", "RelayModern"); form.set("fb_api_req_friendly_name", request.operation.name);
    form.set("doc_id", request.operation.documentId); form.set("variables", JSON.stringify(request.variables)); form.set("server_timestamps", "true");
    const cookie = [...this.cookies.values()].filter(c => "/api/graphql/".startsWith(c.path) && (!c.expires || c.expires < 0 || c.expires * 1000 > this.now()))
      .sort((a, b) => b.path.length - a.path.length).map(c => c.name + "=" + c.value).join("; ");
    if (!cookie) return this.fail("expired");
    const response = await (this.options.fetch ?? fetch)(FACEBOOK_GRAPHQL_URL, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: FACEBOOK_ORIGIN, referer: this.requestContext.referer,
        ...this.requestContext.headers, "user-agent": this.requestContext.userAgent, "x-fb-lsd": this.params.get("lsd")!, "x-fb-friendly-name": request.operation.name }, body: form });
    if (response.status >= 300 && response.status < 400 || [401, 403].includes(response.status)) return this.fail("challenge");
    const reader = response.body?.getReader(); if (!reader) return this.fail("unavailable");
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Facebook HTTP response exceeds its byte bound"); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = new TextDecoder().decode(bytes);
    if (/^\s*(?:<!doctype|<html)/iu.test(body)) return this.fail("challenge");
    // A different in-flight verification may have destroyed the session, or
    // this response may arrive after idle expiry. Keep the original returned
    // bytes available to its owner, but never repopulate dead credential maps.
    if (this.destroyed || this.now() >= this.expiresAt) { this.destroy(); return { status: response.status, body }; }
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";"), at = pair!.indexOf("="); if (at <= 0) continue;
      const updated: FacebookSessionCookie = { name: pair!.slice(0, at).trim(), value: pair!.slice(at + 1).trim(), domain: "www.facebook.com", path: "/" };
      for (const attribute of attributes) { const [name, ...values] = attribute.trim().split("="), value = values.join("=");
        if (name?.toLowerCase() === "domain") updated.domain = value.toLowerCase();
        if (name?.toLowerCase() === "path") updated.path = value;
        if (name?.toLowerCase() === "expires") updated.expires = Date.parse(value) / 1000;
        if (name?.toLowerCase() === "max-age" && /^-?\d+$/u.test(value)) updated.expires = (this.now() + Number(value) * 1000) / 1000;
      }
      this.retainCookie(updated);
    }
    return { status: response.status, body };
  }
  destroy(): void { this.destroyed = true; this.params.clear(); this.cookies.clear(); this.actorReadback = undefined; }
  toJSON() { return { transport: "facebook_direct_http", sessionMaterial: "redacted", destroyed: this.destroyed }; }
  [inspect.custom]() { return this.toJSON(); }
}

/** Explicitly authorized same-account local handoff; secrets stay in process
 * memory and are sent only back to Facebook. Callers must not serialize seed. */
export async function bootstrapFacebookHttpSession(input: {
  page: FacebookOriginPage & { facebookCookies(): Promise<FacebookSessionCookie[]> };
  nativeActor: Actor; ttlMs?: number; fetch?: typeof fetch;
}): Promise<FacebookHttpSessionTransport> {
  const facts = await input.page.evaluate(expected => {
    const load = (window as unknown as { require?: (name: string) => any }).require;
    if (location.origin !== "https://www.facebook.com" || !load) throw new Error("Facebook bootstrap origin unavailable");
    const initial = load("CurrentUserInitialData"), params = load("getAsyncParams")("POST");
    if (String(initial.USER_ID) !== expected || ![String(initial.ACCOUNT_ID), String(initial.USER_ID)].includes(String(params.__user))) throw new Error("Facebook bootstrap actor changed");
    const values: Record<string, string> = {}; for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) { if (!["string", "number", "boolean"].includes(typeof value)) throw new Error("Unexpected first-party parameter"); values[key] = String(value); }
    }
    return { params: values, userAgent: navigator.userAgent, referer: location.href };
  }, input.nativeActor.actorId);
  return new FacebookHttpSessionTransport({ ...facts, actor: input.nativeActor, cookies: await input.page.facebookCookies() }, { ttlMs: input.ttlMs, fetch: input.fetch });
}
