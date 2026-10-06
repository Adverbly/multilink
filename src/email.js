const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export async function sendRecoveryEmail(env, { to, host, link }) {
  if (!env.RESEND_API_KEY) {
    // Local development has no email provider, so print the link instead.
    if (env.ROOT_DOMAIN === 'localhost') {
      console.log(`Recovery link for ${host}: ${link}`);
      return;
    }
    throw new Error('RESEND_API_KEY is not set');
  }
  const text = [
    `Someone asked to recover the owner keys for ${host}.`,
    '',
    'Open this link within 30 minutes to add a new key or revoke old ones:',
    link,
    '',
    "If this wasn't you, you can ignore this email. Nothing changes unless the link is used.",
  ].join('\n');
  const api = env.RESEND_API_BASE || 'https://api.resend.com';
  const res = await fetch(`${api}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: `Recover access to ${host}`,
      text,
      html: text
        .split('\n')
        .map((line) =>
          line === link
            ? `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`
            : escapeHtml(line)
        )
        .join('<br>'),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  }
}
