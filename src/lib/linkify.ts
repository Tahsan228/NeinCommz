/**
 * Finding links in message text.
 *
 * Kept as a pure splitter rather than a component so it can be tested, and so
 * the rendering side never has to touch innerHTML — the pieces come back as
 * data and React escapes them, which is the only safe way to do this with
 * text other people wrote.
 */

export interface TextPart {
  kind: 'text';
  value: string;
}

export interface LinkPart {
  kind: 'link';
  /** What to show. */
  value: string;
  /** Where it actually goes, always absolute. */
  href: string;
}

export type Part = TextPart | LinkPart;

// Explicit schemes, plus bare www. and bare domains with a known-ish TLD.
// Deliberately conservative: matching too eagerly turns ordinary sentences
// ("see figure 1.Then") into links.
// Parentheses are allowed inside a URL — Wikipedia article links are full of
// them — and an unbalanced trailing one is stripped afterwards instead.
const PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>[\]{}"']+|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|dev|app|gg|co|uk|edu|gov|xyz|me)\b(?:\/[^\s<>[\]{}"']*)?/gi;

/** Trailing punctuation is almost always sentence punctuation, not the URL. */
function trimTrailing(raw: string): { url: string; tail: string } {
  let url = raw;
  let tail = '';
  while (url.length > 1 && /[.,;:!?]$/.test(url)) {
    tail = url.slice(-1) + tail;
    url = url.slice(0, -1);
  }
  // Balance a closing paren only if it was not opened inside the URL.
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    tail = ')' + tail;
    url = url.slice(0, -1);
  }
  return { url, tail };
}

export function splitLinks(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    const { url, tail } = trimTrailing(match[0]);
    if (!url) continue;

    if (start > last) parts.push({ kind: 'text', value: text.slice(last, start) });

    parts.push({
      kind: 'link',
      value: url,
      href: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    });

    if (tail) parts.push({ kind: 'text', value: tail });
    last = start + match[0].length;
  }

  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts.length ? parts : [{ kind: 'text', value: text }];
}

/** Does this message contain at least one link? */
export function hasLink(text: string): boolean {
  return splitLinks(text).some((p) => p.kind === 'link');
}
