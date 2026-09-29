import { CONTRACT_VERSION } from '@vispr/contracts';
export function GET() {
  const demo = process.env.VISPR_DEMO_FIXTURES === '1';
  return Response.json({
    service: 'vispr', status: demo ? 'demo' : 'scaffold', contractVersion: CONTRACT_VERSION,
    liveInference: false,
    responseGeneration: demo && process.env.OPENAI_API_KEY && process.env.VISPR_DEMO_ACCESS_CODE ? 'openai-presenter' : 'prepared',
    routing: demo ? 'simulated' : 'pending',
  });
}
