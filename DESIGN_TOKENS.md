# Design Tokens — Variation Shield & Leveraged Systems

Single source of truth for the shared brand palette.

## Shared Tokens (CSS Custom Properties)

```css
:root {
  /* Foundation */
  --color-deep-charcoal:  #111827;  /* main text, headers */
  --color-asphalt:        #17212B;  /* dark section background */
  --color-steel-slate:    #334155;  /* secondary dark text */
  --color-warm-concrete:  #F5F2EA;  /* page background */
  --color-off-white:      #FFFCF5;  /* card / panel background */
  --color-concrete-grey:  #D8D2C4;  /* borders, dividers */

  /* Brand accent */
  --color-safety-orange:  #E76F00;  /* primary CTA — resting state only */
  --color-burnt-orange:   #C75A00;  /* hover/active state ONLY — never resting */

  /* Status — VS only (do not use on LS) */
  --color-site-green:    #2E7D32;  /* approved */
  --color-amber:          #D99A00;  /* at-risk / submitted */
  --color-muted-red:      #B42318;  /* disputed */
}
```

## Usage Rules

- **Resting CTA fill:** `--color-safety-orange` (`#E76F00`)
- **Hover CTA fill:** `--color-burnt-orange` (`#C75A00`) — never resting
- **No hardcoded hex values** for brand colours in component code
- **Status colours:** VS app only — never on LS marketing site
- New colours added here first, then consumed — never inlined as one-off hex

## Files

| Site | Token file | Shared with |
|------|-----------|-------------|
| Variation Shield | `web/src/app/globals.css` (`@theme` block) | consumed by all TSX |
| Leveraged Systems | `styles.css` (`:root` block) | consumed by all HTML/CSS |

## Colour Assignments

| Token | VS usage | LS usage |
|-------|---------|----------|
| `#111827` deep-charcoal | body text, headings | body text, headings |
| `#17212B` asphalt | dark nav/footer bg | header bar, footer bg |
| `#F5F2EA` warm-concrete | page background | page background |
| `#FFFCF5` off-white | cards, panels | cards, panels |
| `#D8D2C4` concrete-grey | borders, dividers | borders, dividers |
| `#E76F00` safety-orange | primary CTA (resting) | primary CTA (resting), accent words |
| `#C75A00` burnt-orange | primary CTA hover | primary CTA hover |
| `#2E7D32` site-green | approved status (VS only) | — |
| `#D99A00` amber | at-risk status (VS only) | — |
| `#B42318` muted-red | disputed status (VS only) | — |

## Verification

```bash
# VS — no non-token hex for brand colours
cd web && grep -rEn '#C75A00|#E76F00|#B84C00|#9A3F00' src/ public/ | grep -v node_modules

# LS — no non-token hex for brand colours
grep -rEn '#E76F00|#C75A00' . --include="*.html" --include="*.css" | grep -v blog
```
