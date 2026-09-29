import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const raw = execFileSync("npx", ["supabase", "status", "--output", "json"], {encoding:"utf8"});
const s = JSON.parse(raw);
const values = {
  NEXT_PUBLIC_SUPABASE_URL:s.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:s.PUBLISHABLE_KEY || s.ANON_KEY,
  SUPABASE_SECRET_KEY:s.SECRET_KEY || s.SERVICE_ROLE_KEY,
  DATABASE_URL:s.DB_URL
};
if (Object.values(values).some(v => !v)) throw new Error("Local Supabase credentials missing; start Supabase first");
writeFileSync("apps/web/.env.local", Object.entries(values).map(([k,v]) => `${k}=${v}`).join("\n")+"\n", {mode:0o600});
console.log("Local Supabase credentials written to ignored apps/web/.env.local");
