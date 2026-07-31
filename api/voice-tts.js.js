// Vercel serverless function — deploy alongside your existing /api/proxy
// Path in your project: /api/voice-tts.js
//
// SETUP (you do this once):
// 1. Create an ElevenLabs account: https://elevenlabs.io
// 2. Go to VoiceLab → "Add Voice" → "Instant Voice Clone", upload your mp3 sample.
//    (30s is workable; 1-3 clean minutes gives noticeably better results if you
//    have more samples of the same voice.)
// 3. Copy the resulting Voice ID.
// 4. In Vercel → your project → Settings → Environment Variables, add:
//      ELEVENLABS_API_KEY   = sk_e97eb3426dc74bd934f10f4288cdbf92351f3e007ab1d730
//      ELEVENLABS_VOICE_ID  = 3AMU7jXQuQa3oRvRqUmb
// 5. Deploy this file to /api/voice-tts.js in the same project as your existing proxy.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, lang } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing "text" in request body' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: 'Server not configured with ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID' });
  }

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          // multilingual model handles both Hindi and English from one cloned voice
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.8,
            style: 0.35,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      return res.status(elevenRes.status).json({ error: `ElevenLabs error: ${errText}` });
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(audioBuffer));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'TTS generation failed' });
  }
}
