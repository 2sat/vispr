import { afterEach,it,expect,vi } from 'vitest';
import { Database } from '@vispr/db';
import { dashboardUser,dashboardApp } from './platform';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function identity(members:unknown[]) {
 vi.stubEnv('SUPABASE_URL','https://db.fixture');vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_fixture');
 vi.stubGlobal('fetch',async()=>Response.json({id:'alice',is_anonymous:false,user_metadata:{role:'owner'}}));
 return new Database('https://db.fixture','sb_secret_fixture',async(input)=>String(input).includes('/memberships')?Response.json(members):Response.json([{id:'other-app',organization_id:'org',owner_user_id:'bob'}]));
}
it('denies an authenticated but uninvited user regardless of editable role metadata',async()=>{
 const db=identity([]);await expect(dashboardUser(new Request('https://vispr.fixture',{headers:{Authorization:'Bearer user-token'}}),db)).rejects.toMatchObject({code:'UNAUTHORIZED',status:403});
});
it('denies another builders application while allowing the org owner',async()=>{
 const req=new Request('https://vispr.fixture',{headers:{Authorization:'Bearer user-token'}});
 await expect(dashboardApp(req,'other-app',identity([{organization_id:'org',role:'builder'}]))).rejects.toMatchObject({status:403});
 expect((await dashboardApp(req,'other-app',identity([{organization_id:'org',role:'owner'}]))).id).toBe('other-app');
});
