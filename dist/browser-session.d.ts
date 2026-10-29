import type { FacebookGraphqlRequest, FacebookSessionTransport } from "./protocol.js";
export interface FacebookOriginPage {
    /** An explicitly authorized application/CDP executor, not CUA's read-only evaluator. */
    evaluate<T, A>(fn: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
    url(): string | Promise<string | undefined>;
}
type ActorProof = Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
/** Same-origin API transport; cookies and CSRF values never leave the browser.
 * The existing native owner supplies the exact Page and session proof. This
 * adapter neither starts a browser nor connects/restarts/switches a profile. */
export declare class FacebookBrowserSessionTransport implements FacebookSessionTransport {
    private readonly page;
    private readonly sessionId;
    private readonly nativeActor;
    constructor(page: FacebookOriginPage, sessionId: string, nativeActor: () => Promise<ActorProof>);
    verifyActor(): Promise<ActorProof>;
    execute(request: FacebookGraphqlRequest): Promise<{
        status: number;
        body: string;
    }>;
}
export {};
