'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function MotionScope({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const container = root.current;
      if (!container) return;
      const onHover = (event: PointerEvent) => {
        const image = (event.target as Element).closest<HTMLElement>('[data-motion-image]');
        if (image && container.contains(image)) gsap.to(image, { scale: 1.035, duration: .35, overwrite: 'auto', ease: 'power2.out' });
      };
      const onLeave = (event: PointerEvent) => {
        const image = (event.target as Element).closest<HTMLElement>('[data-motion-image]');
        if (image && container.contains(image) && !image.contains(event.relatedTarget as Node | null)) gsap.to(image, { scale: 1, duration: .35, overwrite: 'auto', ease: 'power2.out' });
      };
      container.addEventListener('pointerover', onHover);
      container.addEventListener('pointerout', onLeave);
      gsap.utils.toArray<HTMLElement>('[data-motion-intro]', container).forEach(element => {
        gsap.fromTo(element, { y: 8 }, { y: 0, duration: .5, ease: 'power2.out', scrollTrigger: { trigger: element, start: 'top 95%', once: true } });
      });
      return () => {
        container.removeEventListener('pointerover', onHover);
        container.removeEventListener('pointerout', onLeave);
      };
    });
    return () => media.revert();
  }, { scope: root });
  return <div ref={root} className="contents">{children}</div>;
}
