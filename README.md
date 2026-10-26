# Porch Slides

A browser tool that turns The Porch's sermon slide requests into finished ProPresenter slides, with live, editable text on the series theme's own slides.

It's the second version of [porch_slides](https://github.com/kirkmeyers/porch_slides), rebuilt on the design of Sunday Slides: the layouts come from the ProPresenter theme file itself, you type right on the slide as in ProPresenter, and the export is a `.probundle` with live text instead of PNGs. The Porch's request format and scripture style carry over from porch_slides. It runs alongside porch_slides; nothing about the old tool changes.

Vite, fully client-side, hosted on GitHub Pages.

## Features

- **Three ways to load requests:** the Load requests button, dragging the `.txt` onto the page, or a `#outline=` link (same encoding as porch_slides).
- **Scripture the Porch way:** one slide per verse read. Each slide shows a block of verses filled to nine lines, with the verse being read at full strength and the context verses around it dimmed. The block stays put while the highlight moves down it, and a new block starts (keeping up to two verses already read above) when the next verse would run out of context. A block always starts on a whole verse, and the last verse can be cut short to fill the last line. A single-verse request gets up to two verses of context above it (Settings: 2, 1 or none).
- **Verse numbers** are superscript, written the way ProPresenter writes them, so they stay superscript after import.
- **Poetry:** Job, Psalms, Proverbs, Song of Solomon and Lamentations are broken at their pauses (semicolons and colons, then conjunctions, then a long line's middle comma) and set flush left. Well-known poems inside prose books (Isaiah 6:3, the Magnificat, Philippians 2:6-11 and others) are set in their lines too.
- **Translations:** a translation named on the request line (`Romans 8:18 (NIV)`) or in `# translation:` is used; Bolls supplies the text. In the editor, the Translation picker (ESV, KJV, NIV, NIV 84, NASB, NASB 1995, NLT, ASV, CSB, the same list as porch_slides) switches the whole passage. Bolls doesn't carry the NIV, so NIV passages take pasted verses (one per line, starting with the verse number) or text typed on the slide.
- **Points and quotes:** points are balanced over their lines. Quotes go in quotation marks with the author below. The Inner Life sets points in sentence case, keeping capitals on names for God.
- **Warnings where the operator sees them:** verse text that came from the request file or was pasted in, verses that still need text, text too tall for the box, and request lines the tool didn't understand. These are listed in the left panel and badged on each slide. The editor shows each slide's line count against the box's limit.
- **Grid and editor:** in the grid, click to select, use the arrow keys to move, drag to reorder, press Delete to remove the selected slide (⌘Z undoes it), and double-click or press Enter to open a slide. In the editor, type directly on the slide as in ProPresenter. Enter adds a line break, Option+Enter splits the slide at the cursor, and Dim / undim (⌘D) dims the selected words. The context buttons add or remove a verse above or below. Esc goes back to the grid. You can also merge, delete, and add blank slides.
- **Slide notes** for the confidence monitor, as porch_slides writes them ("Mark 9:10 - So they kept the matter…", the quote and author, or the point), plus any notes you add.
- **Exports:**
  - **ProPresenter bundle** (`YYYYMMDD - Porch - LastName.probundle`): live text built from the theme's template slides, starting with the five intro blanks (the third labeled "Porch Live Locations - Confidence ONLY") and ending with a blank.
  - **Transparent PNGs** at 3840×2160, one at a time (`YYYYMMDD - Porch - LastName - mark_9_10.png`) or all as a ZIP (`001_mark_9_9.png`, …).
- **Review link** (`#review=`): the whole deck in a link, for a communicator or producer to look over.
- **Proof sheet:** a printable list of every slide, its notes and its warnings.

## Quick start

```bash
npm install
npm run dev
```

Open the address Vite prints, then click **Load sample**.

```bash
npm test         # request parsing, the scripture block, markup, themes and export
npm run build    # production build in dist/
```

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys the site on every push to `main`.

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`.

`vite.config.js` sets `base: './'`, so the site works under the repository's Pages path.

## The request file

The same format as porch_slides: plain UTF-8 text, one slide request per line, with optional settings lines at the top. [reference/sample-requests.txt](reference/sample-requests.txt) is an example.

```text
# theme: porch-generic        porch-generic | lovers-series | inner-life
# translation: ESV
# communicator: Jane Smith    last name goes in the file names
# title: Idolatry Week 7      shown in the tool only
# date: 2026-10-27            for file names (new; defaults to today)
Slide 1: Mark 9:9-13 (ESV)
Slide 2: Romans 8:18 (NIV)
> 18 For I consider that our present sufferings…
Slide 3: Theology of Suffering
Slide 4: Charles Spurgeon – "I have learned to kiss the wave that throws me against the Rock of Ages."
```

- A line with a book, chapter and verses is scripture: `Mark 9:9-13`, `Psalm 46:1-3`, `Luke 1:46; 48` and so on. Back-to-back requests from the same chapter (`Mark 9:9-10`, then `Mark 9:11`) become one passage.
- `>` lines right after a scripture line give its verse text, one verse per line with its number. That text is used instead of Bolls, and the slide is flagged to check it.
- `Author – quote` (with spaces around the dash) is a quote. `"Quote" – Author` works too.
- Anything else is a point.
- Cross-chapter ranges (`John 3:36-4:2`) aren't supported; request each chapter on its own line.

### Opening from a link

`#outline=<payload>` carries a request file, zipped (DEFLATE, one file named `d`) and URL-safe base64 encoded without padding, exactly as porch_slides does; the Node example in the [porch_slides README](https://github.com/kirkmeyers/porch_slides#4-load-from-link-outlinepayload) works unchanged when pointed at this site's URL. In the browser console, `await encodeOutlineLink(text)` builds one.

## Using the output in ProPresenter

1. Click **ProPresenter bundle** and copy the `.probundle` to the Pro machine.
2. Double-click it, or drag it into ProPresenter, to import the presentation.
3. Each slide uses the theme's text boxes, so the text stays editable in ProPresenter. Each scripture passage, point and quote is its own group, and each slide's notes carry what's on it for the confidence monitor.

## Themes

Theme layouts are in [src/themes/configs.js](src/themes/configs.js). Each names a ProPresenter theme file (copied into `src/themes/<folder>/Theme.bin`) and which template slide and text boxes each kind of slide uses. Text box positions, sizes, fonts, alignment and colors are read from the theme file.

- **Porch Generic** uses the "One Off Center" Scripture, Point and Quote slides. Their 4K versions are in the `_Porch Awaken` theme file (the `_Porch Generic` file has them at 1920×1080), so that's the file copied here.
- **Lover's Series** uses the `_Porch Series` theme's Lover's slides (black text).
- **The Inner Life** has no ProPresenter theme file yet. It uses the Lover's slides moved to porch_slides' Inner Life positions (reference right-aligned at the left, a wider text column, sentence-case points). When there's an Inner Life theme in ProPresenter, copy its `Theme` file in and point the config at its slides.

## Project layout

```
index.html, app.js, style.css   UI
src/requests.js                 request file parser, sentence case
src/passage.js                  the nine-line scripture block, poetry
src/slides.js                   requests -> slides, passages, points, quotes
src/bible.js                    book names, translations, Bolls API
src/layout.js                   text markup, wrapping, balancing
src/render.js                   canvas drawing for the preview and PNGs
src/inline-editor.js            typing on the slide
src/theme.js                    ProPresenter theme reader
src/elements.js                 moving and restyling theme elements
src/propresenter.js             live-text .pro / .probundle export
src/protobuf.js                 small schema-less protobuf reader/writer
src/links.js                    #outline= and #review= links
src/themes/                     theme files and layouts
src/fonts/                      slide fonts and UI fonts (Lato, Oswald)
```

## Notes

- Slide text is plain text with a little markup: `\n` for a line break, `{…}` for dimmed words, `^12^` for a verse number.
- Context verses are dimmed with true text opacity in the bundle (a fourth, alpha value in the RTF's expanded color table), the same way the Lover's template stores its own see-through sample text.
- Fonts: IBM Plex Mono is under the SIL Open Font License. Neue Haas Grotesk Display Pro is a commercial font, copied from porch_slides; check its license before this repository is made public.
- Real manuscripts and ProPresenter libraries stay out of this repository. Only the sample request file is committed.

## License

Internal tool for The Porch and Watermark Community Church.
