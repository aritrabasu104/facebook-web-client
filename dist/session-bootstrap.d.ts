import { type FacebookOriginPage } from "./browser-session.js";
import { type FacebookContract } from "./contracts.js";
import { type FacebookSessionTransport } from "./protocol.js";
import { type CapturedFacebookRequestSession, type FacebookHttpSessionTransport } from "./http-session.js";
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
