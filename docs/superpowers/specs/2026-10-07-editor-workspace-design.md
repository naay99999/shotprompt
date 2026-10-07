# ShotPrompt editor workspace redesign

Approved direction: the user chose Editor workspace and asked to start changing the project UI on 2026-10-07.

## Outcome

Make importing a video, creating short clips, adjusting framing/subtitles, and exporting feel like one coherent workflow. Keep the existing Next.js 16, React 19, Tailwind 4, Vidstack, Bun, and Elysia stack. Preserve existing API contracts and stored user media.

## Product scope

- Library: clear add-video action; compact import options revealed on demand; navigate to the created video after a successful import; existing library remains visible and scan-friendly.
- Desktop editor: bounded workspace with a clip/candidate list at left, video preview in the center, selected-clip tools at right, and a zoomable timeline below. Only lists/tools scroll; no candidate-count-driven page height.
- Narrow editor: preview, timeline, and collapsible tools reflow without horizontal page overflow. Keep all actions keyboard accessible.
- Tools: trim, frame, and subtitles are separate tabs inside the same mounted editor, preserving drafts and navigation guards. AI score details are disclosed per candidate.
- Export: an explicit toolbar action reveals settings and export history. Preserve batch selection and navigation guards, and offer exporting the active clip when no batch is selected.
- Settings: categories for AI connections, transcription/system readiness, and storage. Preserve credential consent, validation, save/test/activate, model management, and destructive-action confirmation.
- No processing-pipeline changes in this UI pass: transcription is still required by the current import backend. The UI must honestly describe this prerequisite and never promise immediate editing before processing completes.

## Visual direction

Warm charcoal surfaces with one orange accent, a restrained grid, editorial page headings, Geist for Latin text and Noto Sans Thai for Thai, and tabular time values. Minimal app-wide top navigation, real media rather than marketing imagery, consistent medium/semibold hierarchy. Avoid nested card borders and oversized explanatory text. Do not introduce placeholder partner logos, testimonials, or decorative looping text into the editor.

gpt-taste seed 173 selected Artistic Asymmetry, Geist, Inline Typography Images, Horizontal Accordions, Infinite Marquee, Scroll Pinning, and Image Scale/Fade. Adapt the visual principles to a task app: asymmetric library introduction; video thumbnails as media; expanding tool panels; persistent editor context; GSAP image/panel motion. AIDA is represented by import, media selection, editing, and export. Marketing heroes, compulsory huge section gaps, and scroll hijacking would obstruct the approved editor workflow and are intentionally omitted.

GSAP and @gsap/react provide short transform/opacity transitions after intentional interaction. Respect reduced motion; content and controls remain usable if animation is unavailable. Phosphor provides consistent icons. Preserve existing loading, empty, error, status, focus, skip-link, and retry behavior.

## Verification

Baseline: 255 tests pass with localhost access. Add behavior tests for timeline viewport math and import-result parsing only if needed; do not assert CSS class strings. Run focused tests, full bun test, workspace typecheck, production web build, and browser checks at desktop and narrow widths. Exercise library import options, clip selection, tool switching with dirty subtitles, AI list filtering, settings tabs, and export disclosure. Save screenshots for review without committing generated media.
