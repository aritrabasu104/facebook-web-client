import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookCdpPage } from "../src/cdp-page.js";

const endpoint = "ws://127.0.0.1:9222/devtools/browser/test-approved";
const target = { target_id: "exact-native-target", origin: "https://www.facebook.com", url: "https://www.facebook.com/profile.php?id=101" };
let inventory: any[], responses: any[], commands: any[], sockets: FakeSocket[], changedUrl: string | undefined;
class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  constructor(_endpoint: string) { super(); sockets.push(this); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
  send(bytes: string) {
    const message = JSON.parse(bytes); commands.push(message);
    let result: any;
    if (message.method === "Target.getTargets") result = { targetInfos: inventory };
    else if (message.method === "Target.attachToTarget") result = { sessionId: "original-target-session" };
    else if (message.method === "Target.getTargetInfo") result = { targetInfo: { type: "page", url: changedUrl ?? target.url } };
    else if (message.method === "Runtime.evaluate") result = responses.shift() ?? { result: { value: { verified: true } } };
    else result = {};
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: message.id, result }) })));
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
function setup() {
  commands = []; sockets = []; responses = []; changedUrl = undefined;
  inventory = [{ targetId: target.target_id, type: "page", url: target.url }];
  vi.stubGlobal("WebSocket", FakeSocket);
}
afterEach(() => vi.unstubAllGlobals());
describe("Facebook application CDP custody", () => {
  it("attaches only the exact REA target and closes only its own session", async () => {
    setup(); const page = await FacebookCdpPage.connect(endpoint, target);
    expect(await page.evaluate(() => ({ verified: true }), {})).toEqual({ verified: true });
    await page.close();
    expect(commands[0].method).toBe("Target.getTargets");
    expect(commands.find(c => c.method === "Target.attachToTarget").params).toEqual({ targetId: target.target_id, flatten: true });
    expect(commands.find(c => c.method === "Runtime.evaluate").sessionId).toBe("original-target-session");
    expect(commands.at(-1)).toMatchObject({ method: "Target.detachFromTarget", params: { sessionId: "original-target-session" } });
    expect(commands.some(c => /closeTarget|Browser.close|navigate|Input\./u.test(c.method))).toBe(false);
    expect(sockets[0]!.readyState).toBe(3);
  });
  it.each(["absent", "duplicate", "changed"])("refuses an %s target without acquiring a replacement", async kind => {
    setup();
    if (kind === "absent") inventory = [{ ...inventory[0], targetId: "other-target" }];
    if (kind === "duplicate") inventory.push({ ...inventory[0] });
    if (kind === "changed") inventory[0].url = "https://www.facebook.com/";
    await expect(FacebookCdpPage.connect(endpoint, target)).rejects.toThrow("absent or changed");
    expect(commands.map(c => c.method)).toEqual(["Target.getTargets"]); expect(sockets[0]!.readyState).toBe(3);
  });
  it("rejects a foreign origin before evaluation", async () => {
    setup(); const page = await FacebookCdpPage.connect(endpoint, target);
    changedUrl = "https://unrelated.example/";
    await expect(page.evaluate(() => 1, {})).rejects.toThrow("escaped");
    expect(commands.some(c => c.method === "Runtime.evaluate")).toBe(false); await page.close();
  });
  it("does not repeat a returned evaluation error", async () => {
    setup(); const page = await FacebookCdpPage.connect(endpoint, target);
    responses.push({ exceptionDetails: { text: "failed" }, result: { subtype: "error" } });
    await expect(page.evaluate(() => 1, {})).rejects.toThrow("verified result");
    expect(commands.filter(c => c.method === "Runtime.evaluate")).toHaveLength(1); await page.close();
  });
  it("rejects a non-loopback debugger before connection", async () => {
    setup(); await expect(FacebookCdpPage.connect(endpoint.replace("127.0.0.1", "remote.example"), target)).rejects.toThrow("approved loopback");
    expect(sockets).toHaveLength(0);
  });
});
