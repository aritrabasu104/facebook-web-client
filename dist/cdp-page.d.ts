import type { FacebookOriginPage } from "./browser-session.js";
import { CapturedFacebookRequestSession, type FacebookSessionCookie } from "./http-session.js";
/** Application-side connection to the one target selected by REA. No browser
 * launch, automatic target attachment, navigation, input, or Browser.close. */
export declare class FacebookCdpPage implements FacebookOriginPage {
    private readonly socket;
    private readonly targetId;
    private serial;
    private sessionId?;
    private readonly observers;
    private readonly pending;
    private constructor();
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
