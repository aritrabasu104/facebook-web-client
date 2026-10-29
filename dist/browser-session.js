import { FACEBOOK_GRAPHQL_URL, FACEBOOK_ORIGIN } from "./contracts.js";
/** Same-origin API transport; cookies and CSRF values never leave the browser.
 * The existing native owner supplies the exact Page and session proof. This
 * adapter neither starts a browser nor connects/restarts/switches a profile. */
export class FacebookBrowserSessionTransport {
    page;
    sessionId;
    nativeActor;
    constructor(page, sessionId, nativeActor) {
        this.page = page;
        this.sessionId = sessionId;
        this.nativeActor = nativeActor;
    }
    async verifyActor() {
        const actor = await this.nativeActor(), url = await this.page.url();
        if (!url || new URL(url).origin !== FACEBOOK_ORIGIN || actor.sessionId !== this.sessionId)
            throw new Error("Facebook origin or native session changed");
        const ready = await this.page.evaluate(expected => {
            const load = window.require;
            if (location.origin !== "https://www.facebook.com" || !load)
                return false;
            try {
                const initial = load("CurrentUserInitialData"), params = load("getAsyncParams")("POST");
                return String(initial.USER_ID) === expected && /^\d+$/u.test(String(params.__user)) &&
                    [String(initial.ACCOUNT_ID), String(initial.USER_ID)].includes(String(params.__user)) && Boolean(params.fb_dtsg) && Boolean(params.lsd);
            }
            catch {
                return false;
            }
        }, actor.actorId);
        if (!ready)
            throw new Error("Facebook API session readiness or exact actor is unverified");
        return actor;
    }
    async execute(request) {
        if (request.url !== FACEBOOK_GRAPHQL_URL || request.method !== "POST")
            throw new Error("Facebook API destination escaped its native origin");
        const actor = await this.verifyActor();
        return this.page.evaluate(async ({ operation, variables, actorId }) => {
            if (location.origin !== "https://www.facebook.com")
                throw new Error("Facebook API origin changed before dispatch");
            const load = window.require;
            if (!load || String(load("CurrentUserInitialData").USER_ID) !== actorId)
                throw new Error("Facebook API actor changed before dispatch");
            // Facebook's first-party builder owns the authenticated principal and
            // current CSRF/context parameters. __user is not assumed to be the Page.
            // These values are constructed and consumed entirely inside this tab.
            const initial = load("CurrentUserInitialData"), params = load("getAsyncParams")("POST");
            if (!params?.fb_dtsg || !params.lsd || !/^\d+$/u.test(String(params.__user)) ||
                ![String(initial.ACCOUNT_ID), String(initial.USER_ID)].includes(String(params.__user)))
                throw new Error("Facebook session principal or credentials unavailable");
            const form = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value === null || value === undefined)
                    continue;
                if (!["string", "number", "boolean"].includes(typeof value))
                    throw new Error("Unobserved first-party Facebook parameter shape");
                form.set(key, String(value));
            }
            form.set("av", actorId);
            form.set("fb_api_caller_class", "RelayModern");
            form.set("fb_api_req_friendly_name", operation.name);
            form.set("doc_id", operation.documentId);
            form.set("variables", JSON.stringify(variables));
            form.set("server_timestamps", "true");
            const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30_000);
            try {
                const response = await fetch("https://www.facebook.com/api/graphql/", { method: "POST", credentials: "same-origin", redirect: "error",
                    headers: { "content-type": "application/x-www-form-urlencoded", "x-fb-friendly-name": operation.name, "x-fb-lsd": String(params.lsd) },
                    body: form, signal: abort.signal });
                const reader = response.body?.getReader();
                if (!reader)
                    throw new Error("Original Facebook response has no body");
                const chunks = [];
                let length = 0;
                for (;;) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    length += part.value.byteLength;
                    if (length > 8 * 1024 * 1024) {
                        abort.abort();
                        throw new Error("Original Facebook response exceeds the supported API budget");
                    }
                    chunks.push(part.value);
                }
                const bytes = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                return { status: response.status, body: new TextDecoder().decode(bytes) };
            }
            finally {
                clearTimeout(timer);
            }
        }, { operation: { name: request.operation.name, documentId: request.operation.documentId }, variables: request.variables, actorId: actor.actorId });
    }
}
