'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createProofFromAlert, DPI_STORAGE_KEY, mapFhirPatientToUser } from '../../lib/dpi';

const DpiContext = createContext(null);

const initialState = {
  abhaVerified: false,
  abhaPatient: null,
  proofs: [],
  summonEvents: [],
};

export function DpiProvider({ children }) {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return initialState;
    const stored = localStorage.getItem(DPI_STORAGE_KEY);
    if (!stored) return initialState;
    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem(DPI_STORAGE_KEY);
      return initialState;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(DPI_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const value = useMemo(() => ({
    ...state,
    connectAbha(patient) {
      setState((prev) => ({ ...prev, abhaVerified: true, abhaPatient: mapFhirPatientToUser(patient) }));
    },
    createProof(alert, user) {
      const proof = createProofFromAlert(alert, user || state.abhaPatient);
      setState((prev) => ({ ...prev, proofs: [proof, ...prev.proofs.filter((entry) => entry.requestId !== alert.id)] }));
      return proof;
    },
    markSummonStarted(proofId) {
      setState((prev) => ({
        ...prev,
        proofs: prev.proofs.map((proof) => proof.id === proofId ? { ...proof, summonStatus: 'triggering' } : proof),
      }));
    },
    markSummonComplete(proofId) {
      setState((prev) => {
        const proof = prev.proofs.find((entry) => entry.id === proofId);
        return {
          ...prev,
          proofs: prev.proofs.map((entry) => entry.id === proofId ? { ...entry, summonStatus: 'dispatched' } : entry),
          summonEvents: proof ? [{ id: `summon-${proofId}`, proofId, timestamp: new Date().toISOString(), message: `Regional facility dispatch confirmed for ${proof.destination}.` }, ...prev.summonEvents] : prev.summonEvents,
        };
      });
    },
    clearSession() {
      setState(initialState);
      localStorage.removeItem(DPI_STORAGE_KEY);
    },
  }), [state]);

  return <DpiContext.Provider value={value}>{children}</DpiContext.Provider>;
}

export function useDpi() {
  const context = useContext(DpiContext);
  if (!context) throw new Error('useDpi must be used within DpiProvider');
  return context;
}
