export const FIXTURES: string;
export function respond(url: string, headers?: Record<string, string>): { status: number; body: string; etag: string | null };
export function fixtureFetch(log?: (req: { url: string; headers: Record<string, string> }) => void): (url: string, init?: RequestInit) => Promise<Response>;
