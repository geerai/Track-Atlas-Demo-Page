# Track Atlas Usage Guide

## Open the demo locally

1. Keep the following files in the same directory:

   - `index.html`
   - `styles.css`
   - `app.js`
   - `data.js`

2. Open `index.html` in Safari, Chrome, Edge, or Firefox.

3. Select one of the five MIDI arrangements at the top of the page, then click **Play original tempo**. The browser synthesizes the piano, guitar, bass, drums, and melody tracks from their MIDI note events.

## Playback behavior

- Playback follows the original MIDI tempo map, including tempo changes.
- The playhead remains visible while the five synchronized tracks scroll through the note window.
- Drag the progress slider to seek to any point in the arrangement.
- If a source file contains a long silent introduction, the demo preserves no more than two seconds before the first note.

## Troubleshooting audio

If you do not hear any sound:

1. Check that the browser tab and computer are not muted.
2. Increase the volume control on the demo page.
3. Click the play button again.
4. If the browser asks for permission to play audio, allow playback.

## Notes

- The sounds are synthesized by the browser and are not studio-recorded instrument samples.
- The rhythm, note timing, and note durations come from the source MIDI files.
- The demo does not require ChatGPT or an account and does not upload MIDI files or personal data.
- To share the local version, send the entire project directory or a ZIP archive rather than `index.html` alone.
