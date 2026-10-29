# API reference

All exports include TypeScript declarations. ESM imports are supported.

| Export | Description |
| --- | --- |
| `createFacebookClient({ transport, now? })` | Composes `{ api, groups, posts, comments }` over one supplied transport |
| `FacebookApiClient.query(contract, variables)` | Verified, fresh read contract; returns parsed GraphQL result |
| `FacebookApiClient.mutate(input)` | Exact eligibility, durable claim, single dispatch and outcome readback |
| `FacebookGroupMembershipApi.search/join` | Separate membership workflow |
| `FacebookPostingApi.create` | Original Group post workflow |
| `FacebookCommentingApi.create` | Original comment workflow |
| `prepareFacebookGroupJoin/Post/Comment` | Exact observed-template binding and request digest |
| `facebookApiRequestSha256` | Hashes the same canonical request representation used by dispatch guards |
| `ExistingNativeFacebookMutationOwner` | Adapts host claim readback, durable CAS, retention and outcome ports |
| `observeFacebookMutation` | Candidate result extraction; does not credit success |
| `outcomeFromNativeFacebookReadback` | Validates original operation, request, actor, session, target and observed outcome |
| `parseFacebookGraphqlResponse` | Handles JSON, anti-hijack prefix and line-delimited frames; partial errors stay unknown |
| `migrationReadiness` | Independent current capability status for joining/posting/commenting |
| `FacebookHttpSessionTransport` | Bounded memory-only first-party HTTP transport |
| `bootstrapFacebookApiFirstSession` | One explicit read-only browser-to-HTTP bootstrap with exact actor proof |
| `FacebookSessionRecoveryRequired` | Explicit expired/challenge/identity/unavailable recovery boundary |

Focused entry points expose their complete module declarations:

```ts
import { FacebookCdpPage } from '@aritrabasu104/facebook-web-client/cdp-page';
import { FacebookApiEvidenceStore } from '@aritrabasu104/facebook-web-client/store';
import { discoverRelayContracts } from '@aritrabasu104/facebook-web-client/research';
import type { FacebookContract } from '@aritrabasu104/facebook-web-client/contracts';
```

`FacebookApiEvidenceStore` accepts a caller-owned Node `DatabaseSync`. It stores
compressed, content-addressed source evidence and current contracts. It is not
an action queue or a durable mutation owner. Applications must provide all
native operation evidence pins before pruning unreferenced research evidence.

`discoverRelayContracts(source, observedAt)` parses selected JavaScript as inert
data with Acorn. It does not execute downloaded code. The `/research` entry also
exports credential-free HAR admission and bounded observed-artifact verifiers.

Operation names are recognized, but no current document IDs, authenticated
catalog, account identifiers or captured responses are bundled.
