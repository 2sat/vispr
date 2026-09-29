import { prepare,execute,sse,errorResponse } from '../../../../lib/platform';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request) {
 try {
  const run=await prepare(req,await req.json()); const abort=new AbortController();
  async function* frames() {for await(const event of execute(run,AbortSignal.any([req.signal,abort.signal]))) yield `data: ${JSON.stringify(event)}\n\n`;}
  return new Response(sse(frames(),()=>abort.abort()),{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Vispr-Request-Id':run.id}});
 } catch(error) {return errorResponse(error);}
}
