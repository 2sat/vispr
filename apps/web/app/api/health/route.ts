import { CONTRACT_VERSION } from '@vispr/contracts';
export function GET() {
  const demo = process.env.VISPR_DEMO_FIXTURES === '1';
  return Response.json({
    service: 'vispr', status: demo ? 'demo' : 'scaffold', contractVersion: CONTRACT_VERSION,
    liveInference: false,
    responseGeneration: demo && process.env.OPENAI_API_KEY ? 'openai' : 'prepared',
    routing: demo ? 'simulated' : 'pending',
  });
}
