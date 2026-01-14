import { Hono } from 'hono';
import { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

// Heartbeat TTL in seconds (consider offline after this)
const HEARTBEAT_TTL = 60;

// POST /vision/heartbeat - Nexra Vision sends heartbeat
app.post('/heartbeat', async (c) => {
  try {
    const body = await c.req.json();
    const { puuid, version } = body;

    if (!puuid) {
      return c.json({ success: false, error: 'PUUID is required' }, 400);
    }

    // Store heartbeat in KV with TTL
    const heartbeatData = {
      lastSeen: Date.now(),
      version: version || 'unknown',
    };

    await c.env.CACHE.put(
      `vision:heartbeat:${puuid}`,
      JSON.stringify(heartbeatData),
      { expirationTtl: HEARTBEAT_TTL }
    );

    return c.json({ success: true, message: 'Heartbeat received' });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }
});

// GET /vision/status/:puuid - Check if Nexra Vision is online for a user
app.get('/status/:puuid', async (c) => {
  try {
    const puuid = c.req.param('puuid');

    if (!puuid) {
      return c.json({ success: false, error: 'PUUID is required' }, 400);
    }

    const heartbeatStr = await c.env.CACHE.get(`vision:heartbeat:${puuid}`);

    if (!heartbeatStr) {
      return c.json({
        success: true,
        online: false,
        message: 'No heartbeat found',
      });
    }

    const heartbeat = JSON.parse(heartbeatStr);
    const now = Date.now();
    const lastSeen = heartbeat.lastSeen;
    const isOnline = (now - lastSeen) < (HEARTBEAT_TTL * 1000);

    return c.json({
      success: true,
      online: isOnline,
      lastSeen: lastSeen,
      version: heartbeat.version,
      secondsAgo: Math.floor((now - lastSeen) / 1000),
    });
  } catch (error) {
    console.error('Status check error:', error);
    return c.json({ success: false, error: 'Failed to check status' }, 500);
  }
});

export default app;
