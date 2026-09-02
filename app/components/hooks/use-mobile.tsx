import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    // Deferred to a microtask rather than called synchronously here — see
    // react-hooks/set-state-in-effect; the effect body should only
    // subscribe, with state sync happening in a callback.
    queueMicrotask(onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
