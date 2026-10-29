import { type FacebookContract } from "./contracts.js";
import { type FacebookTargetBindings } from "./client.js";
export type FacebookMutationIdentity = {
    actorId: string;
    targetId: string;
    targets?: FacebookTargetBindings;
};
export declare function prepareFacebookGroupJoin(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity): {
    variables: Record<string, unknown>;
    requestSha256: string;
};
export declare function prepareFacebookPost(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity): {
    variables: Record<string, unknown>;
    requestSha256: string;
};
export declare function prepareFacebookComment(contract: FacebookContract, template: Record<string, unknown>, identity: FacebookMutationIdentity): {
    variables: Record<string, unknown>;
    requestSha256: string;
};
