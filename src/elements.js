/**
 * Rewrite parts of a theme element in place, at the protobuf level: its
 * bounds, and its text box's alignment, capitalization and base color.
 *
 * Used for the Inner Life layouts (made from the Lover's template slides with
 * the Inner Life positions) and for poetry, which is set left-aligned in the
 * theme's justified scripture box.
 *
 * Field numbers (schema-less):
 *   Slide.Element      1 Graphics.Element
 *   Graphics.Element   3 bounds { 1 origin { 1 x, 2 y }, 2 size { 1 w, 2 h } }, 13 Text
 *   Text               3 attributes, 5 RTF
 *   Text.attributes    2 capitalization (1 all caps), 3 color { 1 r, 2 g, 3 b, 4 a },
 *                      6 paragraph style { 1 alignment },
 *                      13 per-range attributes { 1 range { 1 location, 2 length }, 2 capitalization, … }
 */

import { decode, encode, get, getMessage, setField, messageField, varintField, doubleField, floatField, asInt } from './protobuf.js';

const encoder = new TextEncoder();

// NSTextAlignment, as ProPresenter stores it
const ALIGNMENT = { left: 0, right: 1, center: 2, justify: 3 };
const RTF_ALIGN = { left: '\\ql', right: '\\qr', center: '\\qc', justify: '\\qj' };

/** Set the paragraph alignment of a Cocoa RTF string. */
export function setRtfAlign(rtf, align) {
  const at = rtf.indexOf('\\partightenfactor0');
  if (at < 0) return rtf;
  const pardAt = rtf.lastIndexOf('\\pard', at);
  const head = rtf.slice(0, pardAt);
  let pard = rtf.slice(pardAt, at).replace(/\\q[lcrj](?![a-z])/g, '');
  pard += RTF_ALIGN[align] || '';
  return head + pard + rtf.slice(at);
}

/**
 * @param raw     Slide.Element bytes
 * @param change  { bounds?, align?, caps?, rtf?, opaque?, dropRanges?, length? }
 *   rtf        new RTF text for the text box
 *   opaque     make the box's default text color fully opaque (the RTF sets the real colors)
 *   dropRanges remove per-range attributes copied from the template's sample text
 *   length     the new text's length (UTF-16), for the all-caps range that replaces them
 * @returns new Slide.Element bytes
 */
export function rewriteElement(raw, change) {
  let se = decode(raw);
  let el = decode(get(se, 1).value);

  if (change.bounds) {
    const { x, y, w, h } = change.bounds;
    el = setField(el, messageField(3, [
      messageField(1, [doubleField(1, x), doubleField(2, y)]),
      messageField(2, [doubleField(1, w), doubleField(2, h)]),
    ]));
  }

  const textF = get(el, 13);
  if (textF && (change.rtf != null || change.align || change.caps != null || change.opaque || change.dropRanges)) {
    let text = decode(textF.value);
    if (change.rtf != null) text = setField(text, { field: 5, wire: 2, value: encoder.encode(change.rtf) });
    const attrsF = get(text, 3);
    if (attrsF) {
      let attrs = decode(attrsF.value);
      if (change.caps != null) attrs = setField(attrs, varintField(2, change.caps ? 1 : 0));
      if (change.align) {
        const para = getMessage(attrs, 6) || [];
        attrs = setField(attrs, messageField(6, setField(para, varintField(1, ALIGNMENT[change.align]))));
      }
      if (change.opaque) {
        const color = getMessage(attrs, 3);
        if (color) attrs = setField(attrs, messageField(3, setField(color, floatField(4, 1))));
      }
      if (change.dropRanges) {
        attrs = attrs.filter(f => f.field !== 13);
        // ProPresenter shows all caps only over a capitalization range, not from the box setting alone
        const caps = get(attrs, 2);
        if (caps && asInt(caps) === 1 && change.length) {
          attrs.push(messageField(13, [messageField(1, [varintField(2, change.length)]), varintField(2, 1)]));
        }
      }
      text = setField(text, messageField(3, attrs));
    }
    el = setField(el, messageField(13, text));
  }

  se = setField(se, messageField(1, el));
  return encode(se);
}
