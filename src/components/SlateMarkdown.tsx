import React from 'react';

/**
 * Tiny markdown renderer for Slate replies: paragraphs, headings, bullet and
 * numbered lists, fenced code, **bold**, *italic* and `code`. Everything is
 * rendered as React text, never as HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (tok.startsWith('**')) out.push(<strong key={key} className="font-semibold text-zinc-950 dark:text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`'))
      out.push(
        <code key={key} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
          {tok.slice(1, -1)}
        </code>
      );
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'code'; text: string };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ type: 'h', level: h[1].length, text: h[2] });
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flush();
      const type = ul ? 'ul' : 'ol';
      const prev = blocks[blocks.length - 1];
      const text = (ul ?? ol)![1];
      if (prev && prev.type === type) prev.items.push(text);
      else blocks.push({ type, items: [text] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

export function SlateMarkdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="space-y-3 text-[15px] leading-7 text-zinc-800 dark:text-zinc-200">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.type === 'h')
          return (
            <p key={k} className={b.level <= 2 ? 'pt-1 text-[17px] font-bold text-zinc-950 dark:text-white' : 'pt-1 font-semibold text-zinc-950 dark:text-white'}>
              {inline(b.text, k)}
            </p>
          );
        if (b.type === 'code')
          return (
            <pre key={k} className="overflow-x-auto rounded-xl bg-zinc-100 p-3.5 font-mono text-[13px] leading-6 dark:bg-zinc-900">
              {b.text}
            </pre>
          );
        if (b.type !== 'p') {
          const List = b.type;
          return (
            <List key={k} className={cx(List === 'ul' ? 'list-disc' : 'list-decimal', 'space-y-1.5 pl-5 marker:text-zinc-400')}>
              {b.items.map((item, j) => (
                <li key={j} className="pl-1">{inline(item, `${k}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={k} className="whitespace-pre-wrap">
            {inline(b.text, k)}
          </p>
        );
      })}
    </div>
  );
}

const cx = (...c: string[]) => c.join(' ');
