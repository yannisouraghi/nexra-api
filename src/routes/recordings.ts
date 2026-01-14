import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env, Recording, ApiResponse } from '../types';
import { generateId } from '../utils/helpers';

const app = new Hono<{ Bindings: Env }>();

// GET /recordings - List all recordings for a user with analysis status
app.get('/', async (c) => {
  const puuid = c.req.query('puuid');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  if (!puuid) {
    return c.json<ApiResponse>({ success: false, error: 'puuid is required' }, 400);
  }

  try {
    // Get recordings with their analysis status (LEFT JOIN to include recordings without analysis)
    const result = await c.env.DB.prepare(`
      SELECT
        r.id as recording_id,
        r.match_id,
        r.puuid,
        r.region,
        r.video_key,
        r.duration as recording_duration,
        r.file_size,
        r.created_at as recording_created_at,
        r.uploaded_at,
        a.id as analysis_id,
        a.status as analysis_status,
        a.progress as analysis_progress,
        a.progress_message,
        a.champion,
        a.result,
        a.duration as game_duration,
        a.game_mode,
        a.kills,
        a.deaths,
        a.assists,
        a.role,
        a.stats,
        a.created_at as analysis_created_at,
        a.completed_at,
        a.error_message
      FROM recordings r
      LEFT JOIN analyses a ON r.match_id = a.match_id
      WHERE r.puuid = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(puuid, limit, offset).all();

    const recordings = result.results.map((row: Record<string, unknown>) => {
      // Parse stats if available
      let overallScore = 0;
      let errorsCount = 0;
      if (row.stats && typeof row.stats === 'string') {
        try {
          const stats = JSON.parse(row.stats);
          overallScore = stats.overallScore || 0;
          errorsCount = stats.errorsFound || 0;
        } catch { /* ignore */ }
      }

      // Calculate progress with fallback
      const status = row.analysis_status as string;
      const progress = row.analysis_progress ?? (status === 'completed' ? 100 : status === 'processing' ? 0 : null);

      return {
        recordingId: row.recording_id,
        matchId: row.match_id,
        puuid: row.puuid,
        region: row.region,
        videoKey: row.video_key,
        recordingDuration: row.recording_duration,
        fileSize: row.file_size,
        recordingCreatedAt: row.recording_created_at,
        uploadedAt: row.uploaded_at,
        // Analysis info (null if no analysis exists)
        analysisId: row.analysis_id || null,
        analysisStatus: row.analysis_status || 'not_started',
        progress,
        progressMessage: row.progress_message || null,
        champion: row.champion || null,
        result: row.result || null,
        gameDuration: row.game_duration || null,
        gameMode: row.game_mode || null,
        kills: row.kills || 0,
        deaths: row.deaths || 0,
        assists: row.assists || 0,
        role: row.role || null,
        overallScore,
        errorsCount,
        analysisCreatedAt: row.analysis_created_at || null,
        completedAt: row.completed_at || null,
        errorMessage: row.error_message || null,
      };
    });

    return c.json<ApiResponse>({
      success: true,
      data: recordings,
    });
  } catch (error) {
    console.error('Failed to fetch recordings:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch recordings' }, 500);
  }
});

// Schema for creating recording metadata
const createRecordingSchema = z.object({
  matchId: z.string().min(1),
  puuid: z.string().min(1),
  region: z.string().min(1),
  duration: z.number().optional(),
  fileSize: z.number().optional(),
});

// GET /recordings/check/:matchId - Check if recording exists
app.get('/check/:matchId', async (c) => {
  const matchId = c.req.param('matchId');

  try {
    const recording = await c.env.DB.prepare(`
      SELECT id FROM recordings WHERE match_id = ?
    `).bind(matchId).first<{ id: string }>();

    return c.json<ApiResponse<{ exists: boolean }>>({
      success: true,
      data: { exists: !!recording },
    });
  } catch (error) {
    console.error('Failed to check recording:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to check recording' }, 500);
  }
});

// GET /recordings/:matchId - Get recording metadata
app.get('/:matchId', async (c) => {
  const matchId = c.req.param('matchId');

  try {
    const recording = await c.env.DB.prepare(`
      SELECT * FROM recordings WHERE match_id = ?
    `).bind(matchId).first<Recording>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    return c.json<ApiResponse<Recording>>({
      success: true,
      data: recording,
    });
  } catch (error) {
    console.error('Failed to fetch recording:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch recording' }, 500);
  }
});

// POST /recordings/upload-url - Get presigned URL for upload
app.post('/upload-url', zValidator('json', createRecordingSchema), async (c) => {
  const { matchId, puuid, region, duration, fileSize } = c.req.valid('json');

  try {
    // Check if recording already exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM recordings WHERE match_id = ?
    `).bind(matchId).first<{ id: string }>();

    if (existing) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Recording already exists for this match',
      }, 409);
    }

    // Generate unique video key (webm format from Electron recorder)
    const recordingId = generateId();
    const videoKey = `recordings/${puuid}/${matchId}/${recordingId}.webm`;

    // Create recording record (pending upload)
    await c.env.DB.prepare(`
      INSERT INTO recordings (id, match_id, puuid, region, video_key, duration, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(recordingId, matchId, puuid, region, videoKey, duration || null, fileSize || null).run();

    // For R2, we'll use a direct upload approach
    // The client will upload directly to this endpoint
    return c.json<ApiResponse>({
      success: true,
      data: {
        recordingId,
        uploadUrl: `/recordings/${recordingId}/upload`,
        videoKey,
      },
    });
  } catch (error) {
    console.error('Failed to create upload URL:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to create upload URL' }, 500);
  }
});

// PUT /recordings/:id/upload - Upload video directly
app.put('/:id/upload', async (c) => {
  const id = c.req.param('id');

  try {
    // Get recording metadata (use snake_case column names from D1)
    const recording = await c.env.DB.prepare(`
      SELECT id, match_id, puuid, region, video_key, duration, file_size FROM recordings WHERE id = ?
    `).bind(id).first<{ id: string; match_id: string; puuid: string; region: string; video_key: string; duration: number | null; file_size: number | null }>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    // Get the video data from request body
    const videoData = await c.req.arrayBuffer();

    if (!videoData || videoData.byteLength === 0) {
      return c.json<ApiResponse>({ success: false, error: 'No video data provided' }, 400);
    }

    // Upload to R2 (webm format from Electron recorder)
    console.log(`Uploading to R2: ${recording.video_key} (${videoData.byteLength} bytes)`);

    try {
      await c.env.VIDEOS.put(recording.video_key, videoData, {
        httpMetadata: {
          contentType: 'video/webm',
        },
        customMetadata: {
          matchId: recording.match_id,
          puuid: recording.puuid,
          recordingId: id,
        },
      });
      console.log(`R2 upload successful: ${recording.video_key}`);
    } catch (r2Error) {
      console.error('R2 upload failed:', r2Error);
      throw r2Error;
    }

    // Verify upload by checking if file exists in R2
    const verifyObject = await c.env.VIDEOS.head(recording.video_key);
    if (!verifyObject) {
      console.error('R2 upload verification failed - object not found after upload');
      return c.json<ApiResponse>({ success: false, error: 'Upload verification failed' }, 500);
    }
    console.log(`R2 upload verified: size=${verifyObject.size}`);

    // Update recording with upload timestamp
    await c.env.DB.prepare(`
      UPDATE recordings
      SET uploaded_at = datetime('now'), file_size = ?
      WHERE id = ?
    `).bind(videoData.byteLength, id).run();

    return c.json<ApiResponse>({
      success: true,
      data: { recordingId: id, uploaded: true },
    });
  } catch (error) {
    console.error('Failed to upload video:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to upload video' }, 500);
  }
});

// GET /recordings/:id/video - Stream video (for analysis page) with Range support
app.get('/:id/video', async (c) => {
  const id = c.req.param('id');

  try {
    const recording = await c.env.DB.prepare(`
      SELECT video_key, file_size FROM recordings WHERE id = ? OR match_id = ?
    `).bind(id, id).first<{ video_key: string; file_size: number | null }>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    // Get range header for partial content
    const rangeHeader = c.req.header('Range');

    // Determine content type
    const isWebm = recording.video_key.endsWith('.webm');
    const contentType = isWebm ? 'video/webm' : 'video/mp4';

    // Get video from R2
    const video = await c.env.VIDEOS.get(recording.video_key);

    if (!video) {
      return c.json<ApiResponse>({ success: false, error: 'Video file not found' }, 404);
    }

    const fileSize = recording.file_size || video.size;

    // Handle range requests for video seeking
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      // Get partial content from R2
      const partialVideo = await c.env.VIDEOS.get(recording.video_key, {
        range: { offset: start, length: chunkSize },
      });

      if (!partialVideo) {
        return c.json<ApiResponse>({ success: false, error: 'Failed to get video range' }, 500);
      }

      return new Response(partialVideo.body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Full video response
    return new Response(video.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Failed to stream video:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to stream video' }, 500);
  }
});

// POST /recordings/:id/clips - Upload a video clip with frames for AI analysis
app.post('/:id/clips', async (c) => {
  const id = c.req.param('id');

  try {
    // Verify recording exists
    const recording = await c.env.DB.prepare(`
      SELECT id, match_id, puuid FROM recordings WHERE id = ?
    `).bind(id).first<{ id: string; match_id: string; puuid: string }>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    const body = await c.req.json() as {
      index: number;
      type: string;
      description: string;
      startTime: number;
      endTime: number;
      severity: string;
      frames: Array<{ timestamp: number; data: string }>;
    };

    const { index, type, description, startTime, endTime, severity, frames } = body;

    // Generate clip ID
    const clipId = `clip-${recording.match_id}-${index}`;

    // Store frames in R2
    const storedFrames: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame?.data) {
        const frameKey = `clips/${recording.puuid}/${recording.match_id}/${clipId}/frame_${i}.jpg`;

        // Decode base64 without Node.js Buffer (Cloudflare Workers compatible)
        const binaryString = atob(frame.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }

        await c.env.VIDEOS.put(frameKey, bytes, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: {
            clipId,
            timestamp: frame.timestamp.toString(),
          },
        });

        storedFrames.push(frameKey);
      }
    }

    // Store clip metadata in database (we'll create a clips table or use JSON in analysis)
    // For now, store in a clips JSON field in recordings
    const existingClips = await c.env.DB.prepare(`
      SELECT clips FROM recordings WHERE id = ?
    `).bind(id).first<{ clips: string | null }>();

    const clipsArray = existingClips?.clips ? JSON.parse(existingClips.clips) : [];
    clipsArray.push({
      id: clipId,
      index,
      type,
      description,
      startTime,
      endTime,
      severity,
      frameKeys: storedFrames,
      frameCount: storedFrames.length,
    });

    await c.env.DB.prepare(`
      UPDATE recordings SET clips = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(JSON.stringify(clipsArray), id).run();

    console.log(`Clip ${clipId} stored with ${storedFrames.length} frames`);

    return c.json<ApiResponse>({
      success: true,
      data: { clipId, frameCount: storedFrames.length },
    });
  } catch (error) {
    console.error('Failed to upload clip:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to upload clip' }, 500);
  }
});

// GET /recordings/:id/clips/:clipIndex/frames - Get frames for a clip
app.get('/:id/clips/:clipIndex/frames', async (c) => {
  const id = c.req.param('id');
  const clipIndex = parseInt(c.req.param('clipIndex'));

  try {
    const recording = await c.env.DB.prepare(`
      SELECT clips, match_id, puuid FROM recordings WHERE id = ? OR match_id = ?
    `).bind(id, id).first<{ clips: string | null; match_id: string; puuid: string }>();

    if (!recording || !recording.clips) {
      return c.json<ApiResponse>({ success: false, error: 'Clips not found' }, 404);
    }

    const clipsArray = JSON.parse(recording.clips);
    const clip = clipsArray.find((c: { index: number }) => c.index === clipIndex);

    if (!clip) {
      return c.json<ApiResponse>({ success: false, error: 'Clip not found' }, 404);
    }

    // Get frame URLs
    const frameUrls = clip.frameKeys.map((key: string, i: number) => ({
      index: i,
      url: `/recordings/${id}/frame/${clipIndex}/${i}`,
    }));

    return c.json<ApiResponse>({
      success: true,
      data: {
        clip,
        frames: frameUrls,
      },
    });
  } catch (error) {
    console.error('Failed to get clip frames:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to get frames' }, 500);
  }
});

// GET /recordings/:id/frame/:clipIndex/:frameIndex - Get a specific frame image
app.get('/:id/frame/:clipIndex/:frameIndex', async (c) => {
  const id = c.req.param('id');
  const clipIndex = parseInt(c.req.param('clipIndex'));
  const frameIndex = parseInt(c.req.param('frameIndex'));

  try {
    const recording = await c.env.DB.prepare(`
      SELECT clips, match_id, puuid FROM recordings WHERE id = ? OR match_id = ?
    `).bind(id, id).first<{ clips: string | null; match_id: string; puuid: string }>();

    if (!recording || !recording.clips) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    const clipsArray = JSON.parse(recording.clips);
    const clip = clipsArray.find((c: { index: number }) => c.index === clipIndex);

    if (!clip || !clip.frameKeys[frameIndex]) {
      return c.json<ApiResponse>({ success: false, error: 'Frame not found' }, 404);
    }

    const frameKey = clip.frameKeys[frameIndex];
    const frame = await c.env.VIDEOS.get(frameKey);

    if (!frame) {
      return c.json<ApiResponse>({ success: false, error: 'Frame file not found' }, 404);
    }

    return new Response(frame.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Failed to get frame:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to get frame' }, 500);
  }
});

// DELETE /recordings/:matchId - Delete recording
app.delete('/:matchId', async (c) => {
  const matchId = c.req.param('matchId');

  try {
    const recording = await c.env.DB.prepare(`
      SELECT id, video_key FROM recordings WHERE match_id = ?
    `).bind(matchId).first<{ id: string; video_key: string }>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    // Delete from R2
    await c.env.VIDEOS.delete(recording.video_key);

    // Delete from database
    await c.env.DB.prepare(`
      DELETE FROM recordings WHERE id = ?
    `).bind(recording.id).run();

    return c.json<ApiResponse>({ success: true });
  } catch (error) {
    console.error('Failed to delete recording:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete recording' }, 500);
  }
});

export default app;
