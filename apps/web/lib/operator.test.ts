import { afterEach, expect, it, vi } from 'vitest';
import { operator } from './operator';
import { POST } from '../app/api/operator/acceptance/route';
afterEach(()=>vi.unstubAllEnvs());
it('disables acceptance operations without deployment-scoped credentials',async()=>{
  vi.stubEnv('VISPR_ACCEPTANCE_TOKEN','');
  expect(()=>operator(new Request('https://vispr.fixture'))).toThrow('Acceptance operator');
  expect((await POST(new Request('https://vispr.fixture',{method:'POST',body:'{"action":"provision"}'}))).status).toBe(401);
});
it('requires an exact credential and a short unexpired acceptance window',()=>{
  vi.stubEnv('VISPR_ACCEPTANCE_TOKEN','fixture-secret');
  const request=new Request('https://vispr.fixture',{headers:{Authorization:'Bearer fixture-secret'}});
  vi.stubEnv('VISPR_ACCEPTANCE_EXPIRES_AT',new Date(Date.now()+3600000).toISOString());
  expect(()=>operator(request)).not.toThrow();
  expect(()=>operator(new Request('https://vispr.fixture',{headers:{Authorization:'Bearer other-secret'}}))).toThrow();
  vi.stubEnv('VISPR_ACCEPTANCE_EXPIRES_AT',new Date(Date.now()-1000).toISOString());expect(()=>operator(request)).toThrow();
  vi.stubEnv('VISPR_ACCEPTANCE_EXPIRES_AT',new Date(Date.now()+3*3600000).toISOString());expect(()=>operator(request)).toThrow();
});
