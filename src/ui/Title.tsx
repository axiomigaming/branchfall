import { useState } from 'react';
import { useStore } from '../state/store';
import { useCtl } from './context';

export function Title() {
  const phase = useStore((s) => s.phase);
  const loading = useStore((s) => s.loading);
  const fatal = useStore((s) => s.fatal);
  const limits = useStore((s) => s.limits);
  const set = useStore((s) => s.set);
  const ctl = useCtl();
  const [leaving, setLeaving] = useState(false);
  const ready = phase !== 'loading' && !!ctl;

  const enter = () => {
    if (!ctl || leaving) return;
    setLeaving(true);
    setTimeout(() => {
      ctl.enter();
      setLeaving(false);
    }, 520);
  };

  return (
    <>
      <div className="scrim-left" />
      <section className={`title${leaving ? ' leaving' : ''}`} aria-labelledby="wordmark">
        <div className="title-inner">
          <div className="eyebrow">A crash game in the sunken ruins</div>
          <h1 className="wordmark" id="wordmark">
            Causeway
          </h1>
          <div className="rule" />
          <p className="tagline">The old road is coming apart beneath you. Every step deeper raises the multiplier — leave with it before the way falls.</p>
          {fatal ? (
            <p className="tagline" role="alert" style={{ color: 'var(--ember)', marginTop: 24 }}>
              {fatal}
            </p>
          ) : ready ? (
            <div className="title-actions">
              <button className={`btn btn-cta cta-go enter-btn${leaving ? ' busy' : ''}`} onClick={enter} onMouseEnter={() => ctl?.audio.ui('hover')} autoFocus>
                <span className="btn-label">Enter the ruins</span>
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  ctl?.audio.unlock();
                  ctl?.audio.ui('open');
                  set({ modal: 'how' });
                }}
              >
                <span className="btn-label">How it works</span>
              </button>
            </div>
          ) : (
            <div className="loadbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loading.progress * 100)} aria-label="Loading">
              <div className="track">
                <div className="fill" style={{ width: `${Math.round(loading.progress * 100)}%` }} />
              </div>
              <div className="label">
                <span>{loading.label}</span>
                <span className="num">{Math.round(loading.progress * 100)}%</span>
              </div>
            </div>
          )}
        </div>
        <div className="title-foot">
          <span>
            <b>Demo credits</b> · no real money
          </span>
          <span>
            <b>{limits ? `${limits.rtpPercent}%` : '97%'}</b> return to player
          </span>
          <span>
            <b>Provably fair</b> · every run verifiable
          </span>
        </div>
      </section>
    </>
  );
}
