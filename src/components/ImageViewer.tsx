import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {Download, Maximize2, Minus, Plus, X} from "lucide-react";
import {constrainView, fitImage, MAX_ZOOM, zoomAt, type View} from "../image-view";
const initial: View = {scale: 1, x: 0, y: 0};
export default function ImageViewer({url, name, onClose}: {url: string; name: string; onClose: () => void}) {
  const stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null), close = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState({width: 1, height: 1});
  const [natural, setNatural] = useState({width: 0, height: 0});
  const [percent, setPercent] = useState(100), [dragging, setDragging] = useState(false);
  const base = fitImage(natural, viewport);
  const geometry = useRef({base, viewport}); geometry.current = {base, viewport};
  const view = useRef<View>({...initial}), target = useRef<View>({...initial});
  const frame = useRef(0), reducedMotion = useRef(false);
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const gesture = useRef({dragged: false, onImage: false, startX: 0, startY: 0});
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const stop = () => {cancelAnimationFrame(frame.current); frame.current = 0; target.current = {...view.current};};
  const paint = (next: View) => {
    const {base, viewport} = geometry.current;
    view.current = constrainView(next, base, viewport);
    const value = view.current;
    if (image.current) image.current.style.transform = `translate(-50%, -50%) translate3d(${value.x}px, ${value.y}px, 0) scale(${value.scale})`;
    setPercent(Math.round(value.scale * 100));
  };
  const animate = (next: View) => {
    const {base, viewport} = geometry.current;
    target.current = constrainView(next, base, viewport);
    if (reducedMotion.current) {stop(); paint(next); target.current = {...view.current}; return;}
    if (frame.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const amount = 1 - Math.exp(-Math.min(50, Math.max(1, now - last)) / 45);
      last = now;
      const from = view.current, to = target.current;
      if (Math.abs(from.scale - to.scale) < .001 && Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < .1) {
        paint(to); frame.current = 0; return;
      }
      paint({scale: from.scale + (to.scale - from.scale) * amount, x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount});
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const position = (x: number, y: number) => {
    const rect = stage.current!.getBoundingClientRect();
    return {x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2};
  };
  const commands = useRef({animate, position, stop, paint}); commands.current = {animate, position, stop, paint};
  useLayoutEffect(() => {stop(); paint(view.current);}, [viewport.width, viewport.height, base.width, base.height]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reducedMotion.current = !!media?.matches;
    const motion = () => {reducedMotion.current = !!media?.matches;};
    media?.addEventListener("change", motion);
    const element = stage.current!;
    const measure = () => setViewport({width: element.clientWidth, height: element.clientHeight});
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const scale = target.current.scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * (event.ctrlKey ? .012 : .003));
      commands.current.animate(zoomAt(view.current, scale, commands.current.position(event.clientX, event.clientY)));
    };
    element.addEventListener("wheel", wheel, {passive: false});
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        commands.current.animate(event.key === "0" ? {...initial} : zoomAt(view.current, target.current.scale * (event.key === "-" ? .8 : 1.25), {x: 0, y: 0}));
      }
      if (event.key === "Tab") {
        const controls = element.parentElement!.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]");
        const first = controls[0], last = controls[controls.length - 1];
        if (!element.parentElement!.contains(document.activeElement)) {event.preventDefault(); (event.shiftKey ? last : first).focus();}
        else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      }
    };
    document.addEventListener("keydown", key);
    return () => {commands.current.stop(); observer?.disconnect(); window.removeEventListener("resize", measure); media?.removeEventListener("change", motion); element.removeEventListener("wheel", wheel); document.removeEventListener("keydown", key); prior?.focus();};
  }, []);
  return <div className="image-viewer" role="dialog" aria-modal="true" aria-label={`Image : ${name}`}>
    <header className="viewer-toolbar">
      <strong>{name}</strong>
      <div className="viewer-zoom">
        <button className="icon-button" aria-label="Réduire" disabled={percent <= 100} onClick={() => animate(zoomAt(view.current, target.current.scale / 1.25, {x: 0, y: 0}))}><Minus size={19}/></button>
        <span aria-live="polite">{percent} %</span>
        <button className="icon-button" aria-label="Zoomer" disabled={percent >= MAX_ZOOM * 100} onClick={() => animate(zoomAt(view.current, target.current.scale * 1.25, {x: 0, y: 0}))}><Plus size={19}/></button>
        <button className="icon-button" aria-label="Ajuster l’image" onClick={() => animate({...initial})}><Maximize2 size={17}/></button>
      </div>
      <a className="icon-button" href={url} download={name} aria-label="Télécharger l’image"><Download size={19}/></a>
      <button ref={close} className="icon-button" aria-label="Fermer l’image" onClick={onClose}><X size={22}/></button>
    </header>
    <div ref={stage} className={`viewer-stage ${percent > 100 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        stop();
        pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
        if (pointers.current.size === 1) gesture.current = {dragged: false, onImage: event.target === image.current, startX: event.clientX, startY: event.clientY};
        else gesture.current.dragged = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const before = [...pointers.current.values()], old = pointers.current.get(event.pointerId);
        if (!old) return;
        pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
        if (pointers.current.size === 2) {
          const after = [...pointers.current.values()];
          const distance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
          const ratio = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y) / Math.max(1, distance);
          const from = {x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2};
          const to = {x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2};
          const next = zoomAt(view.current, view.current.scale * ratio, position(from.x, from.y));
          paint({...next, x: next.x + to.x - from.x, y: next.y + to.y - from.y});
          gesture.current.dragged = true;
        } else if (view.current.scale > 1) {
          if (Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 3) gesture.current.dragged = true;
          if (gesture.current.dragged) {setDragging(true); paint({...view.current, x: view.current.x + event.clientX - old.x, y: view.current.y + event.clientY - old.y});}
        }
        target.current = {...view.current};
      }}
      onPointerUp={event => {pointers.current.delete(event.pointerId); setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
      onPointerCancel={event => {pointers.current.delete(event.pointerId); gesture.current.dragged = true; setDragging(false);}}
      onLostPointerCapture={event => {pointers.current.delete(event.pointerId); setDragging(false);}}
      onClick={event => {
        if (gesture.current.dragged || event.detail > 1) return;
        if (gesture.current.onImage || event.target === image.current) animate(view.current.scale > 1.01 ? {...initial} : zoomAt(view.current, 2.5, position(event.clientX, event.clientY)));
        else if (view.current.scale <= 1.01) onClose();
      }}>
      <img ref={image} className="viewer-image" src={url} alt={name} draggable={false} style={{width: natural.width ? base.width : undefined, height: natural.height ? base.height : undefined}}
        onLoad={event => setNatural({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}/>
    </div>
  </div>;
}
