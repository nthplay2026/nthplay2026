import type { ReactNode } from 'react';

/**
 * Renders admin-editable legal text safely (as text, never HTML).
 * "## Heading" -> heading, "- item" -> bullet list, blank line -> new paragraph.
 */
export function LegalText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push(<p key={blocks.length}>{para.join(' ')}</p>); para = []; }
    if (bullets.length) { blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>); bullets = []; }
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      flush();
      blocks.push(<h2 key={blocks.length}>{line.replace(/^#+\s*/, '')}</h2>);
    } else if (/^[-*•]\s+/.test(line)) {
      if (para.length) { blocks.push(<p key={blocks.length}>{para.join(' ')}</p>); para = []; }
      bullets.push(line.replace(/^[-*•]\s+/, ''));
    } else {
      if (bullets.length) { blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>); bullets = []; }
      para.push(line);
    }
  }
  flush();
  return <>{blocks}</>;
}
