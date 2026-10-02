import { useStore } from '../state/store';

/**
 * The beat between a settle and the result card. Presentation only: the round is already settled
 * and paid; `revealed` stays false until the world has played the fall or the escape (see
 * State.revealed). Meanwhile the multiplier and the CASH OUT plate stay on screen, frozen at the
 * outcome, so the controls never blink out mid-moment and the card never covers the moment.
 */
export function useHold(): boolean {
  return useStore((s) => s.phase === 'result' && !!s.result && !s.revealed);
}
