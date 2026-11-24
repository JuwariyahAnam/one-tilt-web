// ElevenLabs: natural speech (TTS), speech-to-text (Scribe) and instant voice cloning.
import { HttpError, requireString, str } from './http.mjs';

const BASE = 'https://api.elevenlabs.io/v1';
const key = () => process.env.ELEVENLABS_API_KEY || '';
export const elevenConfigured = () => Boolean(key());

function need() {
  if (!key()) throw new HttpError(503, 'ElevenLabs is not set up (ELEVENLABS_API_KEY)');
}

async function check(res) {
  if (res.ok) return res;
  let detail = '';
  try { const j = await res.json(); detail = (j.detail && (j.detail.message || j.detail.status)) || JSON.stringify(j).slice(0, 160); } catch (e) { /* ignore */ }
  throw new HttpError(res.status === 401 ? 502 : res.status >= 500 ? 502 : 400, `ElevenLabs error ${res.status}${detail ? ': ' + detail : ''}`);
}

// Text to speech. Returns base64 MP3.
export async function speak(body) {
  need();
  const text = requireString(body.text, 'text', 1000);
  const voice = str(body.voiceId, 64) || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const lang = String(body.lang || '').startsWith('hi') ? 'hi' : 'en';
  const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
      language_code: lang,
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });
  await check(res);
  const audio = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { mime: 'audio/mpeg', audio };
}

// Speech to text with Scribe. Takes base64 audio.
export async function transcribe(body) {
  need();
  const b64 = requireString(body.audio, 'audio', 8_000_000);
  const form = new FormData();
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: str(body.mime, 40) || 'audio/webm' }), 'command.webm');
  if (body.lang) form.append('language_code', String(body.lang).startsWith('hi') ? 'hi' : 'en');
  form.append('tag_audio_events', 'false');
  const res = await fetch(`${BASE}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key() }, body: form });
  await check(res);
  const data = await res.json();
  return { text: (data.text || '').trim(), language: data.language_code || '' };
}

// Instant voice cloning for "Speak for me" in the user's own voice.
export async function cloneVoice(body) {
  need();
  const files = Array.isArray(body.files) ? body.files.slice(0, 3) : [];
  if (!files.length) throw new HttpError(400, 'files are required');
  const form = new FormData();
  form.append('name', str(body.name, 60) || 'One-Tilt user');
  form.append('description', 'Created with One-Tilt Web so the user can speak in their own voice.');
  form.append('remove_background_noise', 'true');
  files.forEach((f, i) => {
    const data = requireString(f.data, `files[${i}].data`, 15_000_000);
    form.append('files', new Blob([Buffer.from(data, 'base64')], { type: str(f.mime, 40) || 'audio/mpeg' }), str(f.name, 80) || `sample${i + 1}.mp3`);
  });
  const res = await fetch(`${BASE}/voices/add`, { method: 'POST', headers: { 'xi-api-key': key() }, body: form });
  await check(res);
  const data = await res.json();
  return { voiceId: data.voice_id };
}
