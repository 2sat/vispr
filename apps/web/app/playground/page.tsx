import { AppHeader } from '../../components/AppHeader';
import { Playground } from '../../components/Playground';
import { policies, scenarios } from '../../lib/demo-fixtures';
import { runScenario } from '../../lib/vispr-server';

// Scenario and policy presets are product configuration, not results,
// so they are safe to ship from fixtures even on the live path.
export default function PlaygroundPage() {
  return (
    <>
      <AppHeader active="playground" traceHref="/runs/demo-code-debugging" role="Builder" />
      <Playground scenarios={scenarios} policies={policies} initialScenarioId="code-debugging" runScenario={runScenario}
        openaiConfigured={Boolean(process.env.OPENAI_API_KEY)} />
    </>
  );
}
