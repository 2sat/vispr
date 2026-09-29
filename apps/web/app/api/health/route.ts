import { CONTRACT_VERSION } from '@vispr/contracts';
export function GET() { return Response.json({ service: 'vispr', status: 'scaffold', contractVersion: CONTRACT_VERSION, liveInference: false }); }
