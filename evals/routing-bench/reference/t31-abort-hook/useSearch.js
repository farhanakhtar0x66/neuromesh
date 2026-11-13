import { useEffect, useState } from "react";

export function useSearch(query, delay = 300) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setResults(await res.json());
      } catch (err) {
        if (err.name !== "AbortError") throw err;
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, delay]);
  return results;
}
