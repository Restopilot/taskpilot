export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { to, subject, body } = req.body;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_KEY) return res.status(500).json({ error: "RESEND_API_KEY manquante" });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'TaskPilot <onboarding@resend.dev>',
      to: [to],
      subject,
      text: body,
    }),
  });

  const data = await r.json();
  if (!r.ok) return res.status(400).json({ error: data });
  return res.status(200).json({ success: true });
}
