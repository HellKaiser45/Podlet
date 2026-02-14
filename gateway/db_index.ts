import { db } from "./src/db/db";
import { agents, conversations } from "./src/db/schemas";
import { eq } from "drizzle-orm";

console.log("--- Fetching Agents ---");
const allAgents = await db.select().from(agents);
console.log(allAgents);

console.log("\n--- Fetching Conversation for 'python_expert' ---");
const chat = await db.select().from(conversations)
  .where(eq(conversations.agentName, 'python_expert'))
  .limit(1);

if (chat[0]) {
  console.log(chat[0].history);
}
