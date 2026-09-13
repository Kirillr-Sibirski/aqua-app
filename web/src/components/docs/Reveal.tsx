'use client';

/**
 * Panels are visible at rest. Only when IntersectionObserver exists and motion is allowed does a
 * panel start slightly offset, and it settles the first time it scrolls into view.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'rest' | 'waiting' | 'in'>('rest');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    /* Anything already reached, including everything above the viewport after an anchor jump, is
       shown at once: a section scrolled past must never be left invisible. */
    const reached = () => el.getBoundingClientRect().top < window.innerHeight * 0.9;
    if (window.location.hash || reached()) {
      setState('in');
      return;
    }
    setState('waiting');
    const settle = () => {
      setState('in');
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', settle);
    };
    const onScroll = () => {
      if (reached()) settle();
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) settle();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', settle);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', settle);
    };
  }, []);

  return (
    <div ref={ref} className={className} data-reveal={state}>
      {children}
    </div>
  );
}
