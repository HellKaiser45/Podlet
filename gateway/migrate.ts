import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";

// Connect to local.db
const sqlite = new Database("local.db");
const db = drizzle(sqlite);

// Run migrations from ./drizzle folder
console.log("⏳ Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✅ Migrations complete!");

process.exit(0);
