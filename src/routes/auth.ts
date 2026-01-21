import { Hono } from 'hono';
import { Env } from '../types';
import { rateLimit } from '../middleware/auth';
import { sendEmail, generateVerificationCode, createVerificationEmailHtml } from '../services/email';

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
  email_verified: number;
  riot_puuid: string | null;
  riot_game_name: string | null;
  riot_tag_line: string | null;
  riot_region: string | null;
  credits: number;
  subscription_tier: string;
  created_at: string;
  updated_at: string;
}

// Password hashing using PBKDF2 (more secure than plain SHA-256)
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;

async function hashPassword(password: string): Promise<string> {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // Import password as key
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  // Combine salt + hash
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Format: pbkdf2$iterations$salt$hash
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Check if it's a new PBKDF2 hash or legacy SHA-256
  if (storedHash.startsWith('pbkdf2$')) {
    // New PBKDF2 format: pbkdf2$iterations$salt$hash
    const parts = storedHash.split('$');
    if (parts.length !== 4) return false;

    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    // Convert salt from hex to Uint8Array
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));

    // Import password as key
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // Derive key using same parameters
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    const hashHex = Array.from(new Uint8Array(derivedBits))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hashHex === expectedHashHex;
  } else {
    // Legacy SHA-256 hash (for backward compatibility)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const legacyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return legacyHash === storedHash;
  }
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

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // Store verification code
    await c.env.DB.prepare(`
      INSERT INTO verification_codes (email, code, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(normalizedEmail, verificationCode, expiresAt, now).run();

    // Send verification email
    const emailHtml = createVerificationEmailHtml(verificationCode, body.name || normalizedEmail.split('@')[0]);
    const emailSent = await sendEmail(c.env.RESEND_API_KEY, {
      to: normalizedEmail,
      subject: 'Verify your Nexra account',
      html: emailHtml,
    });

    if (!emailSent) {
      console.error('Failed to send verification email to:', normalizedEmail);
      // Don't fail registration, but log the error
    }

    // Fetch created user
    const newUser = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userId).first<User>();

    return c.json({
      success: true,
      message: 'Account created! Please check your email for verification code.',
      requiresVerification: true,
      user: {
        id: newUser?.id,
        email: newUser?.email,
        name: newUser?.name,
        image: newUser?.image,
        emailVerified: false,
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

    // Check if email is verified
    if (!user.email_verified) {
      return c.json({
        success: false,
        error: 'Please verify your email before signing in.',
        requiresVerification: true,
        email: user.email,
      }, 403);
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

// Verify email with code
app.post('/verify-email', authRateLimit, async (c) => {
  const body = await c.req.json<{
    email: string;
    code: string;
  }>();

  if (!body.email || !body.code) {
    return c.json({ success: false, error: 'Email and code are required' }, 400);
  }

  const normalizedEmail = body.email.toLowerCase();
  const now = new Date().toISOString();

  try {
    // Find the verification code
    const verification = await c.env.DB.prepare(`
      SELECT * FROM verification_codes
      WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(normalizedEmail, body.code, now).first<{
      id: number;
      email: string;
      code: string;
      expires_at: string;
      used: number;
    }>();

    if (!verification) {
      return c.json({ success: false, error: 'Invalid or expired verification code' }, 400);
    }

    // Mark code as used
    await c.env.DB.prepare(
      'UPDATE verification_codes SET used = 1 WHERE id = ?'
    ).bind(verification.id).run();

    // Mark user email as verified
    await c.env.DB.prepare(
      'UPDATE users SET email_verified = 1, updated_at = ? WHERE email = ?'
    ).bind(now, normalizedEmail).run();

    // Get user info
    const user = await c.env.DB.prepare(
      'SELECT id, email, name, image FROM users WHERE email = ?'
    ).bind(normalizedEmail).first<{ id: string; email: string; name: string | null; image: string | null }>();

    return c.json({
      success: true,
      message: 'Email verified successfully!',
      user: user,
    });
  } catch (error) {
    console.error('Verification error:', error);
    return c.json({ success: false, error: 'Verification failed' }, 500);
  }
});

// Resend verification code
app.post('/resend-verification', authRateLimit, async (c) => {
  const body = await c.req.json<{ email: string }>();

  if (!body.email) {
    return c.json({ success: false, error: 'Email is required' }, 400);
  }

  const normalizedEmail = body.email.toLowerCase();
  const now = new Date().toISOString();

  try {
    // Check if user exists and is not verified
    const user = await c.env.DB.prepare(
      'SELECT id, name, email_verified FROM users WHERE email = ?'
    ).bind(normalizedEmail).first<{ id: string; name: string | null; email_verified: number }>();

    if (!user) {
      // Don't reveal if email exists or not
      return c.json({ success: true, message: 'If an account exists, a verification code has been sent.' });
    }

    if (user.email_verified) {
      return c.json({ success: false, error: 'Email is already verified' }, 400);
    }

    // Check if a code was sent recently (prevent spam)
    const recentCode = await c.env.DB.prepare(`
      SELECT created_at FROM verification_codes
      WHERE email = ? AND created_at > datetime('now', '-1 minute')
      ORDER BY created_at DESC LIMIT 1
    `).bind(normalizedEmail).first();

    if (recentCode) {
      return c.json({ success: false, error: 'Please wait before requesting a new code' }, 429);
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Store verification code
    await c.env.DB.prepare(`
      INSERT INTO verification_codes (email, code, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(normalizedEmail, verificationCode, expiresAt, now).run();

    // Send verification email
    const emailHtml = createVerificationEmailHtml(verificationCode, user.name || normalizedEmail.split('@')[0]);
    const emailSent = await sendEmail(c.env.RESEND_API_KEY, {
      to: normalizedEmail,
      subject: 'Verify your Nexra account',
      html: emailHtml,
    });

    if (!emailSent) {
      console.error('Failed to send verification email to:', normalizedEmail);
      return c.json({ success: false, error: 'Failed to send verification email' }, 500);
    }

    return c.json({ success: true, message: 'Verification code sent!' });
  } catch (error) {
    console.error('Resend verification error:', error);
    return c.json({ success: false, error: 'Failed to resend verification' }, 500);
  }
});

export default app;
