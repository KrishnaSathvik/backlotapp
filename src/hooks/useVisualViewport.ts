'use client';

import { useEffect } from 'react';

/**
 * Mirrors the visual viewport into CSS variables on <html>:
 *   --vv-height  the visible height (shrinks when the on-screen keyboard opens)
 *   --vv-top     how far the visible area is panned down from the layout viewport
 *
 * Android Chrome already resizes the layout for the keyboard (see `interactiveWidget` in the
 * root viewport), but iOS Safari does not, so overlays and the Slate composer size themselves
 * from these values to stay above the keyboard. Unset, CSS falls back to 100dvh / 0.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
        root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-top');
    };
  }, []);
}
