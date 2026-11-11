import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Channel } from "../core/types";

function SortableRow({ channel, selected, disabled, drop, moved, reducedMotion, icon, onChoose }: {
  channel: Channel; selected: boolean; disabled: boolean; drop: string; moved: boolean;
  reducedMotion: boolean; icon: ReactNode; onChoose: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id, disabled, transition: { duration: reducedMotion ? 0 : 210, easing: "cubic-bezier(.2,.8,.2,1)" },
  });
  return <div ref={setNodeRef}
    className={`sortable-channel ${isDragging ? "is-dragging" : ""} ${drop} ${moved ? "just-moved" : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button className={`channel ${selected ? "active" : ""}`} disabled={disabled}
      onClick={onChoose} onMouseDown={(e) => listeners?.onMouseDown?.(e)} onTouchStart={(e) => listeners?.onTouchStart?.(e)}>
      {icon}<span>{channel.name}</span>{selected && <span className="active-mark" />}
    </button>
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="channel-grip"
      disabled={disabled} aria-label={`Déplacer le salon ${channel.name}`} title="Déplacer le salon">
      <GripVertical size={15} />
    </button>
  </div>;
}
export default function SortableChannels({ channels, selected, disabled, renderIcon, onChoose, onReorder, onDraggingChange }: {
  channels: Channel[]; selected?: string; disabled: boolean;
  renderIcon: (channel: Channel) => ReactNode; onChoose: (id: string) => void;
  onReorder: (ids: string[]) => Promise<void>; onDraggingChange: (dragging: boolean) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const clearMoved = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(clearMoved.current); onDraggingChange(false); }, [onDraggingChange]);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(channels.map((c) => [c.id, c]));
  const items = optimistic ? optimistic.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []) : channels;
  const active = dragging ? byId.get(dragging) : undefined;
  const finish = async ({ active, over }: DragEndEvent) => {
    setDragging(null);
    setOver(null);
    onDraggingChange(false);
    if (!over || active.id === over.id) return;
    const from = items.findIndex((c) => c.id === active.id), to = items.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    const ids = arrayMove(items.map((c) => c.id), from, to);
    setOptimistic(ids);
    setMoved(String(active.id));
    clearTimeout(clearMoved.current);
    clearMoved.current = setTimeout(() => setMoved(null), 800);
    try { await onReorder(ids); }
    finally { setOptimistic(null); }
  };
  return <DndContext sensors={sensors} collisionDetection={(args) => {
      const point = args.pointerCoordinates;
      if (point) {
        const rects = [...args.droppableRects.values()];
        if (!rects.some((r) => point.x >= r.left && point.x <= r.right && point.y >= r.top - 6 && point.y <= r.bottom + 6)) return [];
      }
      return closestCenter(args);
    }}
    onDragStart={({active}) => { setDragging(String(active.id)); setOver(null); onDraggingChange(true); }}
    onDragOver={({over}) => setOver(over ? String(over.id) : null)}
    onDragCancel={() => { setDragging(null); setOver(null); onDraggingChange(false); }} onDragEnd={(event) => void finish(event)}
    accessibility={{
      screenReaderInstructions: { draggable: "Pour déplacer un salon, appuyez sur Espace, puis utilisez les flèches. Espace pour valider, Échap pour annuler." },
      announcements: {
        onDragStart: ({active}) => `Déplacement du salon ${byId.get(String(active.id))?.name}.`,
        onDragOver: ({over}) => over ? `Position ${items.findIndex((c) => c.id === over.id) + 1} sur ${items.length}.` : "Hors de la liste.",
        onDragEnd: ({active, over}) => over ? `Salon ${byId.get(String(active.id))?.name} placé en position ${items.findIndex((c) => c.id === over.id) + 1}.` : "Déplacement annulé.",
        onDragCancel: () => "Déplacement annulé.",
      },
    }}>
    <SortableContext items={items.map((c) => c.id)} strategy={verticalListSortingStrategy}>
      {items.map((c) => <SortableRow key={c.id} channel={c} selected={c.id === selected}
        disabled={disabled || !!optimistic} reducedMotion={reducedMotion} icon={renderIcon(c)}
        moved={c.id === moved} onChoose={() => { if (!dragging) onChoose(c.id); }}
        drop={over === c.id && over !== dragging ? (items.findIndex((c) => c.id === dragging) < items.findIndex((c) => c.id === over) ? "drop-after" : "drop-before") : ""} />)}
    </SortableContext>
    {createPortal(<DragOverlay dropAnimation={reducedMotion ? null : { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
      {active && <div className="channel channel-drag-overlay">{renderIcon(active)}<span>{active.name}</span><GripVertical size={15} /></div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
