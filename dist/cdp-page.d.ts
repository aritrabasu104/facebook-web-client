import type { FacebookOriginPage } from "./browser-session.js";
import { CapturedFacebookRequestSession, type FacebookSessionCookie } from "./http-session.js";
/** An already authorized, caller-created session attached to one exact target.
 * Implemented structurally by Playwright's CDPSession; no Playwright dependency. */
export interface FacebookCdpTargetSession {
    send(method: any, params?: any): Promise<any>;
    on(event: "Network.requestWillBeSent" | "Network.requestWillBeSentExtraInfo", listener: (params: any) => void): unknown;
    off(event: "Network.requestWillBeSent" | "Network.requestWillBeSentExtraInfo", listener: (params: any) => void): unknown;
    detach(): Promise<void>;
}
/** Application-side connection to the one target selected by REA. No browser
 * launch, automatic target attachment, navigation, input, or Browser.close. */
export declare class FacebookCdpPage implements FacebookOriginPage {
    private readonly socket;
    private readonly targetId;
    private serial;
    private sessionId?;
    private readonly observers;
    private readonly pending;
    private targetSession?;
    private readonly targetListeners;
    private constructor();
    /** Reuse the caller's existing approved connection instead of opening a second
     * debugger socket. The package owns this target session until close/detach. */
    static fromTargetSession(session: FacebookCdpTargetSession, target: {
        target_id: string;
        origin: string;
        url: string;
    }): Promise<FacebookCdpPage>;
    static connect(endpoint: string, target: {
        target_id: string;
        origin: string;
        url: string;
    }): Promise<FacebookCdpPage>;
    private command;
    url(): Promise<string>;
    evaluate<T, A>(fn: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
    close(): Promise<void>;
    facebookCookies(): Promise<FacebookSessionCookie[]>;
    captureQuerySessionBootstrap<T>(operationName: string, probe: () => Promise<T>): Promise<{
        result: T;
        bootstrap: CapturedFacebookRequestSession;
    }>;
}
