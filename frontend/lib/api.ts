// Single place to set the backend base URL.
// Override at runtime via NEXT_PUBLIC_API_BASE (set in .env.local).
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
