import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Maximize2, Minus, Plus, X } from "lucide-react";
const bound = (value: number) => Math.max(1, Math.min(5, value));

export default function ImageViewer({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const previous = useRef({ zoom: 1, width: 1, height: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const movement = useRef({
    x: 0,
    y: 0,
    distance: 0,
    zoom: 1,
    dragged: false,
    onImage: false,
  });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const changeZoom = (value: number) => {
    const next = bound(value);
    zoomRef.current = next;
    setZoom(next);
  };
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(zoomRef.current + 0.5);
      }
      if (event.key === "-") {
        event.preventDefault();
        changeZoom(zoomRef.current - 0.5);
      }
      if (event.key === "0") changeZoom(1);
      if (event.key === "Tab") {
        const controls =
          stage.current?.parentElement?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href]",
          );
        if (!controls?.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const element = stage.current;
    const measure = () => {
      if (element)
        setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (element) observer?.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(zoomRef.current * (event.deltaY > 0 ? 0.9 : 1.1));
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      document.removeEventListener("keydown", key);
      element?.removeEventListener("wheel", wheel);
      observer?.disconnect();
      prior?.focus();
    };
  }, []);
  const fit = natural.width
    ? Math.min(
        1,
        (size.width - 28) / natural.width,
        (size.height - 28) / natural.height,
      )
    : 1;
  const width = Math.max(
    1,
    Math.round(natural.width * Math.max(0.01, fit) * zoom),
  );
  const height = Math.max(
    1,
    Math.round(natural.height * Math.max(0.01, fit) * zoom),
  );
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const prior = previous.current;
    const oldWidth = Math.max(size.width, prior.width),
      oldHeight = Math.max(size.height, prior.height);
    if (zoom === 1) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    } else {
      element.scrollLeft =
        ((element.scrollLeft + size.width / 2) / oldWidth) *
          Math.max(size.width, width) -
        size.width / 2;
      element.scrollTop =
        ((element.scrollTop + size.height / 2) / oldHeight) *
          Math.max(size.height, height) -
        size.height / 2;
    }
    previous.current = { zoom, width, height };
  }, [zoom, size, width, height]);
  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Image : ${name}`}
    >
      <header className="viewer-toolbar">
        <strong>{name}</strong>
        <div className="viewer-zoom">
          <button
            className="icon-button"
            aria-label="Réduire"
            disabled={zoom <= 1}
            onClick={() => changeZoom(zoom - 0.5)}
          >
            <Minus size={19} />
          </button>
          <span aria-live="polite">{Math.round(zoom * 100)} %</span>
          <button
            className="icon-button"
            aria-label="Zoomer"
            disabled={zoom >= 5}
            onClick={() => changeZoom(zoom + 0.5)}
          >
            <Plus size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="Ajuster l’image"
            onClick={() => changeZoom(1)}
          >
            <Maximize2 size={17} />
          </button>
        </div>
        <a
          className="icon-button"
          href={url}
          download={name}
          aria-label="Télécharger l’image"
        >
          <Download size={19} />
        </a>
        <button
          ref={close}
          className="icon-button"
          aria-label="Fermer l’image"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div
        ref={stage}
        className={`viewer-stage ${zoom > 1 ? "zoomed" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          movement.current = {
            x: event.clientX,
            y: event.clientY,
            distance: 0,
            zoom: zoomRef.current,
            dragged: false,
            onImage: event.target instanceof HTMLImageElement,
          };
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            movement.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const gesture = movement.current;
          if (pointers.current.size === 2 && gesture.distance) {
            const [a, b] = [...pointers.current.values()];
            changeZoom(
              (gesture.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
                gesture.distance,
            );
            gesture.dragged = true;
          } else if (zoomRef.current > 1) {
            const dx = event.clientX - gesture.x,
              dy = event.clientY - gesture.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) gesture.dragged = true;
            event.currentTarget.scrollLeft -= dx;
            event.currentTarget.scrollTop -= dy;
          }
          gesture.x = event.clientX;
          gesture.y = event.clientY;
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          movement.current.dragged = true;
        }}
        onClick={(event) => {
          if (movement.current.dragged) return;
          if (movement.current.onImage)
            changeZoom(zoomRef.current === 1 ? 2 : 1);
          else if (zoomRef.current === 1) onClose();
        }}
      >
        <div
          className="viewer-canvas"
          style={{
            width: Math.max(size.width, width),
            height: Math.max(size.height, height),
          }}
        >
          <img
            src={url}
            alt={name}
            draggable={false}
            style={{
              width: natural.width ? width : undefined,
              height: natural.height ? height : undefined,
            }}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
