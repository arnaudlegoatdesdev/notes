import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export default function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const element = input.current;
    if (!element) return;
    const scroll = element.scrollTop;
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + border}px`;
    const overflowing = element.scrollHeight > element.clientHeight + 1;
    element.style.overflowY = overflowing ? "auto" : "hidden";
    element.scrollTop = overflowing ? scroll : 0;
  }, []);
  useLayoutEffect(resize, [props.value, resize]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; resize(); }
    });
    observer?.observe(element);
    // Theme/font settings can change line wrapping without changing the field width.
    const appearance = new MutationObserver(resize);
    appearance.observe(document.documentElement, {attributes: true, attributeFilter: ["style", "data-font"]});
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    document.fonts?.addEventListener("loadingdone", resize);
    return () => {
      observer?.disconnect();
      appearance.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      document.fonts?.removeEventListener("loadingdone", resize);
    };
  }, [resize]);
  return <textarea {...props} ref={input} />;
}
