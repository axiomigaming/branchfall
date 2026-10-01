import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { countUp, heatOf, milestoneCrossed, milestoneLabel, tierOf } from '../audio/feedback';
import { formatCredits, formatMult } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';
import './hud.css';

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * The multiplier. Written straight to the DOM every frame; React only mounts it.
 * The number is always the server's (`ctl.currentMult()` → `formatMult`); the
 * glow, the digit roll and the milestone flares only dress it.
 */
export function Hud() {
  const phase = useStore((s) => s.phase);
  const live = useStore((s) => s.live);
  const motion = useStore((s) => s.settings.motion);
  const ctl = useCtl();
  const multRef = useRef<HTMLDivElement>(null);
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const retRef = useRef<HTMLElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  // Survives the effect restarting on phase changes within one round.
  const prev = useRef<{ id: string | null; m: number }>({ id: null, m: 100 });

  useEffect(() => {
    if (!ctl) return;
    const full = motion === 'full';
    let raf = 0;
    let lastInt = '';
    let lastFrac = '';
    let lastHeat = -1;
    let lastTier = -1;
    let lastEl: HTMLDivElement | null = null;
    const flare = (i: number) => {
      ctl.audio.milestone(i);
      ctl.buzz('milestone');
      const f = flareRef.current;
      if (f) {
        f.textContent = milestoneLabel(i);
        f.animate(
          full
            ? [
                { opacity: 0, letterSpacing: '0.02em', transform: 'translateY(6px) scale(0.9)' },
                { opacity: 1, letterSpacing: '0.12em', transform: 'none', offset: 0.18 },
                { opacity: 1, letterSpacing: '0.16em', offset: 0.7 },
                { opacity: 0, letterSpacing: '0.2em' },
              ]
            : [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
          { duration: 1700, easing: 'ease-out', fill: 'both' },
        );
      }
      if (!full) return;
      ringRef.current?.animate(
        [
          { opacity: 0.85, transform: 'translate(-50%, -50%) scale(0.55)' },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.65)' },
        ],
        { duration: 1100, easing: EASE },
      );
      glowRef.current?.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.07)', filter: 'brightness(1.4)', offset: 0.2 }, { transform: 'scale(1)', filter: 'brightness(1)' }], {
        duration: 900,
        easing: EASE,
      });
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useStore.getState();
      const id = st.live?.id ?? null;
      if (id !== prev.current.id) prev.current = { id, m: 100 };
      const m = ctl.currentMult();
      if (st.phase === 'running') ctl.audio.climb(m);
      const el = multRef.current;
      if (!el) return;
      if (el !== lastEl) {
        // A fresh HUD (new round): forget what the old one showed.
        lastEl = el;
        lastInt = '';
        lastFrac = '';
        lastHeat = -1;
        lastTier = -1;
      }
      const text = formatMult(m);
      const dot = text.lastIndexOf('.');
      const int = text.slice(0, dot);
      const frac = text.slice(dot);
      if (int !== lastInt && intRef.current) {
        // A short roll on each new whole number (not on the first paint).
        if (full && lastInt !== '') intRef.current.animate([{ transform: 'translateY(0.14em)', opacity: 0.55 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE });
        intRef.current.textContent = int;
        lastInt = int;
      }
      if (frac !== lastFrac && fracRef.current) {
        fracRef.current.textContent = frac;
        lastFrac = frac;
      }
      const heat = heatOf(m);
      if (Math.abs(heat - lastHeat) > 0.004) {
        el.style.setProperty('--heat', heat.toFixed(3));
        lastHeat = heat;
      }
      const tier = tierOf(m);
      if (tier !== lastTier) {
        el.dataset.tier = String(tier);
        lastTier = tier;
      }
      if (retRef.current) retRef.current.textContent = formatCredits(ctl.currentReturn());
      if (st.phase === 'running' && m > prev.current.m) {
        const hit = milestoneCrossed(prev.current.m, m);
        if (hit >= 0) flare(hit);
      }
      if (st.phase === 'running' || st.phase === 'cashing') prev.current.m = Math.max(prev.current.m, m);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ctl, motion]);

  if (!live || !(phase === 'lead' || phase === 'running' || phase === 'cashing')) return null;
  return (
    <div className={`hud ${phase}`} aria-live="off">
      <div className="hud-slot">
        {phase === 'lead' ? <span className="getready">Get ready</span> : <span className="flare gold" ref={flareRef} aria-hidden="true" />}
      </div>
      <div className="mult-wrap">
        <div className="ring" ref={ringRef} aria-hidden="true" />
        <div ref={multRef} className="mult num" data-tier="0" role="timer" aria-label="Current multiplier">
          <div className="mult-glow" ref={glowRef}>
            <span className="mi" ref={intRef}>
              1
            </span>
            <span className="mf" ref={fracRef}>
              .00
            </span>
            <span className="x">×</span>
          </div>
        </div>
      </div>
      <div className="hud-sub">
        <span>
          Stake<b className="num">{formatCredits(live.stake)}</b>
        </span>
        <span className="ret">
          Return<b className="num" ref={retRef}>{formatCredits(live.stake)}</b>
        </span>
        {live.autoCashout !== null && (
          <span className="auto">
            Auto<b className="num">{formatMult(live.autoCashout)}×</b>
          </span>
        )}
      </div>
    </div>
  );
}

/** The settled round: an escape you can feel, or a fall you can read — then proof. */
export function ResultPlate() {
  const phase = useStore((s) => s.phase);
  const result = useStore((s) => s.result);
  const set = useStore((s) => s.set);
  if (phase !== 'result' || !result) return null;
  const r = result.round;
  const verify = (
    <button className="verify" onClick={() => set({ modal: 'fair', fairFocus: r.id })}>
      Verify this run
    </button>
  );
  if (result.won) return <WonPlate key={r.id} stake={r.stake} payout={r.payout} mult={r.cashoutMult ?? 100} auto={r.auto} verify={verify} />;
  const m = `${formatMult(r.crash)}×`;
  return (
    <div className="result lost" role="status" key={r.id} data-grade={tierOf(r.crash)}>
      <div className="hud-slot">
        <span className="stamp fell">
          <b className="gold">The way fell</b>
        </span>
      </div>
      <div className="big num crack" aria-label={m} style={{ '--chars': m.length } as CSSProperties}>
        <span className="half a" aria-hidden="true">
          {m}
        </span>
        <span className="half b" aria-hidden="true">
          {m}
        </span>
        <svg className="fault" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="-2,63 14,52 27,58 39,47 52,56 63,43 76,51 88,40 102,45" />
        </svg>
      </div>
      <div className="line">
        Stake lost · <b className="num">{formatCredits(r.stake)}</b>
      </div>
      {verify}
    </div>
  );
}

function WonPlate({ stake, payout, mult, auto, verify }: { stake: number; payout: number; mult: number; auto: boolean; verify: ReactNode }) {
  const ctl = useCtl();
  const motion = useStore((s) => s.settings.motion);
  const bigRef = useRef<HTMLSpanElement>(null);
  const profit = payout - stake;
  // Scaled by the multiplier the player left at: a 1.2x escape is modest, a 50x one is grand.
  const grade = tierOf(mult);

  useEffect(() => {
    const el = bigRef.current;
    const stampT = setTimeout(() => ctl?.audio.ui('stamp'), motion === 'full' ? 520 : 0);
    if (!el || motion !== 'full') return () => clearTimeout(stampT);
    // Count from the stake up to the payout; lands exactly on the settled amount.
    const t0 = performance.now();
    const dur = 600 + grade * 260;
    let raf = 0;
    const step = () => {
      const k = (performance.now() - t0) / dur;
      el.textContent = `+${formatCredits(countUp(stake, payout, k))}`;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    step();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stampT);
    };
  }, [ctl, motion, payout, stake, grade]);

  return (
    <div className="result won" role="status" data-grade={grade}>
      <span className="sr">
        Escaped at {formatMult(mult)}×. Paid {formatCredits(payout)}, profit {formatCredits(profit)}.
      </span>
      <div className="hud-slot" aria-hidden="true">
        <span className="stamp"><b className="gold">Escaped</b></span>
        {auto && <span className="stamp-note">auto cash-out</span>}
      </div>
      <div className="big num" aria-hidden="true" style={{ '--chars': formatCredits(payout).length + 1 } as CSSProperties}>
        <span className="halo" />
        {grade >= 3 && <span className="halo h2" />}
        <span className="payout-fig" ref={bigRef}>
          +{formatCredits(payout)}
        </span>
      </div>
      <div className="line" aria-hidden="true">
        at <b className="num hot">{formatMult(mult)}×</b>
        <i className="dot">·</i>
        stake <b className="num">{formatCredits(stake)}</b>
        <i className="dot">·</i>
        profit <b className="num jade">{formatCredits(profit, { sign: true })}</b>
      </div>
      {verify}
    </div>
  );
}
