import { type FacebookOriginPage } from "./browser-session.js";
import { type FacebookContract } from "./contracts.js";
import { type FacebookSessionTransport } from "./protocol.js";
import { type FacebookNativeCredentialStore, type CapturedFacebookRequestSession, type FacebookHttpSessionTransport } from "./http-session.js";
type Actor = Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
export interface FacebookApiSessionBootstrapPage extends FacebookOriginPage {
    captureQuerySessionBootstrap<T>(name: string, probe: () => Promise<T>): Promise<{
        result: T;
        bootstrap: CapturedFacebookRequestSession;
    }>;
}
export interface FacebookApiIdentityTemplate {
    contract: FacebookContract;
    variables: Record<string, unknown>;
}
/** Cold startup/renewal through private native custody and one actual identity
 * read. Missing, invalid or refused credentials never invoke a browser. */
export declare function restoreFacebookApiFirstSession(input: {
    store: FacebookNativeCredentialStore;
    originalSessionId: string;
    configuredActor: {
        actorId: string;
        actorUrl: string;
        displayName: string;
    };
    identity: FacebookApiIdentityTemplate;
    fetch?: typeof fetch;
}): Promise<{
    session: FacebookHttpSessionTransport;
    context: import("./http-session.js").FacebookNativeAuthenticationContext;
} | undefined>;
/** One explicit login/session-recovery boundary. Routine actor checks use the
 * authenticated identity query over HTTP; this function never sends mutations,
 * launches Chrome, acquires a tab, retries writes, or stores session material. */
export declare function bootstrapFacebookApiFirstSession(input: {
    page: FacebookApiSessionBootstrapPage;
    originalSessionId: string;
    configuredActor: {
        actorId: string;
        actorUrl: string;
        displayName: string;
    };
    nativeActorProof(): Promise<Actor>;
    identity: FacebookApiIdentityTemplate;
    probe: FacebookApiIdentityTemplate;
}): Promise<FacebookHttpSessionTransport>;
export {};
