import { appbase } from "@podlet/api-client";


export const BASE_URL = typeof window !== 'undefined'
  ? (() => {
      const envUrl = import.meta.env.VITE_API_URL;
      if (envUrl === '') return window.location.origin;
      return envUrl ?? 'http://localhost:3000';
    })()
  : (process.env.API_URL ?? 'http://localhost:3000');

export const api = appbase(BASE_URL).api

