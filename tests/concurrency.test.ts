import { describe, expect, it, vi } from 'vitest';
import { FacebookOperationCoordinator, facebookOperationCoordinator, runFacebookCampaigns } from '../src/concurrency.js';
import { FacebookApiClient, facebookApiRequestSha256, type FacebookMutationEligibility } from '../src/client.js';
import type { FacebookContract } from '../src/contracts.js';
const actorUrl = 'https://www.facebook.com/profile.php?id=101';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe('bounded foreground campaign concurrency', () => {
  it('overlaps campaigns, respects the bound, preserves order and drains a failing sibling', async () => {
    const a = deferred(), b = deferred(), both = deferred(); let active = 0, peak = 0, started = 0;
    const batch = runFacebookCampaigns({ maxConcurrency: 2, campaigns: ['a', 'b', 'c'].map((campaignId, i) => ({ campaignId, run: async () => {
      peak = Math.max(peak, ++active); if (++started === 2) both.resolve();
      try { if (i === 0) await a.promise; if (i === 1) { await b.promise; throw Error('original failure'); } return i; }
      finally { active--; }
    } })) });
    await both.promise; expect(active).toBe(2); a.resolve(); b.resolve();
    const results = await batch;
    expect(peak).toBe(2); expect(active).toBe(0);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results[2]).toEqual({ status: 'fulfilled', value: 2 });
  });
  it('refuses duplicate campaign ownership before starting any work', async () => {
    const run = vi.fn(); await expect(runFacebookCampaigns({ campaigns: [{ campaignId: 'a', run }, { campaignId: 'a', run }] })).rejects.toThrow('duplicate');
    expect(run).not.toHaveBeenCalled();
  });
  it('does not start queued work after cancellation and still drains the original active call', async () => {
    const stop = new AbortController(), entered = deferred(), release = deferred(), second = vi.fn();
    const batch = runFacebookCampaigns({ maxConcurrency: 1, signal: stop.signal, campaigns: [
      { campaignId: 'a', run: async () => { entered.resolve(); await release.promise; return 1; } },
      { campaignId: 'b', run: second },
    ] });
    await entered.promise; stop.abort(); release.resolve();
    expect((await batch).map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(second).not.toHaveBeenCalled();
  });
  it.each([0, -1, 9, 1.5, NaN])('rejects invalid bound %s', async maxConcurrency => {
    await expect(runFacebookCampaigns({ maxConcurrency, campaigns: [] })).rejects.toThrow();
  });
});
describe('shared account mutation coordination', () => {
  it('coordinates actual separate clients and rechecks queued eligibility before the second owner claim', async () => {
    let now = Date.parse('2026-10-29T12:00:00Z'); const entered = deferred(), release = deferred();
    const contract: FacebookContract = { operation: 'groups.join', name: 'GroupCometJoinForumMutation', documentId: '123', kind: 'mutation', variables: ['groupID'],
      responseFields: [], evidence: 'api-readback-verified', sourceSha256: 'a'.repeat(64), sourceModule: 'synthetic', observedAt: new Date(now).toISOString(), limitations: [], targetVariablePaths: ['/groupID'] };
    const transport = { verifyActor: async () => ({ actorUrl, actorId: '101', sessionId: 'synthetic', verifiedAt: new Date(now).toISOString() }),
      execute: vi.fn(async () => { entered.resolve(); await release.promise; return { status: 200, body: '{"data":{}}' }; }) };
    const eligibility: FacebookMutationEligibility = { actorUrl, actorId: '101', targetId: '202', operation: 'groups.join', sourceOwner: 'membership', checkedAt: new Date(now).toISOString(),
      languageVerified: true, subjectVerified: true, rulesComplete: true, pagesAllowed: true, memberQualifications: 'none', qualificationQuote: '', membership: 'not_joined', actionPermissionVerified: true };
    const makeOwner = () => ({ claim: vi.fn(async (claim: any) => ({ ...claim, state: 'claimed' as const, operationId: claim.targetId })), dispatchStarted: vi.fn(async () => undefined),
      recordOutcome: vi.fn(async () => undefined), readBack: async (intent: any) => ({ state: 'verified', operationId: intent.operationId }) });
    const firstOwner = makeOwner(), secondOwner = makeOwner();
    const call = (groupID: string, owner: ReturnType<typeof makeOwner>) => new FacebookApiClient(transport, () => now).mutate({ contract, variables: { groupID },
      requestSha256: facebookApiRequestSha256(contract, { groupID }), eligibility: { ...eligibility, targetId: groupID }, owner,
      verifyOutcome: async () => ({ state: 'verified' as const, resultId: groupID }) });
    const first = call('202', firstOwner); await entered.promise;
    const second = call('303', secondOwner); void second.catch(() => undefined);
    expect(secondOwner.claim).not.toHaveBeenCalled(); now += 61_000; release.resolve();
    expect((await Promise.allSettled([first, second])).map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(secondOwner.claim).not.toHaveBeenCalled(); expect(transport.execute).toHaveBeenCalledTimes(1);
  });
  it('serializes same-actor writes across separate clients and releases after rejection', async () => {
    const coordinator = new FacebookOperationCoordinator(), entered = deferred(), release = deferred(); const order: string[] = [];
    const first = coordinator.mutate({ actorUrl, groupId: '202' }, async () => { order.push('first'); entered.resolve(); await release.promise; throw Error('original'); });
    void first.catch(() => undefined); await entered.promise;
    const second = coordinator.mutate({ actorUrl, groupId: '303' }, async () => { order.push('second'); return 2; });
    expect(order).toEqual(['first']); release.resolve();
    expect((await Promise.allSettled([first, second])).map(r => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(order).toEqual(['first', 'second']);
  });
  it('can overlap explicitly bounded independent Groups while retaining a same-Group exclusive turn', async () => {
    const c = new FacebookOperationCoordinator({ maxConcurrentMutationsPerActor: 2 });
    const release = deferred(), entered = deferred(); let active = 0;
    const a = c.mutate({ actorUrl, groupId: '202' }, async () => { active++; entered.resolve(); await release.promise; active--; });
    await entered.promise;
    const b = c.mutate({ actorUrl, groupId: '303' }, async () => { expect(active).toBe(1); });
    await b;
    const same = vi.fn(async () => undefined), next = c.mutate({ actorUrl, groupId: '202' }, same);
    expect(same).not.toHaveBeenCalled(); release.resolve(); await Promise.all([a, next]); expect(same).toHaveBeenCalledTimes(1);
  });
  it('keeps independent actors concurrent without sharing mutable identity', async () => {
    const c = new FacebookOperationCoordinator(), a = deferred(), entered = deferred();
    const first = c.mutate({ actorUrl, groupId: '202' }, async () => { entered.resolve(); await a.promise; });
    await entered.promise;
    await c.mutate({ actorUrl: 'https://www.facebook.com/profile.php?id=102', groupId: '202' }, async () => undefined);
    a.resolve(); await first;
  });
  it('shares a coordinator by transport and forwards an explicitly bound wrapper', () => {
    const transport = {}, c = facebookOperationCoordinator(transport);
    expect(facebookOperationCoordinator(transport)).toBe(c);
    expect(facebookOperationCoordinator({ coordination: c })).toBe(c);
    expect(facebookOperationCoordinator({})).not.toBe(c);
  });
  it('rejects queued overflow before invoking an owner and never retries', async () => {
    const c = new FacebookOperationCoordinator({ maxQueuedMutations: 1 }), entered = deferred(), release = deferred(), run = vi.fn(async () => undefined);
    const a = c.mutate({ actorUrl, groupId: '202' }, async () => { entered.resolve(); await release.promise; }); await entered.promise;
    const b = c.mutate({ actorUrl, groupId: '303' }, run);
    await expect(c.mutate({ actorUrl, groupId: '404' }, run)).rejects.toThrow('full');
    release.resolve(); await Promise.all([a, b]); expect(run).toHaveBeenCalledTimes(1);
  });
});
