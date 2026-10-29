export declare class FacebookOperationCoordinator {
    private readonly accounts;
    private queued;
    private readonly maximum;
    private readonly bound;
    constructor(options?: {
        maxConcurrentMutationsPerActor?: number;
        maxQueuedMutations?: number;
    });
    mutate<T>(identity: {
        actorUrl: string;
        groupId: string;
    }, run: () => Promise<T>): Promise<T>;
    private drain;
}
export declare function facebookOperationCoordinator(transport: {
    readonly coordination?: FacebookOperationCoordinator;
}): FacebookOperationCoordinator;
/** Run a finite batch, draining every started campaign even if a sibling
 * rejects. Results retain input order. No retries, detached work or persistence. */
export declare function runFacebookCampaigns<T>(input: {
    campaigns: readonly {
        campaignId: string;
        run(): Promise<T>;
    }[];
    maxConcurrency?: number;
    signal?: AbortSignal;
}): Promise<PromiseSettledResult<T>[]>;
