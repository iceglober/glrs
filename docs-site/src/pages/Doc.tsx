import { useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Doc({ md, title }: { md: string; title: string }) {
  useEffect(() => {
    document.title = `${title} — glrs`;
  }, [title]);

  return (
    <main className="site-main doc">
      <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
    </main>
  );
}
