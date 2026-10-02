/**
 * The CAUSEWAY wordmark: chunky bevelled gold glyph letters (a cast lower edge, a lit top bevel,
 * a carved notch) set in its own carved stone, a temple lintel with a stepped crown seating the
 * gold crest (ruby between two emeralds). `compact` is the top-bar size; `mark` is the small
 * square cartouche with the arch, for narrow phones.
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
            {/* a lit bevel along the top of every glyph: a pale copy, a hair higher */}
            <span className="logo-hi" aria-hidden>
              Causeway
            </span>
            <span className="logo-face">Causeway</span>
          </span>
        )}
      </span>
    </span>
  );
}
