'use client';

import { useSyncExternalStore } from 'react';

// Global, SSR-safe store for the currently active school id. Backed by
// localStorage rather than React Context: there is exactly one writer
// (School setup) and many independent readers across routes, and
// useSyncExternalStore already gives cross-component sync via the listener
// set below without needing a Provider mounted near the root.

const SCHOOL_STORAGE_KEY = 'ruzivo:current-school-id';

const schoolIdListeners = new Set<() => void>();

function subscribeToSchoolId(callback: () => void) {
  schoolIdListeners.add(callback);
  return () => schoolIdListeners.delete(callback);
}

function getSchoolIdSnapshot() {
  return window.localStorage.getItem(SCHOOL_STORAGE_KEY);
}

// Server never has a stored school, so this must match the client's first render.
function getSchoolIdServerSnapshot() {
  return null;
}

function setStoredSchoolId(value: string | null) {
  if (value) window.localStorage.setItem(SCHOOL_STORAGE_KEY, value);
  else window.localStorage.removeItem(SCHOOL_STORAGE_KEY);
  schoolIdListeners.forEach((listener) => listener());
}

export function useCurrentSchoolId() {
  const schoolId = useSyncExternalStore(subscribeToSchoolId, getSchoolIdSnapshot, getSchoolIdServerSnapshot);
  return { schoolId, setSchoolId: setStoredSchoolId };
}
