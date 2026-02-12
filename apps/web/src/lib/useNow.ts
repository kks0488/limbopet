import { useEffect, useState } from "react";

export function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    let id: number | null = window.setInterval(() => setNow(new Date()), 1000);
    function onVis() {
      if (document.hidden) {
        if (id !== null) { window.clearInterval(id); id = null; }
      } else {
        setNow(new Date());
        if (id === null) id = window.setInterval(() => setNow(new Date()), 1000);
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (id !== null) window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
  return now;
}
