import { describe, expect, it } from 'vitest';
import { hasLink, splitLinks } from '../src/lib/linkify';

const links = (s: string) => splitLinks(s).filter((p) => p.kind === 'link');
const text = (s: string) =>
  splitLinks(s)
    .map((p) => p.value)
    .join('');

describe('splitLinks', () => {
  it('leaves ordinary text alone', () => {
    const parts = splitLinks('just a normal message');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'text', value: 'just a normal message' });
  });

  it('finds an https link', () => {
    const [link] = links('look at https://example.com/page');
    expect(link).toMatchObject({ href: 'https://example.com/page' });
  });

  it('gives a bare www link an absolute href', () => {
    const [link] = links('www.example.com is good');
    expect(link).toMatchObject({ value: 'www.example.com', href: 'https://www.example.com' });
  });

  it('picks up a bare domain with a known suffix', () => {
    const [link] = links('go to github.com now');
    expect(link?.href).toBe('https://github.com');
  });

  it('leaves sentence punctuation out of the link', () => {
    const [link] = links('see https://example.com/docs.');
    expect(link?.href).toBe('https://example.com/docs');
    // Nothing is lost: the full stop comes back as text.
    expect(text('see https://example.com/docs.')).toBe('see https://example.com/docs.');
  });

  it('does not swallow a closing bracket that was never opened', () => {
    const [link] = links('(see https://example.com/a)');
    expect(link?.href).toBe('https://example.com/a');
  });

  it('keeps parentheses that belong to the URL', () => {
    const [link] = links('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(link?.href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('handles several links in one message', () => {
    const found = links('a https://one.com b www.two.org c');
    expect(found).toHaveLength(2);
    expect(found[1].href).toBe('https://www.two.org');
  });

  it('never drops or duplicates any of the original text', () => {
    for (const message of [
      'plain',
      'https://a.com',
      'before https://a.com after',
      'a.com, b.net; c.org.',
      '(https://a.com/x) and www.b.dev!',
    ]) {
      expect(text(message)).toBe(message);
    }
  });

  it('is not fooled by prose that merely contains a dot', () => {
    expect(hasLink('the end.Then it began')).toBe(false);
    expect(hasLink('version 1.2.3 shipped')).toBe(false);
  });

  it('handles an empty message', () => {
    expect(splitLinks('')).toEqual([{ kind: 'text', value: '' }]);
  });
});
