# Architecture

```text
Host application
  authenticated session + observed contracts + reviewed action
  durable owner / locks / eligibility observations / independent outcome reads
        |
createFacebookClient
  groups.search/join      posts.create      comments.create
        \                    |                 /
                FacebookApiClient
          request binding -> claim -> single dispatch -> readback
                           |
               FacebookSessionTransport
                 first-party HTTP
```

The package owns protocol mechanics, request binding, session scope, claim
handoff validation, conservative response parsing and separate operation
interfaces. The host owns purpose, content, scheduling, eligibility assessment,
database policy and recovery of original durable operations.

Browser bootstrap is an optional boundary outside normal operation. Research
and SQLite evidence are separate entry points. There is no built-in scheduler,
detached process, automatic target discovery loop or background session keeper.

An application's released build should pin the installed package commit and
its compiled dependency bytes. Updating a dependency must not change a held
worker's original protocol graph or authorize repeating an accepted/unknown
operation.
