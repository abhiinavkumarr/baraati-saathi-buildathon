// Minimal, safe rendering of the model's light markdown: **bold** and "- "
// bullet lines. Builds React nodes (no innerHTML), so model text can't inject markup.
import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part.replace(/\*(?=\S)|(?<=\S)\*/g, '')}</Fragment>,
  );
}

export function Rich({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`} className="rich-list">{list}</ul>);
    list = [];
  };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) {
      list.push(<li key={i}>{inline(m[1])}</li>);
      return;
    }
    flush();
    if (line.trim()) out.push(<p key={i} className="rich-p">{inline(line)}</p>);
  });
  flush();
  return <>{out}</>;
}
