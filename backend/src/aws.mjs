// Amazon SNS (help alert texts) and Amazon DynamoDB (per-user settings).
// AWS SDK v3 ships with the Lambda Node.js runtime; locally these fall back gracefully.
import { HttpError, str } from './http.mjs';

const lastAlert = new Map(); // userId -> timestamp, stops repeated texts
const memoryStore = new Map();

export const snsConfigured = () => Boolean(process.env.HELP_TOPIC_ARN || process.env.HELP_PHONE);
export const dbConfigured = () => Boolean(process.env.SETTINGS_TABLE);

let sns;
let db;
export function setClients(c) { sns = c.sns; db = c.db; } // for tests

async function snsClient() {
  if (sns) return sns;
  const m = await import('@aws-sdk/client-sns');
  const c = new m.SNSClient({});
  sns = { publish: (input) => c.send(new m.PublishCommand(input)) };
  return sns;
}

async function dbClient() {
  if (db) return db;
  const m = await import('@aws-sdk/client-dynamodb');
  const c = new m.DynamoDBClient({});
  db = {
    get: (input) => c.send(new m.GetItemCommand(input)),
    put: (input) => c.send(new m.PutItemCommand(input)),
  };
  return db;
}

export async function sendHelp(body) {
  if (!snsConfigured()) throw new HttpError(503, 'Text alerts are not set up yet (HELP_TOPIC_ARN).');
  const userId = str(body.userId, 40) || 'unknown';
  const now = Date.now();
  if (now - (lastAlert.get(userId) || 0) < 60_000) return { sent: true, deduplicated: true };
  lastAlert.set(userId, now);

  const time = new Date(now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const title = str(body.title, 80);
  const message = `One-Tilt HELP ALERT: the user needs help now (${time} IST).${title ? ` They were on: ${title}.` : ''} Please check on them.`;
  const input = process.env.HELP_TOPIC_ARN
    ? { TopicArn: process.env.HELP_TOPIC_ARN, Message: message, Subject: 'One-Tilt help alert' }
    : { PhoneNumber: process.env.HELP_PHONE, Message: message };
  const c = await snsClient();
  const out = await c.publish(input);
  return { sent: true, messageId: out && out.MessageId };
}

const ALLOWED = ['lang', 'readAloud', 'voiceOutput', 'speechInput', 'contactName', 'helpCountdown', 'phrases', 'cloneVoiceId', 'tiltDeg', 'nodDeg', 'lookDeg'];

export async function getSettings(userId) {
  const id = str(userId, 40);
  if (!id) throw new HttpError(400, 'userId is required');
  if (!dbConfigured()) return { userId: id, settings: memoryStore.get(id) || {} };
  const c = await dbClient();
  const out = await c.get({ TableName: process.env.SETTINGS_TABLE, Key: { userId: { S: id } } });
  const raw = out && out.Item && out.Item.data && out.Item.data.S;
  return { userId: id, settings: raw ? JSON.parse(raw) : {} };
}

export async function putSettings(body) {
  const id = str(body.userId, 40);
  if (!id) throw new HttpError(400, 'userId is required');
  const settings = {};
  for (const k of ALLOWED) if (body.settings && body.settings[k] !== undefined) settings[k] = body.settings[k];
  const data = JSON.stringify(settings);
  if (data.length > 20_000) throw new HttpError(413, 'settings too large');
  if (!dbConfigured()) { memoryStore.set(id, settings); return { userId: id, settings, stored: 'memory' }; }
  const c = await dbClient();
  await c.put({ TableName: process.env.SETTINGS_TABLE, Item: { userId: { S: id }, data: { S: data }, updatedAt: { S: new Date().toISOString() } } });
  return { userId: id, settings, stored: 'dynamodb' };
}
