import { useState, useEffect } from 'react';

// 768px matches Tailwind's 'md:' breakpoint
const MOBILE_BREAKPOINT = 768;

export function useAdaptive() {
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    // We use passive: true for better performance on scroll/resize events
    window.addEventListener('resize', handleResize, { passive: true });
    
    // Initial check in case it changed between render and mount
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { isMobile, isDesktop: !isMobile };
}
