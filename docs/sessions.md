# Session bootstrap and recovery

Normal reads and writes can use HTTP. Browser access is limited to an explicit
login/session bootstrap, recovery or an exceptional check in the host app.
The library does not launch Chrome, enable debugging, create windows, select
accounts or solve login/security challenges.

For an authorized already-open Facebook tab, the optional adapter connects to
a caller-supplied loopback browser socket and exact target ID/URL:

```ts
import { FacebookCdpPage } from '@aritrabasu104/facebook-web-client/cdp-page';
import { bootstrapFacebookApiFirstSession } from '@aritrabasu104/facebook-web-client';

// Values and identity/probe contracts come from the host's current observations.
const page = await FacebookCdpPage.connect(approvedLoopbackSocket, exactTarget);
try {
  const session = await bootstrapFacebookApiFirstSession({
    page,
    originalSessionId,
    configuredActor,
    nativeActorProof, // Fresh exact actor URL/ID and the same original session.
    identity,        // Observed Settings identity query and exact variables.
    probe: identity,
  });
  // Pass session to createFacebookClient({ transport: session }).
  // Retain it only for the bounded foreground work; call session.destroy().
} finally {
  await page.close(); // Detaches this connection; does not close the browser/tab.
}
```

This is an integration sketch, not a credential loader. See the exported
`FacebookApiIdentityTemplate`, `FacebookApiSessionBootstrapPage` and
`FacebookSessionTransport` types for the inputs the host must provide.

Bootstrap observes one actual first-party read request, consumes its request
context once in memory, and independently checks the configured actor through
HTTP. Cookies/CSRF material are sent only to the exact Facebook origin.
Session objects redact JSON/inspection output, but callers must still avoid
serializing raw bootstrap input, request headers, captures or browser state.

The default idle lease is 15 minutes, bounded to at most 30 minutes. Only a real
same-actor/session identity HTTP read renews it. A cached timestamp, unrelated
request or already-expired session cannot renew it. Expiry, identity mismatch
or challenge destroys the memory context and requests host recovery. A lost
write response does not grant a new write after bootstrap.

Use a dedicated browser window when that helps isolate work. Chrome debugger
permission can apply to a whole profile; this adapter still restricts
attachment/observation to the exact selected Facebook target. Never attach to
unrelated user tabs or expose the debugger on a public network interface.
