export * from "./concurrency.js";
export * from "./contracts.js";
export * from "./protocol.js";
export * from "./client.js";
export * from "./requests.js";
export * from "./observations.js";
export * from "./native-owner.js";
export * from "./workflows.js";
export * from "./browser-session.js";
export * from "./http-session.js";
export * from "./session-bootstrap.js";
import { FacebookApiClient } from "./client.js";
import { FacebookGroupMembershipApi, FacebookPostingApi, FacebookCommentingApi } from "./workflows.js";
import type { FacebookSessionTransport } from "./protocol.js";

/** Compose independent workflows over one caller-owned authenticated transport. */
export function createFacebookClient(input: { transport: FacebookSessionTransport; now?: () => number; coordination?: import("./concurrency.js").FacebookOperationCoordinator }) {
  const api = new FacebookApiClient(input.transport, input.now, input.coordination);
  return { api, groups: new FacebookGroupMembershipApi(api), posts: new FacebookPostingApi(api), comments: new FacebookCommentingApi(api) };
}
