/**
 * The CAUSEWAY wordmark: chunky gold glyph letters with a cast edge, set in a carved limestone
 * cartouche (the hero plate's frame and recessed panel) under the gold crest with its ruby
 * and emeralds. `compact` is the top-bar size; `mark` keeps only the cartouche with the arch.
 */
export function Logo({ size = 'title' }: { size?: 'title' | 'compact' | 'mark' }) {
  return (
    <span className={`logo ${size}`}>
      <span className="logo-crest" aria-hidden />
      <span className="logo-plate">
        {size === 'mark' ? (
          <svg className="logo-arch" viewBox="0 0 24 24" aria-hidden>
            <path d="M5 21V11a7 7 0 0 1 14 0v10h-4.5v-8.5a2.5 2.5 0 0 0-5 0V21z" />
          </svg>
        ) : (
          <span className="logo-word">
            {/* the cast edge under the gold face: a darker copy, a few pixels lower */}
            <span className="logo-edge" aria-hidden>
              Causeway
            </span>
            <span className="logo-face">Causeway</span>
          </span>
        )}
      </span>
    </span>
  );
}
