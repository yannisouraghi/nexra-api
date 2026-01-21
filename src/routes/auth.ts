import { Hono } from 'hono';
import { Env } from '../types';
import { rateLimit } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

// Strict rate limiting for auth endpoints (prevent brute force)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts per window
});

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_hash: string | null;
  auth_provider: string;
  riot_puuid: string | null;
  riot_game_name: string | null;
  riot_tag_line: string | null;
  riot_region: string | null;
  credits: number;
  subscription_tier: string;
  created_at: string;
  updated_at: string;
}

// Password hashing using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// Generate unique user ID
function generateUserId(): string {
  return `user_${crypto.randomUUID().replace(/-/g, '')}`;
}

// Free credits for new users - centralized constant for security
const FREE_CREDITS_FOR_NEW_USERS = 3;

// Register new user with email/password
app.post('/register', authRateLimit, async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    name?: string;
  }>();

  // Validation
  if (!body.email || !body.password) {
    return c.json({ success: false, error: 'Email and password are required' }, 400);
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return c.json({ success: false, error: 'Invalid email format' }, 400);
  }

  // Password strength validation
  if (body.password.length < 8) {
    return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
  }

  // Strong password requirements
  if (!/[A-Z]/.test(body.password) || !/[a-z]/.test(body.password) || !/[0-9]/.test(body.password)) {
    return c.json({ success: false, error: 'Password must contain uppercase, lowercase, and numbers' }, 400);
  }

  try {
    // Check if email already exists
    const existing = await c.env.DB.prepare(
      'SELECT id, auth_provider FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first<{ id: string; auth_provider: string }>();

    if (existing) {
      if (existing.auth_provider === 'google') {
        return c.json({
          success: false,
          error: 'This email is already registered with Google. Please sign in with Google.',
        }, 409);
      }
      return c.json({ success: false, error: 'Email already registered' }, 409);
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);
    const userId = generateUserId();
    const now = new Date().toISOString();
    const normalizedEmail = body.email.toLowerCase();

    // Check if this email has already received free credits before
    // (protection against delete/recreate account abuse)
    const alreadyReceivedCredits = await c.env.DB.prepare(
      'SELECT 1 FROM used_free_credits WHERE LOWER(email) = ?'
    ).bind(normalizedEmail).first();

    // Determine credits to give: 0 if already received, FREE_CREDITS otherwise
    const creditsToGive = alreadyReceivedCredits ? 0 : FREE_CREDITS_FOR_NEW_USERS;

    // Create user with credits (server-side only, never from client)
    await c.env.DB.prepare(`
      INSERT INTO users (id, email, name, password_hash, auth_provider, credits, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, ?, 'credentials', ?, ?, ?, ?)
    `).bind(
      userId,
      normalizedEmail,
      body.name || normalizedEmail.split('@')[0],
      passwordHash,
      creditsToGive,
      now,
      now,
      now
    ).run();

    // If this email hasn't received free credits yet, record it
    if (!alreadyReceivedCredits) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO used_free_credits (email, received_at) VALUES (?, ?)'
      ).bind(normalizedEmail, now).run();
    }

    // Fetch created user
    const newUser = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userId).first<User>();

    return c.json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: newUser?.id,
        email: newUser?.email,
        name: newUser?.name,
        image: newUser?.image,
      },
      freeCreditsGiven: !alreadyReceivedCredits,
    }, 201);
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ success: false, error: 'Registration failed' }, 500);
  }
});

// Login with email/password
app.post('/login', authRateLimit, async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!body.email || !body.password) {
    return c.json({ success: false, error: 'Email and password are required' }, 400);
  }

  try {
    // Find user by email
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first<User>();

    if (!user) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }

    // Check if user was registered with Google
    if (user.auth_provider === 'google' || !user.password_hash) {
      return c.json({
        success: false,
        error: 'This account uses Google sign-in. Please sign in with Google.',
      }, 401);
    }

    // Verify password
    const isValid = await verifyPassword(body.password, user.password_hash);

    if (!isValid) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }

    // Update last login
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, now, user.id).run();

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, error: 'Login failed' }, 500);
  }
});

export default app;
