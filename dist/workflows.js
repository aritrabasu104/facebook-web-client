export class FacebookGroupMembershipApi {
    api;
    constructor(api) {
        this.api = api;
    }
    search(contract, variables) {
        if (contract.operation !== "groups.search")
            throw new Error("A Group-search query is required");
        return this.api.query(contract, variables);
    }
    join(contract, action) {
        if (contract.operation !== "groups.join" || action.eligibility.sourceOwner !== "membership")
            throw new Error("Joining belongs to the membership owner");
        return this.api.mutate({ contract, ...action });
    }
}
export class FacebookPostingApi {
    api;
    constructor(api) {
        this.api = api;
    }
    create(contract, action) {
        if (contract.operation !== "posts.create" || action.eligibility.sourceOwner !== "campaign")
            throw new Error("Posting belongs to the original campaign owner");
        return this.api.mutate({ contract, ...action });
    }
}
export class FacebookCommentingApi {
    api;
    constructor(api) {
        this.api = api;
    }
    create(contract, action) {
        if (contract.operation !== "comments.create" || action.eligibility.sourceOwner !== "campaign")
            throw new Error("Commenting belongs to the original campaign owner");
        return this.api.mutate({ contract, ...action });
    }
}
