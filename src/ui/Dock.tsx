import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heatOf } from '../audio/feedback';
import { formatCredits, formatMult, parseCredits, parseMult, payout } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';
import { useHold } from './hold';
import { IconMinus, IconPlus } from './icons';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nice stake ladder for the − / + steppers. */
const LADDER = [10, 20, 50, 100, 200, 250, 500, 1000, 1500, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000];

export function Dock() {
  const phase = useStore((s) => s.phase);
  const hold = useHold();
  const ctl = useCtl();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ctl) return;
    const report = () => {
      // The covered band runs from the highest thing the dock draws: the plate, or the crest
      // that rides above the live plate. Layout boxes, not transforms (the entrance slides in).
      let top = el.getBoundingClientRect().top;
      const crest = el.querySelector('.crest');
      if (crest) top = Math.min(top, crest.getBoundingClientRect().top);
      // From above: the top bar, and during a run the multiplier block under it, so the runner is
      // framed below the figure rather than behind it.
      let bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const hud = document.querySelector('.hud');
      if (hud) bar = Math.max(bar, hud.getBoundingClientRect().bottom);
      ctl.game.rig.setInsets(bar, window.innerHeight - top, window.innerHeight);
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
  }, [ctl, phase, hold]);
  if (phase === 'title' || phase === 'loading') return null;
  // While a settled round is held on screen, the plate stays (frozen at the outcome).
  const live = phase === 'lead' || phase === 'running' || phase === 'cashing' || (phase === 'result' && hold);
  return (
    <div className={`dock${live ? ' live' : ''}`} ref={ref}>
      {live ? <CashOut held={phase === 'result'} /> : <Setup />}
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
              <button className="btn btn-cta cta-sun run-btn" onClick={() => void ctl?.refill()} onMouseEnter={() => ctl?.audio.ui('hover')}>
                <span className="btn-label word">Refill</span>
                <small className="btn-sub">Demo credits</small>
              </button>
            ) : (
              <button
                className={`btn btn-cta cta-go run-btn${busy ? ' busy' : ''}${won ? ' won' : ''}`}
                onClick={() => void ctl?.run()}
                onMouseEnter={() => ctl?.audio.ui('hover')}
                disabled={s.stake > s.balance}
                aria-busy={busy}
                aria-label={busy ? 'Placing your stake' : `${s.phase === 'result' ? 'Run again' : 'Run'} with a stake of ${formatCredits(s.stake)}`}
              >
                {/* One gold slab, one word-mark; the stake is read from the stepper above it. */}
                <span className="btn-label word">
                  {busy && <span className="spinner" aria-hidden />}
                  {busy ? 'Placing' : s.phase === 'result' ? 'Run again' : 'Run'}
                </span>
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

function CashOut({ held }: { held: boolean }) {
  const phase = useStore((s) => s.phase);
  const live = useStore((s) => s.live);
  const result = useStore((s) => s.result);
  const ctl = useCtl();
  const amtRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ctl) return;
    let raf = 0;
    let lastHeat = -1;
    let lastText = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // Settled and held: the plate is frozen at the outcome (written by React below).
      if (useStore.getState().phase === 'result') return;
      const el = amtRef.current;
      if (el) {
        const text = formatCredits(ctl.currentReturn());
        if (text !== lastText) {
          el.textContent = text;
          // The figure steps down a size as it grows a digit, so it always fits the plate.
          if (text.length !== lastText.length) el.dataset.len = String(text.length);
          lastText = text;
        }
      }
      // The stone's heat follows the multiplier, on the same curve as the HUD figure.
      const heat = heatOf(ctl.currentMult());
      if (btnRef.current && Math.abs(heat - lastHeat) > 0.004) {
        btnRef.current.style.setProperty('--heat', heat.toFixed(3));
        lastHeat = heat;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ctl]);
  const round = held ? result?.round : undefined;
  const won = held && !!result?.won;
  const stake = live?.stake ?? round?.stake ?? 0;
  const auto = live?.autoCashout ?? null;
  const lead = phase === 'lead';
  const label = held ? (won ? 'Secured' : 'Fallen') : lead ? 'Get set' : phase === 'cashing' ? 'Securing' : 'Cash out';
  const amount = held ? formatCredits(won ? (round?.payout ?? 0) : 0) : formatCredits(stake);
  // The live figure is written by the frame loop (it owns the text node); the held one is set here.
  useEffect(() => {
    const el = amtRef.current;
    if (!held || !el) return;
    el.textContent = amount;
    el.dataset.len = String(amount.length);
  }, [held, amount]);
  return (
    <>
      <button
        ref={btnRef}
        className={`btn btn-cta cash${lead ? ' lead' : ''}${phase === 'cashing' || won ? ' pressed' : ''}${held ? (won ? ' held won' : ' held fell') : ''}`}
        onPointerDown={(e) => {
          // Pointer-down, not click: the tap is the decision.
          if (e.button === 0) void ctl?.cashout();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void ctl?.cashout();
        }}
        aria-disabled={lead || held}
        aria-label={held ? label : 'Cash out'}
      >
        {/* The stone heats: ember seams open in the panel as --heat climbs, the crest's ruby kindles. */}
        <span className="heat hot" aria-hidden />
        <span className="heat glow" aria-hidden />
        <span className="crest" aria-hidden />
        <span className="pendant" aria-hidden />
        <span className="label">
          <span className="btn-label gold">{label}</span>
          {/* the stake lives inside the plate: nothing orphaned in the home-indicator zone */}
          <small>
            Stake <b className="num">{formatCredits(stake)}</b>
            {auto !== null && (
              <>
                {' · '}auto <b className="num">{formatMult(auto)}×</b>
              </>
            )}
          </small>
        </span>
        <span className="amt num" ref={amtRef} data-len={amount.length}>
          {amount}
        </span>
      </button>
      <div className="cash-meta kbd-hint">
        Press <kbd>Space</kbd> to cash out
      </div>
    </>
  );
}
