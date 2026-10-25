import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Renders the help-article Markdown subset: ## / ### headings, paragraphs,
 * "- " and "1. " lists, **bold**, `code` and [links](/path). Content comes from
 * our own API; anything else is shown as plain text.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key} className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      out.push(
        href.startsWith('/') ? (
          <Link key={key} href={href} className="font-medium text-brand-700 hover:underline">{label}</Link>
        ) : (
          <a key={key} href={href} className="font-medium text-brand-700 hover:underline" rel="noreferrer" target="_blank">{label}</a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-gray-700">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const head = lines[0];
        // A heading may be followed by text in the same block
        if (head.startsWith('## ') || head.startsWith('### ')) {
          const level = head.startsWith('### ') ? 3 : 2;
          const rest = lines.slice(1).join('\n');
          return (
            <div key={bi} className="space-y-3">
              {level === 2 ? <h2 className="pt-2 text-xl font-semibold text-gray-900">{head.slice(3)}</h2> : <h3 className="pt-1 font-semibold text-gray-900">{head.slice(4)}</h3>}
              {rest && <Markdown source={rest} />}
            </div>
          );
        }
        if (lines.every((l) => /^- /.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1.5 pl-5">
              {lines.map((l, i) => <li key={i}>{inline(l.slice(2), `${bi}-${i}`)}</li>)}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return (
            <ol key={bi} className="list-decimal space-y-1.5 pl-5">
              {lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d+\. /, ''), `${bi}-${i}`)}</li>)}
            </ol>
          );
        }
        // Paragraph followed by a list in the same block
        const firstList = lines.findIndex((l) => /^(- |\d+\. )/.test(l));
        if (firstList > 0) {
          return (
            <div key={bi} className="space-y-2">
              <p>{inline(lines.slice(0, firstList).join(' '), `${bi}p`)}</p>
              <Markdown source={lines.slice(firstList).join('\n')} />
            </div>
          );
        }
        return <p key={bi}>{inline(lines.join(' '), `${bi}`)}</p>;
      })}
    </div>
  );
}
