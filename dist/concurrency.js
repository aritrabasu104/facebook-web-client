export class FacebookOperationCoordinator {
    accounts = new Map();
    queued = 0;
    maximum;
    bound;
    constructor(options = {}) {
        this.maximum = options.maxConcurrentMutationsPerActor ?? 1;
        this.bound = options.maxQueuedMutations ?? 128;
        if (!Number.isSafeInteger(this.maximum) || this.maximum < 1 || this.maximum > 4 ||
            !Number.isSafeInteger(this.bound) || this.bound < 1 || this.bound > 1024)
            throw new Error('Invalid Facebook mutation concurrency bounds');
    }
    mutate(identity, run) {
        if (!/^https:\/\/www\.facebook\.com\/profile\.php\?id=\d+$/u.test(identity.actorUrl) || !/^\d+$/u.test(identity.groupId)) {
            return Promise.reject(new Error('Exact actor and canonical Group are required for concurrent writes'));
        }
        if (this.queued >= this.bound)
            return Promise.reject(new Error('Facebook mutation admission queue is full; no claim started'));
        const account = this.accounts.get(identity.actorUrl) ?? { active: 0, groups: new Set(), waiting: [] };
        this.accounts.set(identity.actorUrl, account);
        this.queued++;
        return new Promise((resolve, reject) => {
            account.waiting.push({ groupId: identity.groupId, run, resolve: value => resolve(value), reject });
            this.drain(identity.actorUrl, account);
        });
    }
    drain(key, account) {
        while (account.active < this.maximum && account.waiting.length) {
            const turn = account.waiting[0];
            if (account.groups.has(turn.groupId))
                break;
            account.waiting.shift();
            this.queued--;
            account.active++;
            account.groups.add(turn.groupId);
            void Promise.resolve().then(turn.run).then(turn.resolve, turn.reject).finally(() => {
                account.active--;
                account.groups.delete(turn.groupId);
                this.drain(key, account);
            });
        }
        if (!account.active && !account.waiting.length)
            this.accounts.delete(key);
    }
}
const shared = new WeakMap();
export function facebookOperationCoordinator(transport) {
    if (transport.coordination)
        return transport.coordination;
    let value = shared.get(transport);
    if (!value) {
        value = new FacebookOperationCoordinator();
        shared.set(transport, value);
    }
    return value;
}
/** Run a finite batch, draining every started campaign even if a sibling
 * rejects. Results retain input order. No retries, detached work or persistence. */
export async function runFacebookCampaigns(input) {
    const limit = input.maxConcurrency ?? 2, tasks = input.campaigns.map(t => ({ campaignId: t.campaignId, run: t.run }));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8 || tasks.length > 256 ||
        tasks.some(t => !t.campaignId || t.campaignId.length > 512 || typeof t.run !== 'function') ||
        new Set(tasks.map(t => t.campaignId)).size !== tasks.length)
        throw new Error('Invalid or duplicate Facebook campaign batch');
    const results = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const i = cursor++;
            if (i >= tasks.length)
                return;
            if (input.signal?.aborted) {
                results[i] = { status: 'rejected', reason: input.signal.reason ?? new Error('Campaign batch aborted before start') };
                continue;
            }
            try {
                results[i] = { status: 'fulfilled', value: await tasks[i].run() };
            }
            catch (reason) {
                results[i] = { status: 'rejected', reason };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}
