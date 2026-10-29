import { FACEBOOK_ORIGIN, FACEBOOK_GRAPHQL_URL, operationForName } from "./contracts.js";
import { CapturedFacebookRequestSession } from "./http-session.js";
/** Application-side connection to the one target selected by REA. No browser
 * launch, automatic target attachment, navigation, input, or Browser.close. */
export class FacebookCdpPage {
    socket;
    targetId;
    serial = 0;
    sessionId;
    observers = new Set();
    pending = new Map();
    constructor(socket, targetId) {
        this.socket = socket;
        this.targetId = targetId;
        socket.addEventListener("message", event => {
            if (typeof event.data !== "string" || event.data.length > 16 * 1024 * 1024)
                return;
            let message;
            try {
                message = JSON.parse(event.data);
            }
            catch {
                return;
            }
            if (message.sessionId === this.sessionId && message.method)
                for (const observer of this.observers)
                    observer(message);
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error)
                pending.reject(new Error(`Original scoped Facebook CDP ${pending.method} failed (${String(message.error.code)}): ${String(message.error.message).slice(0, 240)}`));
            else
                pending.resolve(message.result);
        });
        socket.addEventListener("close", () => {
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error("Original Facebook application connection closed"));
            }
            this.pending.clear();
        });
    }
    static async connect(endpoint, target) {
        const u = new URL(endpoint);
        if (u.protocol !== "ws:" || !["127.0.0.1", "[::1]"].includes(u.hostname) || !u.port || u.username || u.password || u.search || u.hash ||
            !/^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(u.pathname) || target.origin !== FACEBOOK_ORIGIN || new URL(target.url).origin !== FACEBOOK_ORIGIN || !/^[A-Za-z0-9-]+$/u.test(target.target_id)) {
            throw new Error("Expected the approved loopback browser socket and exact Facebook target from REA");
        }
        const socket = new WebSocket(endpoint), page = new FacebookCdpPage(socket, target.target_id);
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Original Facebook application handshake deadline")), 20_000);
                socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
                socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Original Facebook application handshake failed")); }, { once: true });
            });
            // Resolve the immutable REA selection in this connection's own inventory.
            // Never substitute another target merely because its URL is convenient.
            const inventory = await page.command("Target.getTargets", {}, false);
            const matches = Array.isArray(inventory.targetInfos) ? inventory.targetInfos.filter((row) => row.targetId === target.target_id) : [];
            if (matches.length !== 1 || matches[0].type !== "page" || matches[0].url !== target.url)
                throw new Error("REA-selected Facebook target is absent or changed before attachment");
            const attached = await page.command("Target.attachToTarget", { targetId: target.target_id, flatten: true }, false);
            if (!attached.sessionId)
                throw new Error("Facebook application target attachment is unverified");
            page.sessionId = attached.sessionId;
            await page.url();
            return page;
        }
        catch (error) {
            socket.close();
            throw error;
        }
    }
    command(method, params, target = true) {
        if (this.socket.readyState !== WebSocket.OPEN || target && !this.sessionId)
            return Promise.reject(new Error("Original Facebook application transport is unavailable"));
        const id = ++this.serial;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Original scoped Facebook CDP ${method} command deadline; result remains unknown`)); }, 40_000);
            this.pending.set(id, { method, resolve, reject, timer });
            try {
                this.socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: this.sessionId } : {}) }));
            }
            catch {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error("Original scoped Facebook command could not be sent"));
            }
        });
    }
    async url() {
        const target = await this.command("Target.getTargetInfo", { targetId: this.targetId }, false), url = target.targetInfo?.url;
        if (target.targetInfo?.type !== "page" || !url || new URL(url).origin !== FACEBOOK_ORIGIN)
            throw new Error("Facebook application target escaped its approved origin");
        return url;
    }
    async evaluate(fn, argument) {
        await this.url();
        const source = fn.toString(), encoded = JSON.stringify(argument);
        if (!encoded || encoded.length > 1_048_576 || source.length > 65_536)
            throw new Error("Facebook application execution exceeds the foreground request budget");
        const expression = `(async()=>{if(location.origin!==${JSON.stringify(FACEBOOK_ORIGIN)})throw Error('Facebook origin changed');const result=await (${source})(${encoded});if(location.origin!==${JSON.stringify(FACEBOOK_ORIGIN)})throw Error('Facebook origin changed');return result;})()`;
        const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails || result.result?.subtype === "error" || !result.result || !("value" in result.result))
            throw new Error("Original Facebook application evaluation did not return a verified result");
        await this.url();
        return result.result.value;
    }
    async close() {
        try {
            if (this.sessionId && this.socket.readyState === WebSocket.OPEN)
                await this.command("Target.detachFromTarget", { sessionId: this.sessionId }, false);
        }
        finally {
            this.sessionId = undefined;
            this.socket.close();
        }
    }
    async facebookCookies() {
        await this.url();
        const result = await this.command("Network.getCookies", { urls: [FACEBOOK_ORIGIN + "/api/graphql/"] });
        if (!Array.isArray(result.cookies) || result.cookies.length > 128)
            throw new Error("Facebook bootstrap cookie scope is invalid");
        await this.url();
        return result.cookies.map(({ name, value, domain, path, secure, expires }) => ({ name, value, domain, path, secure, expires }));
    }
    async captureQuerySessionBootstrap(operationName, probe) {
        if (!["groups.search", "identity.read", "groups.inspect", "groups.membership", "groups.rules", "posts.read", "comments.read", "discussions.list"].includes(operationForName(operationName) ?? ""))
            throw new Error("Session bootstrap requires an observed read-only operation");
        await this.url();
        const requests = new Map(), extra = new Map();
        let resolve, reject;
        const captured = new Promise((yes, no) => { resolve = yes; reject = no; });
        void captured.catch(() => undefined);
        const complete = (id) => {
            const request = requests.get(id), headers = extra.get(id);
            if (!request || !headers || !Object.keys(headers).some(k => k.toLowerCase() === "cookie"))
                return;
            resolve(new CapturedFacebookRequestSession({ ...request.headers, ...headers }, request.postData));
        };
        const observer = (event) => {
            const id = event.params?.requestId;
            if (typeof id !== "string" || id.length > 256)
                return;
            if (event.method === "Network.requestWillBeSent") {
                const r = event.params.request;
                if (r?.url !== FACEBOOK_GRAPHQL_URL || r.method !== "POST" || typeof r.postData !== "string" || r.postData.length > 1_048_576)
                    return;
                const form = new URLSearchParams(r.postData);
                if (form.get("fb_api_req_friendly_name") !== operationName)
                    return;
                requests.set(id, r);
                complete(id);
            }
            else if (event.method === "Network.requestWillBeSentExtraInfo" && extra.size < 128) {
                extra.set(id, event.params.headers ?? {});
                complete(id);
            }
        };
        this.observers.add(observer);
        const timer = setTimeout(() => reject(new Error("Original Facebook query bootstrap observation deadline")), 30_000);
        // Observe only this owned target/session. No interception or request rewrite.
        try {
            await this.command("Network.enable", { maxPostDataSize: 1_048_576 });
            const [result, bootstrap] = await Promise.all([probe(), captured]);
            return { result, bootstrap };
        }
        finally {
            clearTimeout(timer);
            this.observers.delete(observer);
            requests.clear();
            extra.clear();
            await this.command("Network.disable", {}).catch(() => undefined);
        }
    }
}
