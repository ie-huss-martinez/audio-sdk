"use client";

import { useEffect, useState } from "react";

/** Marks the page once React has hydrated it, for the end-to-end tests. */
export function Hydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? <span data-hydrated hidden /> : null;
}
