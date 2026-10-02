import { useSyncExternalStore } from 'react';
import { useStore } from '../state/store';

/**
 * The beat between a settle and the result card. Presentation only: the round is already
 * settled and paid when the hold starts; the hold just keeps the live multiplier and the
 * CASH OUT plate on screen (frozen at the outcome) so the collapse, or the escape, plays in
 * the world before the card covers it, and so the controls never blink out mid-moment.
 * Set either to 0 if the world layer sequences its own delay before the settle reaches us.
 */
export const FALL_HOLD_MS = 1000;
export const ESCAPE_HOLD_MS = 600;

let held: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

useStore.subscribe((s, prev) => {
  if (s.phase === 'result' && s.result && s.result !== prev.result) {
    const id = s.result.round.id;
    const ms = s.result.won ? ESCAPE_HOLD_MS : FALL_HOLD_MS;
    clearTimeout(timer);
    if (ms <= 0) return;
    held = id;
    emit();
    timer = setTimeout(() => {
      if (held === id) {
        held = null;
        emit();
      }
    }, ms);
  } else if (s.phase !== 'result' && held) {
    clearTimeout(timer);
    held = null;
    emit();
  }
});

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** True while a just-settled round is still being shown as live (see above). */
export function useHold(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => held !== null,
    () => false,
  );
}
