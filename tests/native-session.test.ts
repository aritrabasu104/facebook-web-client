import {describe,it,expect,vi} from "vitest";
import {FacebookHttpSessionTransport,type FacebookNativeCredentialStore} from "../src/http-session.js";
import {restoreFacebookApiFirstSession} from "../src/session-bootstrap.js";
import {graphqlRequest} from "../src/protocol.js";
import type {FacebookContract} from "../src/contracts.js";

const actorId="615",actorUrl="https://www.facebook.com/profile.php?id=615";
const identity:FacebookContract={name:"CometSettingsDropdownTriggerQuery",operation:"identity.read",documentId:"456",kind:"query",variables:[],responseFields:[],
  evidence:"api-readback-verified",sourceSha256:"a".repeat(64),sourceModule:"retained-source",observedAt:"2020-01-01T00:00:00.000Z",limitations:[]};
function fixture(){
  let retained:Uint8Array|undefined;
  const store:FacebookNativeCredentialStore={read:vi.fn(async()=>retained?.slice()),write:vi.fn(async bytes=>{retained=bytes.slice();})};
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({data:{viewer:{actor:{id:actorId,name:"Brand"}}}})));
  const session=new FacebookHttpSessionTransport({actor:{actorId,actorUrl,sessionId:"original",verifiedAt:new Date().toISOString()},
    params:{__user:"615",fb_dtsg:"private-csrf",lsd:"private-lsd"},cookies:[{name:"c_user",value:"private-cookie",domain:"www.facebook.com",path:"/"}],
    userAgent:"fixture",referer:actorUrl},{fetch:fetcher});
  session.setActorReadback(async send=>{await send(graphqlRequest(identity,{}));return{actorId,actorUrl,sessionId:"original",verifiedAt:new Date().toISOString()};});
  const restore=()=>restoreFacebookApiFirstSession({store,originalSessionId:"restored",configuredActor:{actorId,actorUrl,displayName:"Brand"},identity:{contract:identity,variables:{}},fetch:fetcher});
  return{store,fetcher,session,restore,bytes:()=>retained};
}
describe("private native HTTP credential custody",()=>{
  it("restores and verifies the same account over HTTP without a Browser interface",async()=>{
    const f=fixture();await f.session.verifyActor();
    expect(await f.session.retainNativeCredentials(f.store,{channelClientId:"client",scale:1})).toBe(true);f.session.destroy();
    f.fetcher.mockClear();const restored=await f.restore();
    expect(restored?.context).toEqual({channelClientId:"client",scale:1});
    expect(await restored!.session.verifyActor()).toMatchObject({actorId,sessionId:"restored"});
    expect(f.fetcher).toHaveBeenCalledOnce();expect(JSON.stringify(restored!.session)).not.toMatch(/private-cookie|private-csrf/);
    expect(f.fetcher.mock.calls[0]![0]).toBe("https://www.facebook.com/api/graphql/");restored!.session.destroy();
  });
  it("does not turn missing credentials into a Browser or HTTP login attempt",async()=>{
    const f=fixture();expect(await f.restore()).toBeUndefined();expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("cannot store bootstrap proof without an actual verified identity read",async()=>{
    const f=fixture();f.session.setActorReadback(async()=>({actorId,actorUrl,sessionId:"original",verifiedAt:new Date().toISOString()}));
    expect(await f.session.retainNativeCredentials(f.store,{channelClientId:"client",scale:1})).toBe(false);
    expect(f.store.write).not.toHaveBeenCalled();
  });
  it("preserves retained custody after a real identity refusal without another request",async()=>{
    const f=fixture();await f.session.verifyActor();await f.session.retainNativeCredentials(f.store,{channelClientId:"client",scale:1});
    const before=f.bytes()!.slice();f.session.destroy();f.fetcher.mockClear();f.fetcher.mockResolvedValue(new Response(null,{status:403}));
    await expect(f.restore()).rejects.toThrow("challenge");expect(f.fetcher).toHaveBeenCalledOnce();expect(f.bytes()).toEqual(before);
  });
  it("rejects another configured account before sending retained material",async()=>{
    const f=fixture();await f.session.verifyActor();await f.session.retainNativeCredentials(f.store,{channelClientId:"client",scale:1});f.fetcher.mockClear();
    await expect(restoreFacebookApiFirstSession({store:f.store,originalSessionId:"foreign",configuredActor:{actorId:"999",actorUrl:"https://www.facebook.com/profile.php?id=999",displayName:"Other"},
      identity:{contract:identity,variables:{}},fetch:f.fetcher})).rejects.toThrow("reconciliation");expect(f.fetcher).not.toHaveBeenCalled();
  });
});
