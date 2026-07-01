import Database from 'bun:sqlite';
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schemas';
import { join } from "path";


export function createDB(path: string, name: string) {

  let sqlite: Database;

  if (name === ':memory:') {
    sqlite = new Database(name)
  }

  else {
    sqlite = new Database(join(path, name));
  }

  const db = drizzle(sqlite, { schema });

  sqlite.run('PRAGMA foreign_keys = ON');
  migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle/") })

  return db;
}




