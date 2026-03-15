import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Claude-powered insight for a single reading
app.post('/api/insight', async (req, res) => {
  const { systolic, diastolic, pulse, history } = req.body;

  if (!systolic || !diastolic) {
    return res.status(400).json({ error: 'systolic and diastolic are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const historyText = history?.length
    ? `\nRecent readings (newest first):\n${history.slice(0, 7).map(r =>
        `  ${r.date}: ${r.systolic}/${r.diastolic} mmHg, pulse ${r.pulse} bpm`
      ).join('\n')}`
    : '';

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 300,
      system: `You are a calm, helpful health companion. You give brief, clear observations about blood pressure readings.
You are NOT a doctor and always remind users to consult their physician for medical advice.
Keep responses to 2-3 short sentences. Be warm and reassuring when readings are good; gently encouraging when they need attention.`,
      messages: [{
        role: 'user',
        content: `Today's reading: ${systolic}/${diastolic} mmHg, pulse ${pulse ?? 'not recorded'} bpm.${historyText}

Give a brief observation about this reading and any trend you notice.`,
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BP Tracker running at http://localhost:${PORT}`);
});
