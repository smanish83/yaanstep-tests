/**
 * Words that must never appear on the children's word and grammar pages (Manish, 23 Nov 2026: "Do not include bad words
 * or inappropriate words"; SCRUM-516). Kept base64-encoded so this file does not spell them out. The list covers swear
 * words, slurs, insults, violence and death, alcohol and drugs, and adult words. Add to it freely; never remove from it.
 * Matching is by whole word, case-insensitive, so "butter" or "skill" are fine.
 */
const ENCODED = 'ZnVjayxmdWNraW5nLHNoaXQsc2hpdHR5LGJpdGNoLGJhc3RhcmQsZGFtbixjcmFwLHBpc3MscGlzc2VkLGRpY2ssY29jayxwdXNzeSxjdW50LGFzcyxhcnNlLGFzc2hvbGUsd2hvcmUsc2x1dCxmYWcsZmFnZ290LHJldGFyZCxyZXRhcmRlZCxuaWdnZXIsbmlnZ2EsY2hpbmssc3BpYyxraWtlLHdhbmtlcix0d2F0LGJvbGxvY2tzLHRpdHMsYm9vYnMscG9ybixwZW5pcyx2YWdpbmEsYnV0dCxoZWxsLHNleCxzZXh5LG5ha2VkLG51ZGUsa2lsbCxraWxsZWQsa2lsbGluZyxtdXJkZXIsZ3VuLGd1bnMsd2VhcG9uLGJsb29kLGJsb29keSxkZWFkLGRlYXRoLGRpZSxkaWVzLGRpZWQsc3VpY2lkZSxkcnVuayxiZWVyLHdpbmUsdm9ka2EsYWxjb2hvbCxjaWdhcmV0dGUsc21va2luZyxkcnVnLGRydWdzLHN0dXBpZCxkdW1iLGlkaW90LG1vcm9uLHVnbHksZmF0LGxvc2VyLHNodXQgdXAsaGF0ZSxoYXRlZCxoYXRlcyxuYXppLHRlcnJvcmlzdCxib21iLGZhcnQscG9vcCxjcmFwcHksamVyayxmcmVhayxzdWNrcw==';

export const BLOCKED_WORDS: string[] = Buffer.from(ENCODED, 'base64').toString('utf8').split(',').map((s) => s.trim()).filter(Boolean);

/** Every blocked word found in the text (whole words only). */
export function blockedIn(text: string): string[] {
  const t = text.toLowerCase();
  return BLOCKED_WORDS.filter((b) => new RegExp('(^|[^a-z])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t));
}
