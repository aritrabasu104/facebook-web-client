import { FacebookApiClient, type FacebookMutationEligibility, type NativeFacebookMutationOwner, type FacebookMutationIntent, type FacebookFirstOriginalApiVerification, type FacebookOriginalApiResponse } from "./client.js";
import type { FacebookContract } from "./contracts.js";
import type { FacebookGraphqlResult } from "./protocol.js";

/** Native orchestration supplies the reviewed payload and existing claim owner.
 * These separate workflow facades share one protocol/session implementation. */
export interface PreparedFacebookAction {
  variables: Record<string, unknown>;
  requestSha256: string;
  eligibility: FacebookMutationEligibility;
  owner: NativeFacebookMutationOwner;
  firstOriginalApiVerification?: FacebookFirstOriginalApiVerification;
  retainOriginalResponse?(receipt: FacebookOriginalApiResponse, intent: FacebookMutationIntent): Promise<void>;
  verifyOutcome(result: FacebookGraphqlResult, intent: FacebookMutationIntent): Promise<{ state: "verified" | "pending" | "unknown" | "refused"; resultId?: string; reason?: string }>;
}
export class FacebookGroupMembershipApi {
  constructor(private readonly api: FacebookApiClient) {}
  search(contract: FacebookContract, variables: Record<string, unknown>) {
    if (contract.operation !== "groups.search") throw new Error("A Group-search query is required");
    return this.api.query(contract, variables);
  }
  join(contract: FacebookContract, action: PreparedFacebookAction) {
    if (contract.operation !== "groups.join" || action.eligibility.sourceOwner !== "membership") throw new Error("Joining belongs to the membership owner");
    return this.api.mutate({ contract, ...action });
  }
}
export class FacebookPostingApi {
  constructor(private readonly api: FacebookApiClient) {}
  create(contract: FacebookContract, action: PreparedFacebookAction) {
    if (contract.operation !== "posts.create" || action.eligibility.sourceOwner !== "campaign") throw new Error("Posting belongs to the original campaign owner");
    return this.api.mutate({ contract, ...action });
  }
}
export class FacebookCommentingApi {
  constructor(private readonly api: FacebookApiClient) {}
  create(contract: FacebookContract, action: PreparedFacebookAction) {
    if (contract.operation !== "comments.create" || action.eligibility.sourceOwner !== "campaign") throw new Error("Commenting belongs to the original campaign owner");
    return this.api.mutate({ contract, ...action });
  }
}
