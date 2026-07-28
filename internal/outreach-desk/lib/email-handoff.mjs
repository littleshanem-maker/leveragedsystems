export function buildMailtoUri({ recipient, subject, body }) {
  if (!/^\S+@\S+\.\S+$/.test(String(recipient || '').trim())) throw new Error('A valid recipient is required');
  if (!String(subject || '').trim()) throw new Error('A subject is required');
  if (!String(body || '').trim()) throw new Error('A message body is required');
  const query = new URLSearchParams({ subject: subject.trim(), body: body.trim() });
  return `mailto:${encodeURIComponent(recipient.trim().toLowerCase())}?${query.toString()}`;
}
