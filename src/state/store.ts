import { create } from 'zustand';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import type { Cents } from '../engine/money';
import type { Limits, LiveRound, SettledRound } from '../service/protocol';

export type Phase =
  | 'loading' // assets and session
  | 'title' // entry screen
  | 'setup' // choosing a stake
  | 'placing' // bet sent, waiting for acceptance
  | 'lead' // accepted; runner coiled, multiplier at 1.00x until the server's start time
  | 'running' // multiplier live
  | 'cashing' // cash-out sent
  | 'result'; // settled

export type Modal = null | 'fair' | 'settings' | 'menu' | 'how' | 'history';

export interface Result {
  round: SettledRound;
  /** Did the player leave in time? */
  won: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

interface State {
  phase: Phase;
  loading: { progress: number; label: string };
  balance: Cents;
  stake: Cents;
  autoOn: boolean;
  auto: number; // hundredths
  limits: Limits | null;
  live: LiveRound | null;
  result: Result | null;
  /**
   * Presentation only: false from settlement until the world's fall or escape has played its beat
   * (Game.onReveal), so the result card does not cover the moment. Balance, history and phase are
   * already settled while it is false.
   */
  revealed: boolean;
  history: SettledRound[];
  clientSeed: string;
  nextCommitment: string;
  nextNonce: number;
  deterministic: boolean;
  modal: Modal;
  fairFocus: string | null;
  settings: Settings;
  toasts: Toast[];
  fatal: string | null;
  set: (p: Partial<State>) => void;
  setSettings: (p: Partial<Settings>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  phase: 'loading',
  loading: { progress: 0, label: 'Unearthing the ruins' },
  balance: 0,
  stake: 1000,
  autoOn: false,
  auto: 200,
  limits: null,
  live: null,
  result: null,
  revealed: true,
  history: [],
  clientSeed: '',
  nextCommitment: '',
  nextNonce: 0,
  deterministic: false,
  modal: null,
  fairFocus: null,
  settings: loadSettings(),
  toasts: [],
  fatal: null,
  set: (p) => set(p),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    saveSettings(settings);
    set({ settings });
  },
  toast: (text, tone = 'info') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200);
  },
}));
