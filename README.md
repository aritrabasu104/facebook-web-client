# Facebook Web Client

A typed Node.js package for Facebook web GraphQL operations, with separate
Group membership, posting and commenting interfaces.

This is an unofficial client for observed web-client operations. It is not
Meta's public Graph API. Operation definitions are supplied by the caller and
can change independently of this package. No account, credentials, live targets
or preverified operation catalog ships with the library.

## Install

Requires **Node.js 24 or later**. Install directly from GitHub:

```sh
npm install git+https://github.com/aritrabasu104/facebook-web-client.git#v0.2.1
```

Compiled ESM and TypeScript declarations are included, so installation does not
run a build or a lifecycle script. For reproducible applications, pin the Git
commit recorded in your lockfile. This release is distributed through GitHub;
it is not published to the npm registry.

## Import and use

```ts
import { createFacebookClient } from '@aritrabasu104/facebook-web-client';
import type {
  FacebookContract,
  FacebookSessionTransport,
  PreparedFacebookAction,
} from '@aritrabasu104/facebook-web-client';

export function facebookOperations(transport: FacebookSessionTransport) {
  const facebook = createFacebookClient({ transport });
  return {
    search: (contract: FacebookContract, variables: Record<string, unknown>) =>
      facebook.groups.search(contract, variables),
    join: (contract: FacebookContract, action: PreparedFacebookAction) =>
      facebook.groups.join(contract, action),
    post: (contract: FacebookContract, action: PreparedFacebookAction) =>
      facebook.posts.create(contract, action),
    comment: (contract: FacebookContract, action: PreparedFacebookAction) =>
      facebook.comments.create(contract, action),
  };
}
```

The application supplies its authenticated transport, current verified operation
contract, reviewed variables, eligibility evidence and durable operation owner.
The package does not turn an HTTP 200 or an enabled button into publication
proof. A write is dispatched once, retained, and checked through the caller's
independent outcome reader.

**Start here:** [Usage guide](docs/usage.md) · [API reference](docs/api.md) ·
[Session bootstrap](docs/sessions.md) · [Architecture](docs/architecture.md) ·
[Concurrent campaigns](docs/concurrency.md)

For a complete runnable example with **synthetic data and no network access**:

```sh
git clone https://github.com/aritrabasu104/facebook-web-client.git
cd facebook-web-client
npm ci
npm run example
```

See [examples/mock-workflows.mjs](examples/mock-workflows.mjs). The example's
in-memory owner demonstrates the interface; production owners must persist
claims, dispatch intent and outcomes across process restarts.

## Modules

| Import | Purpose |
| --- | --- |
| Package root | Client factory, membership/post/comment facades, contracts, request binding, outcomes and session transports |
| `/cdp-page` | Optional exact-target browser bootstrap adapter; no browser launch or tab creation |
| `/store` | Compressed, content-addressed SQLite protocol evidence and contract catalog |
| `/research` | Inert Relay source discovery, sanitized-capture checks and observed-artifact validation |
| `/client`, `/protocol`, `/requests`, `/contracts` | Focused lower-level imports |
| `/concurrency` | Bounded campaign batches and shared per-actor/Group mutation admission |

## Behavior

- Readiness is separate for joining, posting and commenting.
- Normal requests use first-party HTTP after an authorized session bootstrap.
- Cookies and CSRF material stay in memory; sessions are explicitly destroyed.
- Writes require fresh exact-actor and target checks and a durable claim.
- Retained protocol definitions keep their original observation dates. Their
  age alone does not expire them or trigger browser work; every operation still
  requires current API responses, exact source bindings and its native owner.
- Group, post and opaque feedback identities remain separate.
- Pending, unknown, refused and verified outcomes remain distinct.
- No automatic mutation retries, browser fallback, scheduler or background worker.
- Concurrent campaign preparation with ordered same-actor writes by default.

Use only accounts and actions you are authorized to operate. The library does
not handle login challenges, bypass access controls, or relax admission rules.

## Develop

```sh
npm ci
npm run check
npm pack --dry-run
```

Tests use synthetic identities and mocked transports. They do not establish
that a particular live Facebook mutation is currently supported. See
[SECURITY.md](SECURITY.md) for private vulnerability reporting. MIT licensed.
