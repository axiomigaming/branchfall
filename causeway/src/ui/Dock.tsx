import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heatOf } from '../audio/feedback';
import { formatCredits, formatMult, parseCredits, parseMult, payout } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';
import { IconMinus, IconPlus } from './icons';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nice stake ladder for the − / + steppers. */
const LADDER = [10, 20, 50, 100, 200, 250, 500, 1000, 1500, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000];

export function Dock() {
  const phase = useStore((s) => s.phase);
  const ctl = useCtl();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ctl) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      ctl.game.rig.setInsets(top, window.innerHeight - r.top, window.innerHeight);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      ctl.game.rig.setInsets(0, 0, window.innerHeight);
    };
  }, [ctl, phase]);
  if (phase === 'title' || phase === 'loading') return null;
  const live = phase === 'lead' || phase === 'running' || phase === 'cashing';
  return (
    <div className={`dock${live ? ' live' : ''}`} ref={ref}>
      {live ? <CashOut /> : <Setup />}
    </div>
  );
}

function Setup() {
  const s = useStore();
  const ctl = useCtl();
  const limits = s.limits;
  const [text, setText] = useState(formatCredits(s.stake));
  const [autoText, setAutoText] = useState(formatMult(s.auto));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(formatCredits(s.stake));
  }, [s.stake]);

  if (!limits) return null;
  const max = Math.min(limits.maxStake, Math.max(limits.minStake, s.balance));
  const busy = s.phase === 'placing';
  const broke = s.balance < limits.minStake;

  const setStake = (v: number) => {
    const c = clamp(Math.round(v), limits.minStake, Math.max(limits.minStake, max));
    if (c !== s.stake) ctl?.audio.ui('tick');
    s.set({ stake: c });
  };
  const stepUp = () => setStake(LADDER.find((x) => x > s.stake) ?? max);
  const stepDown = () => setStake([...LADDER].reverse().find((x) => x < s.stake) ?? limits.minStake);
  const commit = () => {
    editing.current = false;
    const v = parseCredits(text);
    if (v === null) setText(formatCredits(s.stake));
    else setStake(v);
    setText(formatCredits(clamp(v ?? s.stake, limits.minStake, Math.max(limits.minStake, max))));
  };
  const commitAuto = () => {
    const v = parseMult(autoText);
    const c = v === null ? s.auto : clamp(v, limits.minAutoCashout, limits.maxMult);
    s.set({ auto: c });
    setAutoText(formatMult(c));
  };
  const target = s.autoOn ? s.auto : null;
  const won = s.phase === 'result' && !!s.result?.won;

  return (
    <>
      <div className="setup glass">
        <div className="setup-head">
          <label className="field-label" htmlFor="stake">
            Stake
          </label>
          <span className="field-note limits">
            {formatCredits(limits.minStake)} – {formatCredits(limits.maxStake)}
          </span>
          <div className={`auto${s.autoOn ? ' on' : ''}`}>
            <button
              className="toggle"
              role="switch"
              aria-checked={s.autoOn}
              aria-label="Auto cash-out"
              disabled={busy}
              onClick={() => {
                ctl?.audio.ui('tick');
                s.set({ autoOn: !s.autoOn });
              }}
            >
              <span className="switch" />
              <span className="toggle-text">
                Auto<span className="long"> cash-out</span>
              </span>
            </button>
            {s.autoOn && (
              <div className="auto-well">
                <input
                  aria-label="Auto cash-out multiplier"
                  inputMode="decimal"
                  value={autoText}
                  disabled={busy}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setAutoText(e.target.value)}
                  onBlur={commitAuto}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    e.stopPropagation();
                  }}
                />
                <span className="unit">×</span>
              </div>
            )}
          </div>
        </div>
        <div className="setup-body">
          <div className="stake-col">
            <div className="stepper">
              <button className="step" onClick={stepDown} disabled={busy || s.stake <= limits.minStake} aria-label="Lower stake">
                <IconMinus />
              </button>
              <div className="amount">
                <input
                  id="stake"
                  inputMode="decimal"
                  value={text}
                  disabled={busy}
                  onFocus={(e) => {
                    editing.current = true;
                    e.currentTarget.select();
                  }}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    e.stopPropagation();
                  }}
                  aria-describedby="stake-unit"
                />
                <span className="unit" id="stake-unit">
                  CR
                </span>
              </div>
              <button className="step" onClick={stepUp} disabled={busy || s.stake >= max} aria-label="Raise stake">
                <IconPlus />
              </button>
            </div>
            <div className="chips">
              <button className="qchip" disabled={busy} onClick={() => setStake(s.stake / 2)}>
                ½
              </button>
              <button className="qchip" disabled={busy} onClick={() => setStake(s.stake * 2)}>
                2×
              </button>
              {[500, 2500, 10000].map((v) => (
                <button key={v} className="qchip" disabled={busy || v > max} onClick={() => setStake(v)}>
                  {formatCredits(v).replace('.00', '')}
                </button>
              ))}
              <button className="qchip" disabled={busy} onClick={() => setStake(max)}>
                Max
              </button>
            </div>
          </div>
          <div className="run-cell">
            {broke ? (
              <button className="btn btn-gold run-btn" onClick={() => void ctl?.refill()} onMouseEnter={() => ctl?.audio.ui('hover')}>
                <span className="btn-label">Refill</span>
                <span className="gem-sep" aria-hidden />
                <small className="btn-sub">Demo credits</small>
              </button>
            ) : (
              <button
                className={`btn btn-gold run-btn${busy ? ' busy' : ''}${won ? ' won' : ''}`}
                onClick={() => void ctl?.run()}
                onMouseEnter={() => ctl?.audio.ui('hover')}
                disabled={s.stake > s.balance}
                aria-busy={busy}
                aria-label={busy ? 'Placing your stake' : `${s.phase === 'result' ? 'Run again' : 'Run'} with a stake of ${formatCredits(s.stake)}`}
              >
                <span className="btn-label">{busy ? 'Placing' : s.phase === 'result' ? 'Run again' : 'Run'}</span>
                <span className="gem-sep" aria-hidden />
                <small className="btn-sub num">
                  {formatCredits(s.stake)}
                  <i>CR</i>
                </small>
              </button>
            )}
          </div>
        </div>
        {target !== null && (
          <div className="field-note auto-note">
            Auto cash-out pays <b>{formatCredits(payout(s.stake, target))}</b> at {formatMult(target)}× if the way holds
          </div>
        )}
      </div>
      <div className="fine">
        Cash out any time for stake × multiplier. If the way falls first, the stake is lost. <kbd>Space</kbd> to run
      </div>
    </>
  );
}

function CashOut() {
  const phase = useStore((s) => s.phase);
  const live = useStore((s) => s.live)!;
  const ctl = useCtl();
  const amtRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ctl) return;
    let raf = 0;
    let lastHeat = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (amtRef.current) amtRef.current.textContent = formatCredits(ctl.currentReturn());
      // The plate's glow follows the multiplier, on the same curve as the HUD figure.
      const heat = heatOf(ctl.currentMult());
      if (btnRef.current && Math.abs(heat - lastHeat) > 0.004) {
        btnRef.current.style.setProperty('--heat', heat.toFixed(3));
        lastHeat = heat;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ctl]);
  const lead = phase === 'lead';
  return (
    <>
      <button
        ref={btnRef}
        className={`btn cash${lead ? ' lead' : ''}${phase === 'cashing' ? ' pressed' : ''}`}
        onPointerDown={(e) => {
          // Pointer-down, not click: the tap is the decision.
          if (e.button === 0) void ctl?.cashout();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void ctl?.cashout();
        }}
        aria-disabled={lead}
        aria-label="Cash out"
      >
        <span className="aura" aria-hidden />
        <span className="label">
          <span className="btn-label">{lead ? 'Get set' : phase === 'cashing' ? 'Securing' : 'Cash out'}</span>
          <small>{lead ? 'The run starts in a moment' : phase === 'cashing' ? 'Taking the return' : 'Take the return now'}</small>
        </span>
        <span className="amt num" ref={amtRef}>
          {formatCredits(live.stake)}
        </span>
      </button>
      <div className="cash-meta">
        <span>
          Stake <b>{formatCredits(live.stake)}</b>
        </span>
        {live.autoCashout ? (
          <span>
            Auto at <b>{formatMult(live.autoCashout)}×</b>
          </span>
        ) : (
          <span className="kbd-hint">
            Press <kbd>Space</kbd> to cash out
          </span>
        )}
      </div>
    </>
  );
}
