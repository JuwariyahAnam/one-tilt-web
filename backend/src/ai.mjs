// Amazon Bedrock: pick the best choices on a page, and turn a spoken command into one action.
// Uses the Converse API with a forced tool call so the model always returns valid JSON.
// Without AWS credentials (local dev) it falls back to simple on-server rules.
import { cleanElements, str, requireString } from './http.mjs';

const MODEL_ID = () => process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

let client; // undefined = not tried yet, null = unavailable
export function setBedrockClient(c) { client = c; } // for tests

export function bedrockConfigured() {
  if (process.env.AI_MODE === 'off') return false;
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || client);
}

async function getClient() {
  if (client !== undefined) return client;
  if (!bedrockConfigured()) { client = null; return null; }
  try {
    const sdk = await import('@aws-sdk/client-bedrock-runtime');
    const c = new sdk.BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-1' });
    client = { send: (input) => c.send(new sdk.ConverseCommand(input)) };
  } catch (e) {
    client = null;
  }
  return client;
}

async function callTool(system, user, tool) {
  const c = await getClient();
  if (!c) return null;
  const out = await c.send({
    modelId: MODEL_ID(),
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    toolConfig: { tools: [{ toolSpec: tool }], toolChoice: { tool: { name: tool.name } } },
    inferenceConfig: { maxTokens: 500, temperature: 0.2 },
  });
  const blocks = (out && out.output && out.output.message && out.output.message.content) || [];
  const use = blocks.find((b) => b.toolUse);
  return use ? use.toolUse.input : null;
}

const langName = (lang) => (String(lang || '').startsWith('hi') ? 'Hindi (Devanagari script)' : 'simple English');

// ---------- choices ----------
const CHOICES_TOOL = {
  name: 'present_choices',
  description: 'Show the user the best next actions on this page.',
  inputSchema: {
    json: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What this page is, in at most 8 words' },
        choices: {
          type: 'array', maxItems: 3,
          items: {
            type: 'object',
            properties: { id: { type: 'integer' }, label: { type: 'string', description: 'Short label, at most 5 words' } },
            required: ['id', 'label'],
          },
        },
      },
      required: ['summary', 'choices'],
    },
  },
};

export async function rankChoices(body) {
  const elements = cleanElements(body.elements);
  const page = { url: str(body.url, 300), title: str(body.title, 200) };
  if (!elements.length) return { source: 'none', summary: page.title, choices: [] };

  let result = null;
  let error = null;
  try {
    result = await callTool(
      'You help a person with severe motor disabilities use websites. They can only pick from 4 big buttons at a time, so every choice must matter. ' +
        'From the page elements given, pick the 3 most useful next actions for a typical person on this page. ' +
        'Prefer main content (videos, articles, search, form fields in order, the main button) over menus, ads, settings, sign-in and legal links. ' +
        `Write each label in ${langName(body.lang)}, at most 5 words, starting with a verb when it helps (e.g. "Play: Lofi beats", "Search YouTube"). ` +
        'Only use ids from the list.',
      JSON.stringify({ page, elements }),
      CHOICES_TOOL,
    );
  } catch (e) {
    error = e.name || 'BedrockError';
  }

  if (result && Array.isArray(result.choices)) {
    const ids = new Set(elements.map((e) => e.id));
    const choices = result.choices
      .filter((c) => c && ids.has(c.id))
      .slice(0, 3)
      .map((c) => ({ id: c.id, label: str(c.label, 60) || elements.find((e) => e.id === c.id).label }));
    if (choices.length) return { source: 'bedrock', model: MODEL_ID(), summary: str(result.summary, 80) || page.title, choices };
  }
  // Fallback: the device already ranked them, keep its top three.
  return {
    source: 'rules', error,
    summary: page.title,
    choices: elements.filter((e) => e.kind !== 'util').slice(0, 3).map((e) => ({ id: e.id, label: e.label })),
  };
}

// ---------- spoken command ----------
const ACTION_TOOL = {
  name: 'do_action',
  description: 'Do exactly one browser action for the user.',
  inputSchema: {
    json: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Short spoken confirmation, at most 8 words' },
        action: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['click', 'type', 'search', 'scroll_down', 'scroll_up', 'back', 'say', 'none'] },
            id: { type: 'integer', description: 'Element id for click/type' },
            text: { type: 'string', description: 'Text to type, search query, or words to say' },
            youtube: { type: 'boolean', description: 'Search on YouTube instead of Google' },
            play: { type: 'boolean', description: 'Play the top YouTube result' },
          },
          required: ['type'],
        },
      },
      required: ['reply', 'action'],
    },
  },
};

export function ruleCommand(command, elements) {
  const t = command.toLowerCase().trim();
  let m;
  if (/^(scroll )?(down|neeche|niche)/.test(t)) return { reply: 'Scrolling down', action: { type: 'scroll_down' } };
  if (/^(scroll )?(up|upar)/.test(t)) return { reply: 'Scrolling up', action: { type: 'scroll_up' } };
  if (/^(go )?back|peeche|wapas/.test(t)) return { reply: 'Going back', action: { type: 'back' } };
  if ((m = t.match(/^(?:play|watch|bajao|chalao)\s+(.+)/)) || (m = t.match(/^(.+?)\s+(?:ke gaane |ka gaana )?(?:bajao|chalao|lagao)$/))) {
    return { reply: `Playing ${m[1]}`, action: { type: 'search', text: m[1], youtube: true, play: true } };
  }
  if ((m = t.match(/^(?:search(?: for)?|find|google|khojo|dhundo)\s+(.+)/))) return { reply: `Searching ${m[1]}`, action: { type: 'search', text: m[1] } };
  const STOP = new Set(['open', 'click', 'choose', 'select', 'press', 'kholo', 'the', 'a', 'an', 'to', 'on', 'me', 'please', 'go', 'karo']);
  const words = t.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  let best = null;
  let bestHits = 0;
  for (const e of elements) {
    const hits = words.filter((w) => e.label.toLowerCase().includes(w)).length;
    if (hits > bestHits) { best = e; bestHits = hits; }
  }
  if (best && bestHits >= Math.max(1, Math.ceil(words.length / 2))) return { reply: `Opening ${best.label}`, action: { type: 'click', id: best.id } };
  return { reply: 'Sorry, I did not understand', action: { type: 'none' } };
}

export async function interpretCommand(body) {
  const command = requireString(body.command, 'command', 300);
  const elements = cleanElements(body.elements);
  try {
    const result = await callTool(
      'You control a web browser for a person who cannot use their hands. Turn their spoken command (English, Hindi or Hinglish) into ONE action. ' +
        'Use "click"/"type" with an element id from the list when the command refers to something on the page. ' +
        'Use "search" for finding things (set youtube=true and play=true for songs/videos to play). ' +
        'Use "say" if they want something spoken aloud for them. ' +
        `Reply in ${langName(body.lang)}.`,
      JSON.stringify({ command, page: { url: str(body.url, 300), title: str(body.title, 200) }, elements }),
      ACTION_TOOL,
    );
    if (result && result.action && result.action.type) {
      const a = result.action;
      if ((a.type === 'click' || a.type === 'type') && !elements.some((e) => e.id === a.id)) throw new Error('bad id');
      return { source: 'bedrock', reply: str(result.reply, 120), action: a };
    }
  } catch (e) { /* fall back to rules */ }
  return Object.assign({ source: 'rules' }, ruleCommand(command, elements));
}
