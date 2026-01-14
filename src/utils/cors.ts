import { Context, Next } from 'hono';
import { Env } from '../types';

export const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
});

export const corsMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const origin = c.req.header('Origin') || '';
  const allowedOrigins = [
    c.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed)) ||
                    c.env.ENVIRONMENT === 'development';

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(isAllowed ? origin : allowedOrigins[0]),
    });
  }

  await next();

  if (isAllowed) {
    const headers = corsHeaders(origin);
    Object.entries(headers).forEach(([key, value]) => {
      c.res.headers.set(key, value);
    });
  }
};
