// Synthetic, network-free demonstration. This is not a production database owner.
import assert from 'node:assert/strict';
import { createFacebookClient, prepareFacebookGroupJoin, prepareFacebookPost,
  prepareFacebookComment } from '../dist/index.js';

const at = new Date().toISOString();
const actor = { actorId: '101', actorUrl: 'https://www.facebook.com/profile.php?id=101',
  sessionId: 'synthetic-session', verifiedAt: at };
let sent = 0;
const retainedResponses = [];
const facebook = createFacebookClient({ transport: {
  async verifyActor() { return { ...actor }; },
  async execute() { sent++; return { status: 200, body: '{"data":{"synthetic":true}}' }; },
} });

function contract(operation, name) {
  return { operation, name, documentId: '1001', kind: 'mutation', variables: ['input', 'groupID'],
    responseFields: [], evidence: 'api-readback-verified', sourceSha256: 'a'.repeat(64),
    sourceModule: 'synthetic-example-only', observedAt: at, limitations: ['Synthetic; never send to a service.'],
    actorVariablePaths: ['/input/actor_id'], targetVariableBindings: operation === 'comments.create'
      ? { groupId: ['/groupID'], feedbackId: ['/input/feedback_id'] } : { groupId: ['/groupID'] } };
}

function action(c, prepared, targets, resultId) {
  const sourceOwner = c.operation === 'groups.join' ? 'membership' : 'campaign';
  // Only an interface demonstration. Production must persist this lifecycle
  // transactionally and refuse consumed attempts after process restart.
  let intent, dispatched = false, outcome;
  return { ...prepared, eligibility: { ...actor, targetId: targets.postId ?? targets.groupId,
    targetBindings: targets, operation: c.operation, sourceOwner, checkedAt: at,
    languageVerified: true, subjectVerified: true, rulesComplete: true, pagesAllowed: true,
    actionPermissionVerified: true, memberQualifications: 'none', qualificationQuote: '',
    membership: sourceOwner === 'membership' ? 'not_joined' : 'joined' },
    owner: {
      async claim(input) { assert.equal(intent, undefined); intent = { ...input, operationId: c.operation, state: 'claimed' }; return intent; },
      async dispatchStarted() { assert.equal(dispatched, false); dispatched = true; },
      async recordOutcome(_intent, value) { assert.equal(dispatched, true); outcome = value; },
      async readBack() { return { state: outcome.state, operationId: intent.operationId }; },
    },
    async retainOriginalResponse(receipt, original) {
      assert.equal(original.operationId, c.operation);
      retainedResponses.push(receipt.responseSha256);
    },
    async verifyOutcome() { assert.equal(retainedResponses.length, sent); return { state: 'verified', resultId }; },
  };
}

const group = { groupId: '202' };
const template = { groupID: 'old', input: { actor_id: 'old', message: { text: 'Synthetic example' },
  client_mutation_id: 'synthetic-original-request', feedback_id: 'old' } };
const join = contract('groups.join', 'GroupCometJoinForumMutation');
const post = contract('posts.create', 'ComposerStoryCreateMutation');
const comment = contract('comments.create', 'useCometUFICreateCommentMutation');
const discussion = { ...group, postId: '303', feedbackId: 'opaque-example-feedback' };
const results = [
  await facebook.groups.join(join, action(join, prepareFacebookGroupJoin(join, template,
    { actorId: actor.actorId, targetId: group.groupId, targets: group }), group, group.groupId)),
  await facebook.posts.create(post, action(post, prepareFacebookPost(post, template,
    { actorId: actor.actorId, targetId: group.groupId, targets: group }), group, 'example-story')),
  await facebook.comments.create(comment, action(comment, prepareFacebookComment(comment, template,
    { actorId: actor.actorId, targetId: discussion.postId, targets: discussion }), discussion, 'example-comment')),
];
assert.equal(sent, 3);
assert.equal(retainedResponses.length, 3);
assert.deepEqual(results.map(r => r.state), ['verified', 'verified', 'verified']);
console.log('Three synthetic workflows completed through imported package APIs; no network used.');
