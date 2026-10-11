import { useEffect, useRef } from 'react';

/**
 * Marks an element as visible the first time it scrolls into view (sets data-visible="true"), so the
 * `.reveal` CSS transition plays once. Uses IntersectionObserver rather than scroll listeners, and shows the
 * element immediately when the observer is unavailable. Reduced motion is handled in CSS.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.dataset.visible = 'true';
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = 'true';
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}
