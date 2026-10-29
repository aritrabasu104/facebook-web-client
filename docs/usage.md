# Usage guide

## 1. Supply a transport and current contracts

`FacebookSessionTransport` has two methods: `verifyActor()` returns a fresh
exact actor/session identity, and `execute(request)` returns the original HTTP
status and body. You can supply your own adapter or use the included memory-only
HTTP session after an explicit browser bootstrap. See [sessions](sessions.md).

An operation contract identifies its observed document, operation kind, outgoing
variables, evidence source digest and observation time. Read/write admission
requires current evidence, normally `api-readback-verified`, at most 24 hours
old. Discovery does not promote source artifacts to verified APIs. Do not invent
a document ID, mark an artifact verified without a live check, or refresh its
timestamp without new evidence.

```ts
import { createFacebookClient } from '@aritrabasu104/facebook-web-client';
import type { FacebookContract, FacebookSessionTransport } from
  '@aritrabasu104/facebook-web-client';

export async function searchGroups(
  transport: FacebookSessionTransport,
  observedSearch: FacebookContract,
  observedVariables: Record<string, unknown>,
) {
  return createFacebookClient({ transport }).groups.search(
    observedSearch, observedVariables,
  );
}
```

## 2. Bind a reviewed write template

Use `prepareFacebookGroupJoin`, `prepareFacebookPost` or
`prepareFacebookComment`. These functions replace only fields already present
at the contract's evidence-backed JSON pointers. They preserve all other
variables, original content and request keys, returning `{ variables,
requestSha256 }`. They never construct a guessed server input schema.

```ts
import { prepareFacebookComment } from '@aritrabasu104/facebook-web-client';
import type { FacebookContract } from '@aritrabasu104/facebook-web-client';

export function bindComment(
  contract: FacebookContract,
  reviewedTemplate: Record<string, unknown>,
  actorId: string,
  groupId: string,
  postId: string,
  feedbackId: string,
) {
  return prepareFacebookComment(contract, reviewedTemplate, {
    actorId,
    targetId: postId,
    targets: { groupId, postId, feedbackId },
  });
}
```

For comments, the contract must separately bind `groupId` and `feedbackId`.
The canonical post ID is the action target. These identities are not aliases;
do not encode, decode or substitute them for one another.

## 3. Connect the existing durable owner

Implement `NativeFacebookMutationOwner`, or adapt an already-persisted original
claim with `ExistingNativeFacebookMutationOwner` and its ports. The host owns
database transactions, locking, account serialization and restart recovery.

The required lifecycle is:

1. Verify current actor, actual target, rules, qualifications and action permission.
2. Persist the exact original claim and read it back.
3. Atomically consume its one dispatch intent before sending provider bytes.
4. Retain the original response, then perform a separate authoritative read.
5. Persist and read back the original operation's outcome.

`claim()` must refuse previous started, unknown, pending or terminal attempts;
an existing claim must match the complete request hash and identities. The
adapter's dispatch port must use a durable compare-and-set. A fresh JavaScript
object or a process-local boolean cannot provide restart-safe deduplication.

## 4. Dispatch through the separate workflows

`PreparedFacebookAction` combines the prepared variables/hash, eligibility,
owner and `verifyOutcome` callback. Joining uses `sourceOwner: "membership"`
and `membership: "not_joined"`. Posting/commenting use `sourceOwner:
"campaign"` and `membership: "joined"`; this is the generic delivery-owner
label in the public interface.

Supply `retainOriginalResponse(receipt, intent)` when the host needs original
response custody. It is awaited before `verifyOutcome`; the receipt contains
the original HTTP status, response digest, receive time and parsed result.
Keep this evidence with the original durable action, without credentials.

Eligibility must be at most 60 seconds old and establish exact actor/target,
authored language and subject, complete displayed rules, Page support, no
unverified member qualification, and action permission. A button alone is
insufficient evidence. The package validates these assertions; the host must
derive them from actual observations, not set them true to obtain admission.

Use `facebook.groups.join(contract, action)`, `facebook.posts.create(contract,
action)` or `facebook.comments.create(contract, action)`. Each returns
`{ state, operationId }` after durable readback. Results can be `verified`,
`pending`, `unknown` or `refused`.

An explicitly authorized first original verification can use an observed
mutation contract via `firstOriginalApiVerification`, but the owner must
validate its durable authorization audit. This does not promote the contract
or authorize replay. See the exported types for the exact proof fields.

## 5. Verify independently

`observeFacebookMutation()` extracts candidate result identities; it is not
success proof. Your outcome reader must check the exact original object,
author, target and unchanged content through independent reads.

For a Group post, author visibility alone can coexist with moderation; require
the delivery visibility promised by your application. Keep moderation pending
separate from membership pending. For comments, verify the parent discussion,
Group, opaque feedback and exact original comment author/body.

An unresolved response or failed readback remains `unknown` and permanently
fenced until the original owner reconciles it read-only. Never retry the write
to discover whether the earlier write succeeded.
