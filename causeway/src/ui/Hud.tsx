import { useEffect, useRef } from 'react';
import { formatCredits, formatMult } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';

/** The multiplier. Written straight to the DOM every frame; React only mounts it. */
export function Hud() {
  const phase = useStore((s) => s.phase);
  const live = useStore((s) => s.live);
  const ctl = useCtl();
  const multRef = useRef<HTMLDivElement>(null);
  const retRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ctl) return;
    let raf = 0;
    let lastText = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = ctl.currentMult();
      const text = formatMult(m);
      if (text !== lastText && multRef.current) {
        lastText = text;
        multRef.current.firstChild!.textContent = text;
        const tier = m >= 1000 ? 't3' : m >= 300 ? 't2' : m >= 150 ? 't1' : '';
        multRef.current.className = `mult num ${tier}${phase === 'lead' || phase === 'placing' ? ' lead' : ''}`;
        if (retRef.current) retRef.current.textContent = formatCredits(ctl.currentReturn());
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ctl, phase]);

  if (!live || !(phase === 'lead' || phase === 'running' || phase === 'cashing')) return null;
  return (
    <div className="hud" aria-live="off">
      <div ref={multRef} className="mult num" role="timer" aria-label="Current multiplier">
        <span>1.00</span>
        <span className="x">×</span>
      </div>
      {phase === 'lead' ? (
        <div className="getready">Ready</div>
      ) : (
        <div className="hud-sub">
          <span>
            Stake<b>{formatCredits(live.stake)}</b>
          </span>
          <span className="ret">
            Return<b ref={retRef}>{formatCredits(live.stake)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export function ResultPlate() {
  const phase = useStore((s) => s.phase);
  const result = useStore((s) => s.result);
  const set = useStore((s) => s.set);
  if (phase !== 'result' || !result) return null;
  const r = result.round;
  if (result.won) {
    const profit = r.payout - r.stake;
    return (
      <div className="result won" role="status">
        <div className="eyebrow">{r.auto ? 'Auto cash-out · you got out' : 'You got out'}</div>
        <div className="big num">+{formatCredits(r.payout)}</div>
        <div className="line">
          at <b>{formatMult(r.cashoutMult!)}×</b> on a <b>{formatCredits(r.stake)}</b> stake · profit <b>{formatCredits(profit)}</b>
        </div>
        <button className="verify" onClick={() => set({ modal: 'fair', fairFocus: r.id })}>
          Verify this run
        </button>
      </div>
    );
  }
  return (
    <div className="result lost" role="status">
      <div className="eyebrow">The way fell</div>
      <div className="big num">{formatMult(r.crash)}×</div>
      <div className="line">
        Stake lost · <b>{formatCredits(r.stake)}</b>
      </div>
      <button className="verify" onClick={() => set({ modal: 'fair', fairFocus: r.id })}>
        Verify this run
      </button>
    </div>
  );
}
