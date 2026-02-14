import { db } from "./src/db/db";
import * as schema from "./src/db/schemas";

console.log("🌱 Seeding database...");

await db.insert(schema.agents).values({
  name: 'python_expert',
  description: 'Expert in Python coding',
  systemPrompt: 'You are an expert Python developer.',
  model: 'kimi-k2.5',
  provider: 'moonshot',
  tools: [
    {
      type: 'function',
      function: {
        name: 'execute_python',
        description: 'Runs python code and returns output',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'The python code to run' }
          },
          required: ['code']
        }
      }
    }
  ]
});

await db.insert(schema.conversations).values({
  agentName: 'python_expert',
  conversationId: 'conv-001',
  history: [
    { role: 'user', content: 'How do I install pandas?' },
    { role: 'assistant', content: 'You can install it using pip install pandas.' }
  ]
});

console.log("✅ Seeding complete!");
process.exit(0);
