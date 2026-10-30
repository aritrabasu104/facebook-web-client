import { expect, it } from 'vitest';
import { assertContract, operationForName, type FacebookContract } from '../src/contracts.js';
it('recognizes the observed pending-content query as a read and refuses mutation relabelling',()=>{
  const c:FacebookContract={name:'GroupsCometViewerContentPendingRootQuery',operation:'posts.read',documentId:'30507502372172219',kind:'query',variables:['groupID'],responseFields:['group'],evidence:'source-derived',sourceSha256:'a'.repeat(64),sourceModule:'GroupsCometViewerContentPendingRootQuery.graphql',observedAt:'2026-10-30T04:00:00Z',limitations:[]};
  expect(operationForName(c.name)).toBe('posts.read');expect(()=>assertContract(c)).not.toThrow();
  expect(()=>assertContract({...c,operation:'posts.create',kind:'mutation'})).toThrow();
  expect(operationForName('GroupsCometViewerContentPendingMutation')).toBeUndefined();
});
