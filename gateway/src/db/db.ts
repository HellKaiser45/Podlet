import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schemas';

const sqlite = new Database('local.db');

sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });


