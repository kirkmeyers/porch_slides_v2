// The Porch's themes. Each names a ProPresenter theme file (a folder here with
// a straight copy of the theme's `Theme` file as Theme.bin) and which template
// slide and text boxes each kind of slide uses. Text box positions, sizes,
// fonts, alignment and colors are read from the theme file itself.
//
// Text boxes are picked by name, or by position among the slide's text boxes
// (0, 1, ...) where the theme left them unnamed.

// PostScript names used in the themes' RTF -> web fonts bundled in src/fonts
const FONTS = {
  'NHaasGroteskDSPro-55Rg': { family: 'Neue Haas Grotesk Display Pro', weight: 400 },
  'IBMPlexMono-Light': { family: 'IBM Plex Mono', weight: 300 },
  IBMPlexMono: { family: 'IBM Plex Mono', weight: 400 },
  'IBMPlexMono-Medium': { family: 'IBM Plex Mono', weight: 500 },
};

// porch_slides fills every scripture block to 9 lines
const SCRIPTURE_LINES = 9;

export const THEME_CONFIGS = [
  {
    // Generic Porch look: light text, mono reference, divider. The 4K copies of
    // the "One Off Center" slides live in the _Porch Awaken theme file (the
    // _Porch Generic file has them at 1920×1080).
    id: 'porch-generic',
    name: 'Porch Generic',
    fileWord: 'Porch',
    file: 'porch-generic',
    fonts: FONTS,
    dark: false,
    layouts: {
      scripture: { slide: 'One Off Center Scripture -KM', text: 'Bible Text', reference: 'Reference', maxLines: SCRIPTURE_LINES },
      quote: { slide: 'One Off Center Quote', text: 1, reference: 0 },
      point: { slide: 'One Off Center Point' },
    },
  },
  {
    // Lover's Series (_Porch Series): black text for a light background
    id: 'lovers-series',
    name: 'Lover’s Series',
    fileWord: 'Lovers',
    file: 'lovers',
    fonts: FONTS,
    dark: true,
    layouts: {
      scripture: { slide: "Lover's Scripture", text: 'Bible Text', reference: 'Reference', maxLines: SCRIPTURE_LINES },
      quote: { slide: 'Lovers Quote', text: 1, reference: 0 },
      point: { slide: 'Lovers Point' },
    },
  },
  {
    // The Inner Life has no ProPresenter theme file yet. It uses the Lover's
    // slides moved to porch_slides' Inner Life positions: the reference right
    // of center and right-aligned, a wider text column, sentence-case points.
    id: 'inner-life',
    name: 'The Inner Life',
    fileWord: 'Inner_Life',
    file: 'lovers',
    fonts: FONTS,
    dark: true,
    sentenceCasePoints: true,
    layouts: {
      scripture: {
        slide: "Lover's Scripture",
        text: 'Bible Text',
        reference: 'Reference',
        maxLines: SCRIPTURE_LINES,
        adjust: {
          text: { bounds: { x: 1358, y: 424, w: 2111, h: 908 } },
          reference: { bounds: { x: 330, y: 690, w: 821, h: 371 }, align: 'right' },
          shapes: [{ bounds: { x: 1250, y: 469, w: 8, h: 818 } }],
        },
      },
      quote: {
        slide: 'Lovers Quote',
        text: 1,
        reference: 0,
        adjust: {
          text: { bounds: { x: 612, y: 518, w: 2615, h: 585 } },
          reference: { bounds: { x: 1009, y: 1114, w: 1822, h: 105 } },
        },
      },
      point: {
        slide: 'Lovers Point',
        adjust: { text: { bounds: { x: 480, y: 326, w: 2880, h: 1100 }, caps: false } },
      },
    },
  },
];
