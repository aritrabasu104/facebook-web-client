import { FacebookBrowserSessionTransport, type FacebookOriginPage } from "./browser-session.js";
import { assertContract, type FacebookContract } from "./contracts.js";
import { parseFacebookGraphqlResponse, graphqlRequest, facebookRateLimitObservation, FacebookRateLimitError, type FacebookSessionTransport } from "./protocol.js";
import { FacebookSessionRecoveryRequired, type CapturedFacebookRequestSession, type FacebookHttpSessionTransport } from "./http-session.js";

type Actor = Awaited<ReturnType<FacebookSessionTransport["verifyActor"]>>;
export interface FacebookApiSessionBootstrapPage extends FacebookOriginPage {
  captureQuerySessionBootstrap<T>(name: string, probe: () => Promise<T>): Promise<{ result: T; bootstrap: CapturedFacebookRequestSession }>;
}
export interface FacebookApiIdentityTemplate { contract: FacebookContract; variables: Record<string, unknown> }

/** One explicit login/session-recovery boundary. Routine actor checks use the
 * authenticated identity query over HTTP; this function never sends mutations,
 * launches Chrome, acquires a tab, retries writes, or stores session material. */
export async function bootstrapFacebookApiFirstSession(input: {
  page: FacebookApiSessionBootstrapPage;
  originalSessionId: string;
  configuredActor: { actorId: string; actorUrl: string; displayName: string };
  nativeActorProof(): Promise<Actor>;
  identity: FacebookApiIdentityTemplate;
  probe: FacebookApiIdentityTemplate;
}): Promise<FacebookHttpSessionTransport> {
  const identity = structuredClone(input.identity), probe = structuredClone(input.probe), configured = { ...input.configuredActor };
  for (const template of [identity, probe]) {
    assertContract(template.contract);
    const age = Date.now() - Date.parse(template.contract.observedAt);
    if (template.contract.kind !== "query" || age < 0 || age > 86_400_000) throw new Error("Current source-observed read templates are required for session bootstrap");
  }
  if (identity.contract.operation !== "identity.read" || identity.contract.name !== "CometSettingsDropdownTriggerQuery" ||
      !/^\d+$/u.test(configured.actorId) || configured.actorUrl !== `https://www.facebook.com/profile.php?id=${configured.actorId}` || !configured.displayName.trim()) {
    throw new Error("The exact configured Page identity query is required");
  }
  const proof = async () => {
    const actor = await input.nativeActorProof();
    if (actor.actorId !== configured.actorId || actor.actorUrl !== configured.actorUrl || actor.sessionId !== input.originalSessionId ||
        Date.now() - Date.parse(actor.verifiedAt) < 0 || Date.now() - Date.parse(actor.verifiedAt) > 60_000) throw new FacebookSessionRecoveryRequired("identity_unverified");
    return actor;
  };
  const browser = new FacebookBrowserSessionTransport(input.page, input.originalSessionId, proof);
  const captured = await input.page.captureQuerySessionBootstrap(probe.contract.name, () => browser.execute(graphqlRequest(probe.contract, probe.variables)));
  let session: FacebookHttpSessionTransport | undefined;
  try {
    if (facebookRateLimitObservation(captured.result)) throw new FacebookRateLimitError(captured.result, graphqlRequest(probe.contract, probe.variables));
    if (parseFacebookGraphqlResponse(captured.result).state !== "data") throw new FacebookSessionRecoveryRequired("unavailable");
    session = captured.bootstrap.consume(await proof());
    session.setActorReadback(async send => {
      const result = parseFacebookGraphqlResponse(await send(graphqlRequest(identity.contract, identity.variables)));
      const actors = result.state === "data" ? result.data.map(data => (data as any).viewer?.actor).filter(Boolean) : [];
      if (!actors.length || actors.some(a => a.id !== configured.actorId || a.name !== configured.displayName)) throw new FacebookSessionRecoveryRequired("identity_unverified");
      return { actorId: configured.actorId, actorUrl: configured.actorUrl, sessionId: input.originalSessionId, verifiedAt: new Date().toISOString() };
    });
    await session.verifyActor(); return session;
  } catch (error) { session?.destroy(); throw error; }
  finally { captured.bootstrap.destroy(); }
}
