import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircle, Maximize2 } from "lucide-react";
import type { Attachment } from "../core/types";

let decoding: Promise<unknown> = Promise.resolve();
function schedule<T>(work: () => Promise<T>): Promise<T> {
  const next = decoding.then(work);
  decoding = next.catch(() => undefined);
  return next;
}

async function thumbnail(blob: Blob): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let release: () => void;
  try {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(blob);
    const image = new window.Image();
    try {
      image.src = url;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
      release = () => {
        image.src = "";
        URL.revokeObjectURL(url);
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  try {
    if (!width || !height) throw new Error("Image invalide.");
    const ratio = Math.min(1, 720 / width, 480 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Aperçu indisponible.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("Aperçu indisponible.")),
        "image/webp",
        0.86,
      ),
    );
  } finally {
    release();
  }
}

export default function AttachmentImage({
  attachment,
  load,
  onOpen,
  tile = false,
}: {
  attachment: Attachment;
  load: (attachment: Attachment) => Promise<Blob | undefined>;
  onOpen?: () => void;
  tile?: boolean;
}) {
  const holder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let canceled = false;
    let resource = "";
    setFailed(false);
    void schedule(async () => {
      if (canceled) return;
      const blob = await load(attachment);
      if (!blob || canceled) {
        if (!blob && !canceled) throw new Error("Image indisponible.");
        return;
      }
      const preview = await thumbnail(blob);
      if (canceled) return;
      resource = URL.createObjectURL(preview);
      setUrl(resource);
    }).catch(() => {
      if (!canceled) setFailed(true);
    });
    return () => {
      canceled = true;
      if (resource) URL.revokeObjectURL(resource);
      setUrl("");
    };
  }, [visible, attachment.id, load]);
  const content = (
    <span
      ref={holder}
      className={`attachment-image ${tile ? "tile-image" : ""}`}
    >
      {url ? (
        <img src={url} alt={attachment.name} draggable={false} />
      ) : failed ? (
        <ImageIcon size={28} />
      ) : (
        <LoaderCircle size={22} className="spin" />
      )}
      {url && onOpen && (
        <span className="image-enlarge">
          <Maximize2 size={17} />
        </span>
      )}
    </span>
  );
  return onOpen ? (
    <button
      className="image-open"
      type="button"
      onClick={onOpen}
      aria-label={`Agrandir ${attachment.name}`}
    >
      {content}
    </button>
  ) : (
    content
  );
}
