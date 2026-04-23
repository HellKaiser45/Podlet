import { appbase } from "@podlet/api-client";


export const BASE_URL = typeof window !== 'undefined'
  ? (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000')
  : (process.env.API_URL ?? 'http://localhost:3000');

export const api = appbase(BASE_URL).api

