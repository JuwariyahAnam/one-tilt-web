// Run with: npm test   (Node 20+, no AWS account or API keys needed)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/handler.mjs';
import { setBedrockClient, ruleCommand } from '../src/ai.mjs';
import { setClients } from '../src/aws.mjs';

const call = async (method, path, body, headers = {}) => {
  const res = await handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers,
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: method === 'GET' && body ? body : {},
  });
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
};

const ELEMENTS = [
  { id: 0, kind: 'search', label: 'Search YouTube by voice' },
  { id: 1, kind: 'link', label: 'Lofi beats to relax' },
  { id: 2, kind: 'link', label: 'Arijit Singh live concert' },
  { id: 3, kind: 'link', label: 'Privacy policy' },
];

beforeEach(() => {
  for (const k of ['API_KEY', 'ELEVENLABS_API_KEY', 'HELP_TOPIC_ARN', 'HELP_PHONE', 'SETTINGS_TABLE', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_LAMBDA_FUNCTION_NAME']) delete process.env[k];
  process.env.AI_MODE = 'off';
  setBedrockClient(undefined);
});

test('health reports what is configured', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.elevenlabs, 'not set');
  assert.equal(r.headers['access-control-allow-origin'], '*');
});

test('CORS preflight is answered', async () => {
  const r = await handler({ rawPath: '/choices', requestContext: { http: { method: 'OPTIONS' } } });
  assert.equal(r.statusCode, 204);
});

test('API key is enforced when set', async () => {
  process.env.API_KEY = 'secret-key-123456';
  assert.equal((await call('GET', '/health')).status, 401);
  assert.equal((await call('GET', '/health', null, { 'X-Api-Key': 'secret-key-123456' })).status, 200);
});

test('unknown route is 404 and bad JSON is 400', async () => {
  assert.equal((await call('GET', '/nope')).status, 404);
  const r = await handler({ rawPath: '/choices', requestContext: { http: { method: 'POST' } }, body: '{not json' });
  assert.equal(r.statusCode, 400);
});

test('choices fall back to on-device order without Bedrock', async () => {
  const r = await call('POST', '/choices', { url: 'https://youtube.com', title: 'YouTube', elements: ELEMENTS });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  assert.deepEqual(r.body.choices.map((c) => c.id), [0, 1, 2]);
});

test('choices use Bedrock tool output and drop invented ids', async () => {
  let seen;
  setBedrockClient({
    send: async (input) => {
      seen = input;
      return { output: { message: { content: [{ toolUse: { name: 'present_choices', input: { summary: 'YouTube home', choices: [{ id: 2, label: 'Play: Arijit live' }, { id: 99, label: 'Fake' }, { id: 0, label: 'Search YouTube' }] } } }] } } };
    },
  });
  const r = await call('POST', '/choices', { url: 'https://youtube.com', title: 'YouTube', elements: ELEMENTS, lang: 'en-IN' });
  assert.equal(r.body.source, 'bedrock');
  assert.deepEqual(r.body.choices, [{ id: 2, label: 'Play: Arijit live' }, { id: 0, label: 'Search YouTube' }]);
  assert.equal(seen.toolConfig.toolChoice.tool.name, 'present_choices');
});

test('Bedrock failure falls back instead of erroring', async () => {
  setBedrockClient({ send: async () => { const e = new Error('throttled'); e.name = 'ThrottlingException'; throw e; } });
  const r = await call('POST', '/choices', { elements: ELEMENTS });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  assert.equal(r.body.error, 'ThrottlingException');
});

test('spoken commands: rules understand English and Hindi', () => {
  assert.deepEqual(ruleCommand('play arijit singh songs', ELEMENTS).action, { type: 'search', text: 'arijit singh songs', youtube: true, play: true });
  assert.equal(ruleCommand('arijit singh ke gaane bajao', ELEMENTS).action.text, 'arijit singh');
  assert.equal(ruleCommand('neeche', ELEMENTS).action.type, 'scroll_down');
  assert.deepEqual(ruleCommand('open lofi beats', ELEMENTS).action, { type: 'click', id: 1 });
  assert.equal(ruleCommand('make me a sandwich', ELEMENTS).action.type, 'none');
});

test('command endpoint uses Bedrock and validates element ids', async () => {
  setBedrockClient({ send: async () => ({ output: { message: { content: [{ toolUse: { input: { reply: 'Opening', action: { type: 'click', id: 42 } } } }] } } }) });
  const bad = await call('POST', '/command', { command: 'open the concert', elements: ELEMENTS });
  assert.equal(bad.body.source, 'rules');                 // invented id rejected
  assert.deepEqual(bad.body.action, { type: 'click', id: 2 });
  assert.equal((await call('POST', '/command', {})).status, 400);
});

test('speak needs an ElevenLabs key, then returns MP3 audio', async () => {
  assert.equal((await call('POST', '/speak', { text: 'Hello' })).status, 503);
  process.env.ELEVENLABS_API_KEY = 'test';
  const realFetch = globalThis.fetch;
  let url;
  globalThis.fetch = async (u, opts) => { url = u; assert.equal(opts.headers['xi-api-key'], 'test'); return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
  try {
    const r = await call('POST', '/speak', { text: 'I need water', voiceId: 'myvoice' });
    assert.equal(r.status, 200);
    assert.equal(r.body.audio, Buffer.from([1, 2, 3]).toString('base64'));
    assert.match(url, /text-to-speech\/myvoice/);
  } finally { globalThis.fetch = realFetch; }
});

test('transcribe sends audio to Scribe', async () => {
  process.env.ELEVENLABS_API_KEY = 'test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, opts) => {
    assert.match(u, /speech-to-text/);
    assert.equal(opts.body.get('model_id'), 'scribe_v1');
    return new Response(JSON.stringify({ text: ' scroll down ', language_code: 'en' }), { status: 200 });
  };
  try {
    const r = await call('POST', '/transcribe', { audio: Buffer.from('abc').toString('base64'), mime: 'audio/webm' });
    assert.deepEqual(r.body, { text: 'scroll down', language: 'en' });
  } finally { globalThis.fetch = realFetch; }
});

test('help alert: 503 until SNS is set up, then texts once per minute', async () => {
  assert.equal((await call('POST', '/help', { userId: 'u1' })).status, 503);
  process.env.HELP_TOPIC_ARN = 'arn:aws:sns:ap-south-1:1:OneTilt';
  const sent = [];
  setClients({ sns: { publish: async (input) => { sent.push(input); return { MessageId: 'm-1' }; } } });
  const r1 = await call('POST', '/help', { userId: 'u-help', title: 'City Care Clinic' });
  const r2 = await call('POST', '/help', { userId: 'u-help' });
  assert.equal(r1.body.messageId, 'm-1');
  assert.equal(r2.body.deduplicated, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].Message, /HELP ALERT/);
});

test('settings round-trip (memory store locally)', async () => {
  const put = await call('PUT', '/settings', { userId: 'u2', settings: { lang: 'hi-IN', evil: 'x' } });
  assert.deepEqual(put.body.settings, { lang: 'hi-IN' });
  const get = await call('GET', '/settings', { userId: 'u2' });
  assert.equal(get.body.settings.lang, 'hi-IN');
});
