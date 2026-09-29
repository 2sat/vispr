import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { PlatformError } from './platform-error';
/** Deployment-scoped, expiring acceptance credential. Disabled unless explicitly configured. */
export function operator(req:Request) {
  const secret=process.env.VISPR_ACCEPTANCE_TOKEN;
  const expires=Date.parse(process.env.VISPR_ACCEPTANCE_EXPIRES_AT??'');
  const header=req.headers.get('Authorization')??'';
  const expected=`Bearer ${secret}`;
  if(!secret || !Number.isFinite(expires) || expires<Date.now() || expires>Date.now()+2*3600000 || Buffer.byteLength(header)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(header),Buffer.from(expected))) throw new PlatformError('UNAUTHORIZED','Acceptance operator credential required',401);
}
