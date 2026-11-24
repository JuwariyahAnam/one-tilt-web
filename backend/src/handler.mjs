// One-Tilt Web backend - one AWS Lambda behind Amazon API Gateway (HTTP API).
//
//   GET  /health           what is configured
//   POST /choices          Amazon Bedrock picks the best 3 choices on a page
//   POST /command          Amazon Bedrock turns a spoken command into one action
//   POST /speak            ElevenLabs text to speech (natural or cloned voice)
//   POST /transcribe       ElevenLabs Scribe speech to text
//   POST /voice/clone      ElevenLabs instant voice cloning ("Speak for me")
//   POST /help             Amazon SNS text message to the family
//   GET/PUT /settings      Amazon DynamoDB per-user settings
import { json, HttpError, CORS } from './http.mjs';
import { rankChoices, interpretCommand, bedrockConfigured } from './ai.mjs';
import { speak, transcribe, cloneVoice, elevenConfigured } from './elevenlabs.mjs';
import { sendHelp, getSettings, putSettings, snsConfigured, dbConfigured } from './aws.mjs';

export const VERSION = '0.1.0';

const routes = {
  'GET /health': async () => ({
    ok: true,
    version: VERSION,
    bedrock: bedrockConfigured() ? `ready (${process.env.BEDROCK_MODEL_ID || 'claude-3-haiku'})` : 'rules only (no AWS credentials)',
    elevenlabs: elevenConfigured() ? 'ready' : 'not set',
    sns: snsConfigured() ? 'ready' : 'not set',
    dynamodb: dbConfigured() ? 'ready' : 'in memory',
  }),
  'POST /choices': (b) => rankChoices(b),
  'POST /command': (b) => interpretCommand(b),
  'POST /speak': (b) => speak(b),
  'POST /transcribe': (b) => transcribe(b),
  'POST /voice/clone': async (b) => {
    const out = await cloneVoice(b);
    if (b.userId) {
      const cur = await getSettings(b.userId).catch(() => ({ settings: {} }));
      await putSettings({ userId: b.userId, settings: Object.assign({}, cur.settings, { cloneVoiceId: out.voiceId }) }).catch(() => {});
    }
    return out;
  },
  'POST /help': (b) => sendHelp(b),
  'GET /settings': (b, q) => getSettings(q.userId),
  'PUT /settings': (b) => putSettings(b),
};

export async function handler(event) {
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod || 'GET';
  const path = (event.rawPath || event.path || '/').replace(/\/+$/, '') || '/';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (process.env.API_KEY && headers['x-api-key'] !== process.env.API_KEY) return json(401, { error: 'Wrong or missing API key' });

  const route = routes[`${method} ${path}`];
  if (!route) return json(404, { error: `No route ${method} ${path}` });

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch (e) {
      return json(400, { error: 'Body must be JSON' });
    }
  }
  try {
    return json(200, await route(body || {}, event.queryStringParameters || {}));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Something went wrong' });
  }
}
