// Thread's ink palette. Blue leads; the others mark topic groups. Inks are a
// touch dark on purpose: text is drawn slightly translucent under a grain
// overlay and a vignette, so these read at their intended weight.
// `ink` is for lines, text and icons; `wash` is a card tint, saturated enough to read as colour.
export const PALETTE = Object.freeze({
  blue: { ink: '#123f85', wash: '#dfe7f5' },
  teal: { ink: '#1b5f66', wash: '#d6ecea' },
  green: { ink: '#2c6140', wash: '#dcebd6' },
  ochre: { ink: '#8f6115', wash: '#f4e6c6' },
  terracotta: { ink: '#a3402a', wash: '#f5dbd2' },
  rose: { ink: '#963a56', wash: '#f4d9e2' },
  plum: { ink: '#5f3a72', wash: '#e7dcf1' },
  slate: { ink: '#34465e', wash: '#dfe4eb' },
});

export const PALETTE_KEYS = Object.freeze(Object.keys(PALETTE));
export const PRIMARY = 'blue';

/** Resolve a palette key (or unknown value) to colours; unknown keys fall back to blue. */
export function paletteColour(key) {
  return PALETTE[key] || PALETTE[PRIMARY];
}
