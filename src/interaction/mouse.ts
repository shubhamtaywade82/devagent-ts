/**
 * SGR mouse-reporting escape sequences (scroll wheel, click) — e.g.
 * `\x1b[<64;80;34M`. Ink has no built-in mouse support, so these arrive at
 * every useInput consumer as literal, unrecognized "typed" characters.
 * Any free-text input (prompt, picker search query) must ignore matches
 * instead of appending them as real text.
 */
// eslint-disable-next-line no-control-regex
export const MOUSE_SGR_PATTERN = /\x1b?\[<\d+;\d+;\d+[Mm]/;
