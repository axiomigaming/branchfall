import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { QualityLevel } from '../config/quality';
import { verifyRound } from '../engine/fairness';
import { formatCredits, formatMult } from '../engine/money';
import { randomSeedHex } from '../engine/fairness';
import { useStore, type Modal } from '../state/store';
import { useCtl } from './context';
import { IconCheck, IconClose, IconCopy, IconDice, IconExpand } from './icons';
import { tierOf } from './TopBar';

function Sheet({ title, eyebrow, children, wide, onClose }: { title: string; eyebrow: string; children: ReactNode; wide?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="veil" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Hash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="hash">
      <span>{value || '—'}</span>
      <button
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
      </button>
    </div>
  );
}

export function Panels() {
  const modal = useStore((s) => s.modal);
  const set = useStore((s) => s.set);
  const ctl = useCtl();
  const close = () => {
    ctl?.audio.ui('close');
    set({ modal: null, fairFocus: null });
  };
  if (!modal) return null;
  const views: Record<Exclude<Modal, null>, () => ReactNode> = {
    fair: () => <Fair onClose={close} />,
    settings: () => <Settings onClose={close} />,
    menu: () => <Menu onClose={close} />,
    how: () => <How onClose={close} />,
    history: () => <History onClose={close} />,
  };
  return <>{views[modal]()}</>;
}

// ------------------------------------------------------------------ provably fair
function Fair({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const ctl = useCtl();
  const [seed, setSeed] = useState(s.clientSeed);
  const busy = s.phase === 'running' || s.phase === 'lead' || s.phase === 'cashing' || s.phase === 'placing';
  const focus = s.history.find((h) => h.id === s.fairFocus) ?? s.history[0];
  const verdict = useMemo(() => (focus ? verifyRound(focus, focus.crash) : null), [focus]);

  return (
    <Sheet title="Provably fair" eyebrow="Nothing hidden" wide onClose={onClose}>
      <div className="sect">
        <p>
          Every run's fall point is fixed <b>before</b> you press Run. We publish a fingerprint of the secret that decides it; you add a seed of your own; after the run
          we reveal the secret, and anyone can recompute the fall point from both. Nothing you do on the path — and nothing we do — can move it.
        </p>
      </div>
      <div className="sect">
        <h3>Your next run</h3>
        <div className="kv">
          <span className="k">Server commitment</span>
          <Hash value={s.nextCommitment} />
          <span className="k">Your seed</span>
          <div className="seed-row">
            <input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={busy} aria-label="Client seed" onKeyDown={(e) => e.stopPropagation()} maxLength={64} />
            <button className="icon-btn" aria-label="Random seed" disabled={busy} onClick={() => setSeed(randomSeedHex(8))}>
              <IconDice />
            </button>
            <button className="btn btn-ghost" disabled={busy || seed === s.clientSeed} onClick={() => void ctl?.setClientSeed(seed)}>
              Use
            </button>
          </div>
          <span className="k">Run number (nonce)</span>
          <span className="num" style={{ fontSize: 18 }}>
            {s.nextNonce}
          </span>
        </div>
      </div>
      <div className="sect">
        <h3>Check a finished run</h3>
        {focus ? (
          <>
            <div className="kv">
              <span className="k">Run</span>
              <select
                value={focus.id}
                onChange={(e) => s.set({ fairFocus: e.target.value })}
                style={{ background: 'rgba(0,0,0,.3)', color: 'var(--bone)', border: '1px solid var(--line-strong)', padding: '7px 8px', pointerEvents: 'auto' }}
              >
                {s.history.slice(0, 30).map((h) => (
                  <option key={h.id} value={h.id}>
                    #{h.nonce} · fell at {formatMult(h.crash)}× · {h.outcome === 'cashout' ? `you left at ${formatMult(h.cashoutMult!)}×` : 'stake lost'}
                  </option>
                ))}
              </select>
              <span className="k">Server secret (revealed)</span>
              <Hash value={focus.serverSeed} />
              <span className="k">Commitment shown before</span>
              <Hash value={focus.commitment} />
              <span className="k">Your seed · nonce</span>
              <span className="hash">
                {focus.clientSeed} · {focus.nonce}
              </span>
            </div>
            {verdict && (
              <div className={`verdict${verdict.ok ? '' : ' bad'}`}>
                <div className="ic">{verdict.ok ? <IconCheck /> : <IconClose />}</div>
                <div>
                  <div className="t">
                    {verdict.ok ? (
                      <>
                        Verified in your browser: the way was set to fall at <b className="num">{formatMult(verdict.crash)}×</b>
                      </>
                    ) : (
                      'This run does not verify.'
                    )}
                  </div>
                  <div className="s">SHA-256(secret) matches the commitment · HMAC-SHA-256(secret, seed:nonce) → fall point</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="empty">Finish a run and it appears here, ready to check.</p>
        )}
        <div className="callout">
          The fall point is <code>floor(97 · 2⁵² / (2⁵² − h))</code> hundredths, from the first 52 bits <code>h</code> of the HMAC. So the chance the way holds to any multiplier
          m is exactly 97% ÷ m: every cash-out target returns 97% on average, and no timing beats another.
          {s.deterministic ? ' This session is running on a fixed QA seed.' : ''}
        </div>
        <div className="callout" style={{ borderColor: 'var(--bone-3)', background: 'rgba(255,255,255,.03)' }}>
          Demo build: the round authority runs in a sealed worker in this browser with virtual credits. A real deployment runs the same logic on the operator's server.
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ history
function History({ onClose }: { onClose: () => void }) {
  const history = useStore((s) => s.history);
  const set = useStore((s) => s.set);
  return (
    <Sheet title="Previous runs" eyebrow="History" onClose={onClose}>
      {history.length === 0 ? (
        <p className="empty">No runs yet.</p>
      ) : (
        <div className="rows">
          {history.map((h) => (
            <button key={h.id} className="hrow" onClick={() => set({ modal: 'fair', fairFocus: h.id })}>
              <span className={`c num ${tierOf(h.crash)}`}>{formatMult(h.crash)}×</span>
              <span>
                {h.outcome === 'cashout' ? `Left at ${formatMult(h.cashoutMult!)}×${h.auto ? ' (auto)' : ''}` : 'The way fell'} · stake {formatCredits(h.stake)}
              </span>
              <span className={`out num ${h.outcome === 'cashout' ? 'won' : 'lost'}`}>{h.outcome === 'cashout' ? `+${formatCredits(h.payout)}` : `−${formatCredits(h.stake)}`}</span>
              <span className="when">#{h.nonce}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ settings
function Range({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={0} max={100} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} style={{ ['--p' as string]: `${pct}%` }} />
      <output>{pct}</output>
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const st = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const phase = useStore((s) => s.phase);
  const ctl = useCtl();
  const [fs, setFs] = useState(!!document.fullscreenElement);
  return (
    <Sheet title="Settings" eyebrow="Sound · picture · motion" onClose={onClose}>
      <div className="sect">
        <h3>Sound</h3>
        <Range label="Master" value={st.master} onChange={(v) => setSettings({ master: v })} />
        <Range label="Music" value={st.music} onChange={(v) => setSettings({ music: v })} />
        <Range label="Effects" value={st.sfx} onChange={(v) => setSettings({ sfx: v })} />
        <div className="setting-row">
          <span>Mute everything</span>
          <button className="toggle" role="switch" aria-checked={st.muted} onClick={() => setSettings({ muted: !st.muted })}>
            <span className="switch" />
          </button>
        </div>
      </div>
      <div className="sect">
        <h3>Picture</h3>
        <Seg<QualityLevel>
          label="Graphics quality"
          value={st.quality}
          options={[
            ['low', 'Low'],
            ['medium', 'Medium'],
            ['high', 'High'],
            ['ultra', 'Ultra'],
          ]}
          onChange={(v) => setSettings({ quality: v, autoQuality: false })}
        />
        <div className="setting-row">
          <span>Lower quality automatically if frames drop</span>
          <button className="toggle" role="switch" aria-checked={st.autoQuality} onClick={() => setSettings({ autoQuality: !st.autoQuality })}>
            <span className="switch" />
          </button>
        </div>
        <div className="setting-row">
          <span>Fullscreen</span>
          <button
            className="icon-btn"
            aria-label="Toggle fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen().then(() => setFs(false));
              else void document.documentElement.requestFullscreen?.().then(() => setFs(true));
            }}
            aria-pressed={fs}
          >
            <IconExpand />
          </button>
        </div>
      </div>
      <div className="sect">
        <h3>Motion</h3>
        <Seg
          label="Motion effects"
          value={st.motion}
          options={[
            ['full', 'Full motion'],
            ['reduced', 'Reduced'],
          ]}
          onChange={(v) => setSettings({ motion: v, cameraShake: v === 'full' ? st.cameraShake : false })}
        />
        <div className="setting-row">
          <span>Camera shake</span>
          <button className="toggle" role="switch" aria-checked={st.cameraShake} disabled={st.motion === 'reduced'} onClick={() => setSettings({ cameraShake: !st.cameraShake })}>
            <span className="switch" />
          </button>
        </div>
      </div>
      <div className="sect">
        <h3>Controls</h3>
        <div className="keys">
          <kbd>Space</kbd>
          <span>Run · Cash out · Run again</span>
          <kbd>Esc</kbd>
          <span>Menu (between runs) · close a panel</span>
          <kbd>M</kbd>
          <span>Mute</span>
        </div>
      </div>
      <div className="sect">
        <h3>Demo credits</h3>
        <div className="setting-row">
          <span>Restore the demo balance to 1,000.00</span>
          <button className="btn btn-ghost" disabled={phase !== 'setup' && phase !== 'result' && phase !== 'title'} onClick={() => void ctl?.refill()}>
            Refill
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ menu & how-to
function Menu({ onClose }: { onClose: () => void }) {
  const set = useStore((s) => s.set);
  const ctl = useCtl();
  return (
    <Sheet title="Paused" eyebrow="Causeway" onClose={onClose}>
      <nav className="menu">
        <button onClick={onClose}>
          Resume <span>Esc</span>
        </button>
        <button onClick={() => set({ modal: 'how' })}>
          How it works <span>The rules in a minute</span>
        </button>
        <button onClick={() => set({ modal: 'fair' })}>
          Provably fair <span>Seeds and verification</span>
        </button>
        <button onClick={() => set({ modal: 'history' })}>
          Previous runs <span>Your history</span>
        </button>
        <button onClick={() => set({ modal: 'settings' })}>
          Settings <span>Sound, picture, motion</span>
        </button>
        <button onClick={() => ctl?.toTitle()}>
          Leave to title <span>Balance is kept</span>
        </button>
      </nav>
    </Sheet>
  );
}

function How({ onClose }: { onClose: () => void }) {
  const limits = useStore((s) => s.limits);
  return (
    <Sheet title="How a run works" eyebrow="The rules" onClose={onClose}>
      <ol className="steps">
        <li>
          <div>
            <b>Choose your stake.</b>
            <span>It is taken when the run begins. Optionally set an auto cash-out multiplier.</span>
          </div>
        </li>
        <li>
          <div>
            <b>Run.</b>
            <span>The multiplier starts at 1.00× and climbs the deeper the runner goes. The ruins shake harder the higher it gets — that is atmosphere, not a warning.</span>
          </div>
        </li>
        <li>
          <div>
            <b>Cash out whenever you like.</b>
            <span>You receive stake × the multiplier at that moment. If the way falls before you cash out, the stake is lost.</span>
          </div>
        </li>
      </ol>
      <div className="callout">
        Where the way falls is decided before the run starts and cannot be read from the world — the path, the obstacles and the tremors carry no hint of it. Jumping, timing
        or watching the scenery does not change the odds. Return to player: <b>{limits?.rtpPercent ?? 97}%</b>, whenever you cash out. About 4% of runs fall at the very start.
      </div>
    </Sheet>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
