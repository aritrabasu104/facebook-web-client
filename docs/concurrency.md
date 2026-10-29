# Concurrent campaigns

`v0.2.0` adds bounded foreground campaign execution and shared mutation
coordination. Separate workflow facades alone did not provide these guarantees.

```ts
import { runFacebookCampaigns } from '@aritrabasu104/facebook-web-client';

export async function runBatch(campaigns: {
  campaignId: string;
  run(): Promise<unknown>;
}[]) {
  return runFacebookCampaigns({ campaigns, maxConcurrency: 2 });
}
```

Pass original, independently owned campaign operations to each callback. The
finite executor returns `PromiseSettledResult[]` in input order. It waits for
every started callback, including when a sibling fails. Duplicate campaign IDs
are rejected before work starts. The concurrency bound is 1–8, with at most 256
campaigns per call. An optional `AbortSignal` prevents queued callbacks from
starting; it never abandons a started operation or assumes provider cancellation.

## What overlaps

| Work | Behavior |
| --- | --- |
| Campaign preparation and read-only work | May overlap within the foreground campaign bound |
| Same-session actor verification | Concurrent callers share one actual in-flight identity read |
| Same actor's writes | One at a time by default, through durable outcome readback |
| Different actors | May write concurrently under independent authenticated transports |
| Same actor and Group | Exclusive even with an explicitly larger mutation limit |

`FacebookApiClient` automatically shares a `FacebookOperationCoordinator` with
other clients using the same transport. Included HTTP transports expose their
coordinator. Wrappers around a shared session must forward its `coordination`
property, or use `facebookOperationCoordinator(originalTransport)`.

For multiple transport objects using the same actor, explicitly share one:

```ts
import { createFacebookClient, FacebookOperationCoordinator } from
  '@aritrabasu104/facebook-web-client';
import type { FacebookSessionTransport } from '@aritrabasu104/facebook-web-client';

export function clients(a: FacebookSessionTransport, b: FacebookSessionTransport) {
  const coordination = new FacebookOperationCoordinator();
  return [
    createFacebookClient({ transport: a, coordination }),
    createFacebookClient({ transport: b, coordination }),
  ];
}
```

An application can explicitly choose `maxConcurrentMutationsPerActor: 2` (up to
4) for independently eligible Groups. The default remains 1. Queued writes use
FIFO admission, recheck eligibility before the owner claim, and retain original
request snapshots. The bounded mutation queue defaults to 128 waiting calls;
overflow is rejected before admission without retrying.

## Durable ownership remains mandatory

Coordination is process-local. It does not replace database locks, dispatch CAS,
destination cooldowns, duplicate prevention or persistent unknown/pending
fences. Multiple processes must share a durable host owner. Do not create a new
operation after a process dies merely because the in-memory coordinator is empty.

Each campaign retains its original contract, request, claim, deadline, result
and recovery path. An unknown write is reconciled read-only by that original
owner. The package neither retries it nor credits an unresolved result.
Session expiry/challenge destroys the shared credential context and propagates
to concurrent waiters; a local timestamp cannot repair it.

The executor creates no scheduler, background worker, detached watcher, tab or
history store. It runs only the supplied finite callbacks and returns after
all started work settles.
