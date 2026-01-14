import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env, AnalysisJob } from './types';
import analysisRoutes from './routes/analysis';
import recordingsRoutes from './routes/recordings';
import visionRoutes from './routes/vision';
import { processAnalysisJob } from './services/analyzer';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin, c) => {
    const allowedOrigins = [
      c.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    if (allowedOrigins.includes(origin) || c.env.ENVIRONMENT === 'development') {
      return origin;
    }
    return allowedOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Health check
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'Nexra API is running',
    version: '1.0.0',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.route('/analysis', analysisRoutes);
app.route('/recordings', recordingsRoutes);
app.route('/vision', visionRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ success: false, error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,

  // Queue consumer for async analysis processing
  async queue(batch: MessageBatch<AnalysisJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processAnalysisJob(message.body, env);
        message.ack();
      } catch (error) {
        console.error('Failed to process analysis job:', error);
        message.retry();
      }
    }
  },
};
