// Authentication and Authorization Middleware
import { Context, Next } from 'hono';
import { Env } from '../types';

// Rate limiting store (in-memory for simple implementation)
// In production, use KV store for distributed rate limiting
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Extract user ID from Authorization header
// Format: "Bearer user_id:user_email" (signed by frontend)
export function extractUserId(c: Context<{ Bindings: Env }>): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  // Simple format: userId:email - in production use JWT
  const parts = token.split(':');
  if (parts.length >= 1 && parts[0]) {
    const userId = parts[0];
    // Accept multiple ID formats:
    // - user_xxx format (credentials auth)
    // - UUID format with hyphens (36 chars)
    // - Google OAuth numeric IDs (long numeric strings, typically 21 digits)
    // - Any alphanumeric ID at least 10 chars long (fallback for other OAuth providers)
    if (
      userId.startsWith('user_') ||
      /^[a-f0-9-]{36}$/i.test(userId) ||
      /^\d{15,30}$/.test(userId) ||
      /^[a-zA-Z0-9_-]{10,}$/.test(userId)
    ) {
      return userId;
    }
  }

  return null;
}

// Middleware to require authentication
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const userId = extractUserId(c);

  if (!userId) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  // Store userId in context for later use
  c.set('userId', userId);
  await next();
}

// Middleware to verify user owns the resource they're accessing
export async function requireOwnership(c: Context<{ Bindings: Env }>, next: Next) {
  const userId = extractUserId(c);
  const targetUserId = c.req.param('id');

  if (!userId) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  if (userId !== targetUserId) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  c.set('userId', userId);
  await next();
}

// Rate limiting middleware
export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context<{ Bindings: Env }>) => string;
}) {
  const { windowMs, maxRequests, keyGenerator } = options;

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Clean up old entries periodically
    cleanupRateLimitStore();

    // Generate key (IP address by default)
    const key = keyGenerator
      ? keyGenerator(c)
      : c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (record) {
      if (now > record.resetTime) {
        // Reset window
        rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      } else if (record.count >= maxRequests) {
        // Rate limited
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        c.header('Retry-After', retryAfter.toString());
        return c.json(
          { success: false, error: 'Too many requests. Please try again later.' },
          429
        );
      } else {
        // Increment counter
        record.count++;
      }
    } else {
      // First request
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    }

    await next();
  };
}

// Security headers middleware
export async function securityHeaders(c: Context<{ Bindings: Env }>, next: Next) {
  await next();

  // Add security headers to response
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Only add HSTS in production
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// Input validation helpers
export function validateEmail(email: string): boolean {
  // More strict email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
}

export function validateUserId(userId: string): boolean {
  // User IDs should match format: user_<32_hex_chars>
  return /^user_[a-f0-9]{32}$/.test(userId);
}

export function validatePuuid(puuid: string): boolean {
  // Riot PUUID format: 78 characters, alphanumeric with hyphens
  return /^[a-zA-Z0-9_-]{70,80}$/.test(puuid);
}

export function sanitizeInput(input: string, maxLength: number = 1000): string {
  // Remove potentially dangerous characters and limit length
  return input
    .slice(0, maxLength)
    .replace(/[<>'"]/g, '') // Remove HTML/SQL special chars
    .trim();
}

// Clean up old rate limit entries during request processing
// This is called within the rate limit middleware to avoid global scope issues
function cleanupRateLimitStore() {
  const now = Date.now();
  // Only cleanup occasionally to avoid performance impact
  if (rateLimitStore.size > 1000) {
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetTime + 60000) {
        rateLimitStore.delete(key);
      }
    }
  }
}
