import { Hono } from 'hono';
import { Env } from '../types';
import { requireOwnership, rateLimit, validateEmail, sanitizeInput } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

// Free credits for new users - centralized constant for security
const FREE_CREDITS_FOR_NEW_USERS = 3;

// Rate limiter for sensitive operations
const sensitiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10, // 10 requests per window
});

// Rate limiter for general operations
const generalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 requests per minute
});

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  riot_puuid: string | null;
  riot_game_name: string | null;
  riot_tag_line: string | null;
  riot_region: string | null;
  riot_linked_at: string | null;
  credits: number;
  total_credits_used: number;
  subscription_tier: string;
  subscription_expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

// Create or update user on login
app.post('/auth', async (c) => {
  const body = await c.req.json<{
    id: string;
    email: string;
    name?: string;
    image?: string;
  }>();

  if (!body.id || !body.email) {
    return c.json({ success: false, error: 'Missing required fields: id, email' }, 400);
  }

  const normalizedEmail = body.email.toLowerCase();
  const now = new Date().toISOString();

  try {
    // IMPORTANT: Check by EMAIL first (more reliable than ID for OAuth)
    // This ensures we find existing users even if OAuth generates different IDs
    const existingByEmail = await c.env.DB.prepare(
      'SELECT * FROM users WHERE LOWER(email) = ?'
    ).bind(normalizedEmail).first<User>();

    if (existingByEmail) {
      // User exists - update their info but KEEP their original ID
      // (can't change ID due to foreign key constraints from analyses/recordings tables)
      await c.env.DB.prepare(
        'UPDATE users SET last_login_at = ?, updated_at = ?, name = ?, image = ? WHERE LOWER(email) = ?'
      ).bind(now, now, body.name || existingByEmail.name, body.image || existingByEmail.image, normalizedEmail).run();

      // Return the user with their ORIGINAL database ID
      // The frontend should use this ID for subsequent requests
      return c.json({
        success: true,
        user: existingByEmail, // Use the existing user with their original ID
        isNewUser: false,
        // Tell frontend to use this ID instead of session ID
        useDbId: true,
      });
    }

    // No existing user - create new one with free credits
    await c.env.DB.prepare(`
      INSERT INTO users (id, email, name, image, credits, auth_provider, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'google', ?, ?, ?)
    `).bind(body.id, normalizedEmail, body.name || null, body.image || null, FREE_CREDITS_FOR_NEW_USERS, now, now, now).run();

    const newUser = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(body.id).first<User>();

    return c.json({
      success: true,
      user: newUser,
      isNewUser: true,
    });
  } catch (error: any) {
    console.error('Error creating/updating user:', error);
    console.error('Error details:', error?.message, error?.cause);
    return c.json({
      success: false,
      error: 'Failed to create/update user',
      details: error?.message || String(error)
    }, 500);
  }
});

// Get user by ID
app.get('/:id', async (c) => {
  const userId = c.req.param('id');

  try {
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userId).first<User>();

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Transform snake_case to camelCase for frontend
    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        authProvider: (user as any).auth_provider || 'google',
        riotPuuid: user.riot_puuid,
        riotGameName: user.riot_game_name,
        riotTagLine: user.riot_tag_line,
        riotRegion: user.riot_region,
        credits: user.credits,
        subscriptionTier: user.subscription_tier,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ success: false, error: 'Failed to fetch user' }, 500);
  }
});

// Update user profile - requires ownership
app.put('/:id/profile', requireOwnership, generalRateLimit, async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json<{ name?: string }>();

  try {
    // Sanitize input
    const sanitizedName = body.name ? sanitizeInput(body.name, 100) : null;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      'UPDATE users SET name = ?, updated_at = ? WHERE id = ?'
    ).bind(sanitizedName, now, userId).run();

    return c.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    console.error('Error updating profile:', error);
    return c.json({ success: false, error: 'Failed to update profile' }, 500);
  }
});

// Change password (for credentials users only) - requires ownership + rate limited
app.put('/:id/password', requireOwnership, sensitiveRateLimit, async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json<{ currentPassword: string; newPassword: string }>();

  if (!body.currentPassword || !body.newPassword) {
    return c.json({ success: false, error: 'Current and new password are required' }, 400);
  }

  if (body.newPassword.length < 8) {
    return c.json({ success: false, error: 'New password must be at least 8 characters' }, 400);
  }

  // Password strength validation
  if (!/[A-Z]/.test(body.newPassword) || !/[a-z]/.test(body.newPassword) || !/[0-9]/.test(body.newPassword)) {
    return c.json({ success: false, error: 'Password must contain uppercase, lowercase, and numbers' }, 400);
  }

  try {
    // Get user to verify current password
    const user = await c.env.DB.prepare(
      'SELECT password_hash, auth_provider FROM users WHERE id = ?'
    ).bind(userId).first<{ password_hash: string | null; auth_provider: string }>();

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    if (user.auth_provider === 'google' || !user.password_hash) {
      return c.json({ success: false, error: 'Cannot change password for OAuth users' }, 400);
    }

    // Verify current password
    const encoder = new TextEncoder();
    const currentHashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body.currentPassword));
    const currentHashArray = Array.from(new Uint8Array(currentHashBuffer));
    const currentHash = currentHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (currentHash !== user.password_hash) {
      return c.json({ success: false, error: 'Current password is incorrect' }, 401);
    }

    // Hash new password
    const newHashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body.newPassword));
    const newHashArray = Array.from(new Uint8Array(newHashBuffer));
    const newHash = newHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'
    ).bind(newHash, now, userId).run();

    return c.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    return c.json({ success: false, error: 'Failed to change password' }, 500);
  }
});

// Delete user account - requires ownership + rate limited
app.delete('/:id', requireOwnership, sensitiveRateLimit, async (c) => {
  const userId = c.req.param('id');

  try {
    // Get user's puuid to clean up related data
    const user = await c.env.DB.prepare(
      'SELECT riot_puuid FROM users WHERE id = ?'
    ).bind(userId).first<{ riot_puuid: string | null }>();

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Delete related data in order (foreign key constraints)
    // Delete analyses
    if (user.riot_puuid) {
      await c.env.DB.prepare('DELETE FROM analyses WHERE puuid = ?').bind(user.riot_puuid).run();
      await c.env.DB.prepare('DELETE FROM recordings WHERE puuid = ?').bind(user.riot_puuid).run();
    }

    // Delete user
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

    return c.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    return c.json({ success: false, error: 'Failed to delete account' }, 500);
  }
});

// Link Riot account to user - requires ownership
app.post('/:id/link-riot', requireOwnership, generalRateLimit, async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json<{
    puuid: string;
    gameName: string;
    tagLine: string;
    region: string;
  }>();

  if (!body.puuid || !body.gameName || !body.tagLine || !body.region) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  try {
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      UPDATE users
      SET riot_puuid = ?, riot_game_name = ?, riot_tag_line = ?, riot_region = ?,
          riot_linked_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(body.puuid, body.gameName, body.tagLine, body.region, now, now, userId).run();

    // Update existing analyses and recordings to link to this user
    await c.env.DB.prepare(
      'UPDATE analyses SET user_id = ? WHERE puuid = ? AND user_id IS NULL'
    ).bind(userId, body.puuid).run();

    await c.env.DB.prepare(
      'UPDATE recordings SET user_id = ? WHERE puuid = ? AND user_id IS NULL'
    ).bind(userId, body.puuid).run();

    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userId).first<User>();

    return c.json({ success: true, user });
  } catch (error) {
    console.error('Error linking Riot account:', error);
    return c.json({ success: false, error: 'Failed to link Riot account' }, 500);
  }
});

// Unlink Riot account - requires ownership
app.delete('/:id/link-riot', requireOwnership, generalRateLimit, async (c) => {
  const userId = c.req.param('id');
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(`
      UPDATE users
      SET riot_puuid = NULL, riot_game_name = NULL, riot_tag_line = NULL,
          riot_region = NULL, riot_linked_at = NULL, updated_at = ?
      WHERE id = ?
    `).bind(now, userId).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Error unlinking Riot account:', error);
    return c.json({ success: false, error: 'Failed to unlink Riot account' }, 500);
  }
});

// Get user credits - requires ownership
app.get('/:id/credits', requireOwnership, async (c) => {
  const userId = c.req.param('id');

  try {
    const user = await c.env.DB.prepare(
      'SELECT credits, total_credits_used, subscription_tier FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number; total_credits_used: number; subscription_tier: string }>();

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    return c.json({
      success: true,
      credits: user.credits,
      totalUsed: user.total_credits_used,
      tier: user.subscription_tier,
    });
  } catch (error) {
    console.error('Error fetching credits:', error);
    return c.json({ success: false, error: 'Failed to fetch credits' }, 500);
  }
});

// Use a credit (called when starting an analysis) - requires ownership
app.post('/:id/use-credit', requireOwnership, generalRateLimit, async (c) => {
  const userId = c.req.param('id');

  try {
    const user = await c.env.DB.prepare(
      'SELECT credits, subscription_tier FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number; subscription_tier: string }>();

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Unlimited users don't consume credits
    if (user.subscription_tier === 'unlimited') {
      return c.json({ success: true, creditsRemaining: -1, unlimited: true });
    }

    if (user.credits <= 0) {
      return c.json({ success: false, error: 'No credits remaining' }, 402);
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      UPDATE users
      SET credits = credits - 1, total_credits_used = total_credits_used + 1, updated_at = ?
      WHERE id = ?
    `).bind(now, userId).run();

    return c.json({
      success: true,
      creditsRemaining: user.credits - 1,
      unlimited: false,
    });
  } catch (error) {
    console.error('Error using credit:', error);
    return c.json({ success: false, error: 'Failed to use credit' }, 500);
  }
});

// Add credits (for purchases - would need payment verification in production)
// TODO: This should be called by payment webhook, not directly by users
app.post('/:id/add-credits', sensitiveRateLimit, async (c) => {
  const userId = c.req.param('id');
  const body = await c.req.json<{ amount: number; transactionId?: string }>();

  if (!body.amount || body.amount <= 0) {
    return c.json({ success: false, error: 'Invalid credit amount' }, 400);
  }

  try {
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?
    `).bind(body.amount, now, userId).run();

    const user = await c.env.DB.prepare(
      'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number }>();

    return c.json({
      success: true,
      creditsAdded: body.amount,
      totalCredits: user?.credits || 0,
    });
  } catch (error) {
    console.error('Error adding credits:', error);
    return c.json({ success: false, error: 'Failed to add credits' }, 500);
  }
});

export default app;
