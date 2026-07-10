import type { EmailAddress, EmailMessage } from "./communicationsApi.js";

function uniqueAddresses(addresses: readonly EmailAddress[], excluded: Set<string>): EmailAddress[] {
  const seen = new Set<string>();
  const unique: EmailAddress[] = [];
  for (const address of addresses) {
    const email = address.email?.trim();
    const key = email?.toLowerCase();
    if (!email || !key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...address, email });
  }
  return unique;
}

export function buildReplyAllRecipients(message: EmailMessage, excludedEmails: readonly string[] = []): { to: EmailAddress[]; cc: EmailAddress[] } {
  const excluded = new Set(excludedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const to = uniqueAddresses(message.reply_to?.length ? message.reply_to : message.from ?? [], excluded);
  const ccExcluded = new Set([...excluded, ...to.map((address) => address.email.toLowerCase())]);
  const cc = uniqueAddresses([...(message.to ?? []), ...(message.cc ?? [])], ccExcluded);
  return { to, cc };
}
