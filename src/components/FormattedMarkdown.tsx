import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { previewLink } from "../text-preview";

export default function FormattedMarkdown({ text }: { text: string }) {
  return <div className="file-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={previewLink}
    components={{
      img: ({alt}) => <span className="markdown-image-label">{alt || "Image"}</span>,
      a: ({href, children}) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    }}>{text}</Markdown></div>;
}
