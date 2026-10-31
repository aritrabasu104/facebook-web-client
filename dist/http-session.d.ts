import { FacebookOperationCoordinator } from "./concurrency.js";
import { inspect } from "node:util";
import type { FacebookOriginPage } from "./browser-session.js";
import { type FacebookGraphqlRequest, type FacebookGraphqlResponse, type FacebookSessionTransport } from "./protocol.js";
type Actor = Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
export interface FacebookSessionCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    expires?: number;
}
export declare class FacebookSessionRecoveryRequired extends Error {
    readonly reason: "expired" | "challenge" | "identity_unverified" | "unavailable";
    constructor(reason: "expired" | "challenge" | "identity_unverified" | "unavailable");
}
interface Seed {
    actor: Actor;
    params: Record<string, string>;
    cookies: FacebookSessionCookie[];
    userAgent: string;
    referer: string;
    headers?: Record<string, string>;
}
/** Private IPC to the application's existing native credential owner. Never an
 * evidence/file store; implementations must suppress authentication UI. */
export interface FacebookNativeCredentialStore {
    read(): Promise<Uint8Array | undefined>;
    write(bytes: Uint8Array): Promise<void>;
}
export interface FacebookNativeAuthenticationContext {
    channelClientId: string;
    scale: number;
}
/** Restore only private same-account material. A new transport is unusable as
 * authenticated proof until the host installs and performs its identity read. */
export declare function restoreFacebookNativeHttpSession(input: {
    store: FacebookNativeCredentialStore;
    actorId: string;
    actorUrl: string;
    sessionId: string;
    fetch?: typeof fetch;
    now?: () => number;
}): Promise<{
    session: FacebookHttpSessionTransport;
    context: FacebookNativeAuthenticationContext;
} | undefined>;
/** A single same-origin read's actual browser request context. It is consumed
 * once in memory and is deliberately nonserializable as credential evidence. */
export declare class CapturedFacebookRequestSession {
    #private;
    constructor(headers: Record<string, string>, form: string);
    consume(actor: Actor): FacebookHttpSessionTransport;
    destroy(): void;
    toJSON(): {
        bootstrap: string;
        credentials: string;
    };
    [inspect.custom](): {
        bootstrap: string;
        credentials: string;
    };
}
export type FacebookApiActorReadback = (query: (request: FacebookGraphqlRequest) => Promise<FacebookGraphqlResponse>) => Promise<Actor>;
/** Memory-only session handoff. Browser use ends at bootstrap; routine GraphQL
 * traffic goes directly to the same Facebook origin. No cookie/token file,
 * credential logging, credential refresh, redirects or mutation retry exists.
 * Its bounded idle lease renews only after actual exact-actor HTTP readback. */
export declare class FacebookHttpSessionTransport implements FacebookSessionTransport {
    private readonly options;
    readonly coordination: FacebookOperationCoordinator;
    private actorVerification?;
    private identityHttpReadAt?;
    private readonly params;
    private readonly cookies;
    private expiresAt;
    private readonly idleTtlMs;
    private readonly identity;
    private actor;
    private actorReadback?;
    private destroyed;
    private readonly requestContext;
    constructor(seed: Seed, options?: {
        fetch?: typeof fetch;
        now?: () => number;
        ttlMs?: number;
    });
    private now;
    private assertLive;
    private fail;
    private retainVerifiedIdentity;
    private retainCookie;
    setActorReadback(readback: FacebookApiActorReadback): void;
    verifyActor(): Promise<Actor>;
    private verifyActorOnce;
    /** First-party /me/ HTTP read, without browser navigation or JavaScript
     * execution. The returned current-user module and canonical route must both
     * identify this exact Page; a public Page URL by itself is insufficient. */
    verifyHttpActor(): Promise<Actor>;
    private readHttpActor;
    execute(request: FacebookGraphqlRequest): Promise<FacebookGraphqlResponse>;
    /** Store only through the original private native owner after a real fresh
     * HTTP identity read. JSON/inspection remain redacted; no export is returned. */
    retainNativeCredentials(store: FacebookNativeCredentialStore, context: FacebookNativeAuthenticationContext): Promise<boolean>;
    private send;
    destroy(): void;
    toJSON(): {
        transport: string;
        sessionMaterial: string;
        destroyed: boolean;
    };
    [inspect.custom](): {
        transport: string;
        sessionMaterial: string;
        destroyed: boolean;
    };
}
/** Explicitly authorized same-account local handoff; secrets stay in process
 * memory and are sent only back to Facebook. Callers must not serialize seed. */
export declare function bootstrapFacebookHttpSession(input: {
    page: FacebookOriginPage & {
        facebookCookies(): Promise<FacebookSessionCookie[]>;
    };
    nativeActor: Actor;
    ttlMs?: number;
    fetch?: typeof fetch;
}): Promise<FacebookHttpSessionTransport>;
export {};
