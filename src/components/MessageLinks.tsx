import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Globe, LoaderCircle } from "lucide-react";
import type { LinkPreview, Message } from "../core/types";
import { loadLinkPreview, previewUrls } from "../link-previews";

function LinkCard({ url, saved, storageKey, onLoaded }: {
  url: string; saved?: LinkPreview; storageKey: string; onLoaded: (preview: LinkPreview) => void;
}) {
  const [metadata, setMetadata] = useState<LinkPreview | null>(saved || null);
  const [loading, setLoading] = useState(!saved);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "1"; } catch { return true; }
  });
  const holder = useRef<HTMLDivElement>(null), callback = useRef(onLoaded);
  callback.current = onLoaded;
  useEffect(() => { if (saved) { setMetadata(saved); setLoading(false); } }, [saved]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin: "150px"});
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (saved || !visible || !expanded) return;
    let canceled = false;
    setLoading(true);
    void loadLinkPreview(url).then((result) => {
      if (canceled) return;
      setMetadata(result); setLoading(false);
      if (result) callback.current(result);
    });
    return () => { canceled = true; };
  }, [url, visible, expanded, saved]);
  const host = new URL(url).hostname;
  const toggle = () => {
    setExpanded(!expanded);
    try { if (expanded) localStorage.setItem(storageKey, "1"); else localStorage.removeItem(storageKey); } catch { /* Optional preference. */ }
  };
  return <div className={`link-preview ${expanded ? "expanded" : "collapsed"} ${metadata ? "rich" : "simple"}`} ref={holder}>
    <div className="link-preview-header">
      <Globe size={13} /><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{host}</a>
      {expanded && loading && <LoaderCircle size={13} className="spin" aria-label="Chargement de l’aperçu" />}
      <button className="icon-button" onClick={toggle} aria-expanded={expanded} aria-label={`${expanded ? "Réduire" : "Développer"} l’aperçu du lien ${host}`}>
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
    </div>
    {expanded && <a className="link-preview-content" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <strong>{metadata?.title || "Ouvrir la page"}<ExternalLink size={13} /></strong>
      {metadata?.description && <p>{metadata.description}</p>}
      {metadata?.image && <img src={metadata.image} alt="" loading="lazy" draggable={false} />}
    </a>}
  </div>;
}
export default function MessageLinks({message, onLoaded}: {message: Message; onLoaded: (id: string, preview: LinkPreview) => void}) {
  const urls = previewUrls(message.text);
  if (!urls.length) return null;
  return <div className="message-link-previews">
    {urls.map((url, index) => <LinkCard key={url} url={url} saved={message.linkPreviews?.find((p) => p.url === url)}
      storageKey={`notes.link-preview.closed.${message.id}.${index}`} onLoaded={(preview) => onLoaded(message.id, preview)} />)}
  </div>;
}
