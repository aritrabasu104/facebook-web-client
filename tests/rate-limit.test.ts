import {describe,it,expect} from 'vitest';
import {inspect} from 'node:util';
import {facebookRateLimitObservation,FacebookRateLimitError,parseFacebookGraphqlResponse,graphqlRequest} from '../src/protocol.js';
import type {FacebookContract} from '../src/contracts.js';
describe('exact Facebook rate-limit observations',()=>{
  it.each([
    {status:429,body:'<html>slow down</html>',retryAfter:'900'},
    {status:200,body:JSON.stringify({errors:[{code:1675004,message:'Rate limit exceeded'}]})},
    {status:200,body:'for (;;);'+JSON.stringify({error:1675004})},
    {status:200,body:JSON.stringify({data:{viewer:null}})+'\n'+JSON.stringify({incremental:[{errors:[{code:'1675004'}]}]})},
  ])('classifies a concrete quota response without granting delivery',response=>{
    expect(facebookRateLimitObservation(response)).toBeDefined();
    expect(parseFacebookGraphqlResponse(response).state).not.toBe('data');
  });
  it.each([
    {status:403,body:'<html>checkpoint</html>'},
    {status:200,body:JSON.stringify({errors:[{code:200,message:'Permission denied'}]})},
    {status:200,body:JSON.stringify({data:{post:{text:'Rate limit exceeded',code:1675004}}})},
    {status:200,body:'not a response'},
  ])('keeps unrelated refusals and authored text outside cooldown classification',response=>{
    expect(facebookRateLimitObservation(response)).toBeUndefined();
  });
  it('preserves a valid provider retry time and drops unsafe header values',()=>{
    expect(facebookRateLimitObservation({status:429,body:'',retryAfter:'900'})).toMatchObject({retryAfter:'900'});
    expect(facebookRateLimitObservation({status:429,body:'',retryAfter:'900\r\nCookie:private'})).not.toHaveProperty('retryAfter');
  });
  it('exposes exact original read bytes only explicitly and redacts default error inspection',()=>{
    const contract:FacebookContract={name:'CometSettingsDropdownTriggerQuery',operation:'identity.read',documentId:'123',kind:'query',variables:[],responseFields:[],
      evidence:'api-readback-verified',sourceSha256:'a'.repeat(64),sourceModule:'fixture',observedAt:new Date().toISOString(),limitations:[]};
    const response={status:200,body:JSON.stringify({errors:[{code:1675004,message:'private-provider-detail'}]})};
    const error=new FacebookRateLimitError(response,graphqlRequest(contract,{}));
    expect(error.response).toEqual(response);expect(JSON.stringify(error)+inspect(error)).not.toContain('private-provider-detail');
    expect(()=>new FacebookRateLimitError({status:200,body:'{"data":{}}'},graphqlRequest(contract,{}))).toThrow();
  });
});
