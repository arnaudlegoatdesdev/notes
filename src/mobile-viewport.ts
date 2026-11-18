import { useEffect } from "react";

export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const touch = window.matchMedia?.("(pointer: coarse)");
    if (!viewport || !touch) return;

    const style = document.documentElement.style;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        const typing = focused?.matches("textarea, input:is([type=text], [type=search], [type=email], [type=number], :not([type]))");
        if (touch.matches && typing && viewport.scale === 1 && viewport.height < document.documentElement.clientHeight) {
          style.setProperty("--notes-viewport-height", `${Math.round(viewport.height)}px`);
        } else {
          style.removeProperty("--notes-viewport-height");
        }
      });
    };
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      style.removeProperty("--notes-viewport-height");
    };
  }, []);
}
