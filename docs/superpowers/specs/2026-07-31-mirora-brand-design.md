# MiroraTrack Brand Identity

Date: 2026-07-31

## Approved direction

Use the original generated MiroraTrack icon source at:

`assets/branding/miroratrack-icon-1024.png`

The later three-option comparison concepts are rejected and must not be used
as product assets.

## Icon

The approved icon is a premium midnight-blue rounded-square tile containing:

- a symmetrical blue and teal mirrored form;
- a central flowing blue/gold tracking path;
- a restrained gold highlight;
- subtle dimensional gradients and clean, polished edges.

The mark communicates MiroraTrack through mirroring, direction, and financial
progress without relying on small text, currency symbols, coins, or generic
chart imagery.

The 1024×1024 RGBA source is authoritative. Tauri-generated Windows, macOS,
and application icon assets must be derived from this source without changing
its composition or palette.

## Product wordmark

Use the text `MIRORA` or `MiroraTrack` beside the approved icon only where
space permits, including the expanded sidebar, onboarding, and recovery
screens. The Windows shortcut and installer icon use the icon alone.

The wordmark uses the existing local system typography and must not introduce
a remote font dependency.

## Code-native mark

`LogoMark` should be a deterministic code-native approximation used inside
the React interface. It should echo the approved source through:

- a midnight rounded tile;
- mirrored blue/teal shapes;
- a restrained gold center/path accent.

It must remain accessible as decorative or named content according to context
and must not attempt to reproduce raster gradients pixel-for-pixel.

## Palette

- Midnight: `#0F172A`
- Professional blue: `#2563EB`
- Teal: `#0F766E`
- Gold: `#F59E0B`

Purple may remain elsewhere in the product for investments but is not required
in the approved icon.

## Acceptance

- The authoritative PNG is exactly 1024×1024 and RGBA.
- The icon remains recognizable at 16, 32, and 48 pixels.
- No default Tauri logo remains in generated application assets.
- Installer, executable, Desktop shortcut, and Start menu shortcut use the
  approved icon.
- Sidebar, onboarding, startup, and recovery branding use the matching
  `LogoMark` plus the appropriate product wordmark.
- No rejected comparison mockup is copied into shipping assets.

## Generation record

Mode: built-in image generation, followed by local high-quality resizing to
the authoritative 1024×1024 RGBA source.

Prompt summary: create a premium, vector-friendly MiroraTrack desktop icon
combining mirroring and a financial tracking path in midnight blue,
professional blue, teal, and restrained gold; no text, currency symbols,
coins, piggy bank, watermark, or generic chart axes.
