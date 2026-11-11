import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Code, Download, LoaderCircle } from "lucide-react";
import type { Attachment } from "../core/types";
import { formatBytes } from "../quota";
import { decodeTextPreview, MAX_TEXT_PREVIEW_BYTES, textPreviewKind } from "../text-preview";

const FormattedMarkdown = lazy(() => import("./FormattedMarkdown"));

export default function TextAttachment({ attachment, load, onDownload }: {
  attachment: Attachment; load: (file: Attachment) => Promise<Blob | undefined>; onDownload: () => void;
}) {
  const persistenceKey = `notes.preview.collapsed.${attachment.id}`;
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(persistenceKey) !== "1"; } catch { return true; }
  });
  const [source, setSource] = useState(false);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const markdown = textPreviewKind(attachment) === "markdown";
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin: "200px"});
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded || !visible || text !== null) return;
    let canceled = false;
    setError("");
    void (async () => {
      const blob = await load(attachment);
      if (!blob) throw new Error("Ce fichier n’est plus disponible.");
      const data = new Uint8Array(await blob.slice(0, MAX_TEXT_PREVIEW_BYTES).arrayBuffer());
      const content = decodeTextPreview(data, blob.size > MAX_TEXT_PREVIEW_BYTES);
      if (!canceled) { setText(content); setTruncated(blob.size > MAX_TEXT_PREVIEW_BYTES); }
    })().catch((e) => { if (!canceled) setError(e instanceof Error ? e.message : "Aperçu indisponible."); });
    return () => { canceled = true; };
  }, [expanded, visible, attachment, load, text]);
  const body = useMemo(() => text === null ? null : markdown && !source ? (
    <Suspense fallback={<div className="text-preview-status"><LoaderCircle size={19} className="spin" />Chargement</div>}>
      <FormattedMarkdown text={text} />
    </Suspense>
  ) : <pre className="file-plain-text">{text || "Fichier vide."}</pre>, [text, markdown, source]);
  const toggle = () => {
    setExpanded(!expanded);
    try { if (expanded) localStorage.setItem(persistenceKey, "1"); else localStorage.removeItem(persistenceKey); } catch { /* Preview preferences are optional. */ }
  };
  return <div className={`text-attachment ${expanded ? "expanded" : "collapsed"}`} ref={holder}>
    {expanded && <div className="text-preview-body" id={panelId} role="region" aria-label={`Aperçu de ${attachment.name}`} tabIndex={0}>
      {error ? <div className="text-preview-status" role="alert">{error}<button className="text-button" onClick={onDownload}>Télécharger le fichier</button></div>
        : text === null ? <div className="text-preview-status" role="status"><LoaderCircle size={19} className="spin" />Chargement</div> : body}
      {truncated && <p className="text-preview-limit">Aperçu limité à 512 Kio. <button className="text-button" onClick={onDownload}>Télécharger le fichier complet</button></p>}
    </div>}
    <div className="text-preview-footer">
      <button className="text-preview-toggle" onClick={toggle} aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${expanded ? "Réduire" : "Développer"} l’aperçu de ${attachment.name}`} title={expanded ? "Réduire" : "Développer"}>
        {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      <button className="text-preview-filename" onClick={toggle} aria-expanded={expanded} aria-controls={panelId}>
        <strong>{attachment.name}</strong><span>{formatBytes(attachment.size)}</span>
      </button>
      {markdown && expanded && <button className={`icon-button ${source ? "accent" : ""}`} aria-pressed={source}
        aria-label={source ? "Afficher le Markdown formaté" : "Afficher le texte source"} title={source ? "Markdown formaté" : "Texte source"} onClick={() => setSource(!source)}><Code size={18} /></button>}
      <button className="icon-button" onClick={onDownload} aria-label={`Télécharger ${attachment.name}`} title="Télécharger"><Download size={18} /></button>
    </div>
  </div>;
}
