# Design system

The web app uses one visual language across the public site and the signed-in product. Tokens live in
`apps/web/src/styles.css`; shared components live in `apps/web/src/components/ui`.

## Foundations

| Area     | Rule                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour   | One cool, teal-tinted neutral family and one accent (the brand teal). Light and dark themes share semantic tokens (`bg-surface`, `text-fg-muted`, `bg-accent`, …).               |
| Contrast | Every text pair meets WCAG 2.2 AA (most are 5:1 to 8:1). Control boundaries (`--border-strong`) meet 3:1 in both themes.                                                         |
| Type     | Geist (self-hosted), tight tracking on headings, tabular figures for numbers, body text capped near 65 characters.                                                               |
| Shape    | Buttons and segmented controls are full pills; inputs and menu items 12px; cards, panels and dialogs 20px; framed screenshots and hero panels 28px with a 6px bezel; badges 6px. |
| Depth    | Tinted, layered shadows with an inner highlight (`shadow-card`, `shadow-pop`) instead of grey borders. A faint grain sits behind the app, never over content.                    |
| Icons    | Phosphor only, imported through `components/ui/icons.ts`. One stroke weight app-wide; the active navigation item uses the filled weight.                                         |
| Motion   | `--ease-out` for entrances, `--ease-spring` for interaction. Only `transform` and `opacity` animate. Everything collapses to instant under `prefers-reduced-motion`.             |

## Components

- **Button**: pill, presses down slightly on click; `primary` carries a tinted glow. Labels stay on one line.
- **Stat**: metric tile. Pass `emphasis` to the one metric on a page that asks for action (for example, work to grade).
- **DateTile**: month and day for deadline rows, with the full date for screen readers.
- **Card**: `min-w-0` so long, truncated titles never widen a grid on small screens.
- **Table**: horizontal scroll inside a positioned container, so hidden header labels cannot widen the page.
- **Dialog and menus**: blurred backdrop, 24px dialogs, menus that scale in from their trigger.

## Public site

The landing page uses real screenshots of the product (`apps/web/public/images`, one per theme) rather than
drawn mock-ups. Recapture them from the seeded demo when the UI changes. Sections reveal once as they scroll into
view (`useReveal`, IntersectionObserver), and the navigation is a floating bar rather than an edge-to-edge strip.
