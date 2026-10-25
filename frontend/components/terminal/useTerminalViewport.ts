'use client';

import { useEffect, type RefObject } from 'react';

type UseTerminalViewportParams = {
  anchorRef: RefObject<HTMLElement | null>;
  onViewportChange: () => void;
};

export function useTerminalViewport({
  anchorRef,
  onViewportChange,
}: UseTerminalViewportParams) {
  useEffect(() => {
    const pageElement = anchorRef.current?.closest<HTMLElement>('.terminal-page');
    const visualViewport = window.visualViewport;
    if (!pageElement || !visualViewport) return;

    let resizeFrame = 0;
    const updateVisualViewport = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        pageElement.style.setProperty(
          '--terminal-visual-viewport-top',
          `${visualViewport.offsetTop}px`
        );
        pageElement.style.setProperty(
          '--terminal-visual-viewport-height',
          `${visualViewport.height}px`
        );
        pageElement.style.setProperty(
          '--terminal-visual-viewport-width',
          `${visualViewport.width}px`
        );
        onViewportChange();
      });
    };

    updateVisualViewport();
    visualViewport.addEventListener('resize', updateVisualViewport);
    visualViewport.addEventListener('scroll', updateVisualViewport);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      visualViewport.removeEventListener('resize', updateVisualViewport);
      visualViewport.removeEventListener('scroll', updateVisualViewport);
      pageElement.style.removeProperty('--terminal-visual-viewport-top');
      pageElement.style.removeProperty('--terminal-visual-viewport-height');
      pageElement.style.removeProperty('--terminal-visual-viewport-width');
    };
  }, [anchorRef, onViewportChange]);
}
