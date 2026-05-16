# BORDS Brand Guidelines & Design Language

**Version 1.0** | AXECORE Labs Inc. | January 2026

---

## Brand Identity

### What is BORDS?
BORDS is a **visual productivity platform** that transforms planning, thinking, and workflow management into a flexible, distraction-free experience. We provide a digital surface for organizing ideas, tasks, and projects through drag-and-drop boards, modular blocks, and sticky notes.

### Brand Promise
*"More than a to-do app."* BORDS gives users the freedom to organize visually without being boxed in by rigid structures.

### Parent Company
BORDS is developed and maintained by **AXECORE Labs Inc.**

---

## Core Pillars

1. **Visual** - Organize ideas with drag-and-drop simplicity
2. **Flexible** - Everything is a modular block you control
3. **Calm** - Minimalist design reduces cognitive load
4. **Smart** - Intelligent structuring for modern workflows

---

## Color Palette

### Color Philosophy & Psychology

**Why Monochrome Dominance?**

Our color system is intentionally minimal, using a black-white-grayscale foundation with strategic accent colors. This choice is rooted in psychology and brand positioning:

**Black (#000000):**
- **Psychology:** Authority, sophistication, timelessness
- **Usage:** Primary backgrounds to create focus and reduce visual noise
- **Brand Message:** Professional, serious about productivity, not playful
- **Effect:** Creates "digital canvas" feel where user content stands out

**White (#FFFFFF):**
- **Psychology:** Clarity, simplicity, space to think
- **Usage:** Text, highlights, feature section backgrounds, CTAs
- **Brand Message:** Clean slate, freedom, unlimited potential
- **Effect:** High contrast improves readability and creates dramatic hierarchy

**Grayscale Spectrum (Zinc):**
- **Psychology:** Neutrality, calmness, reduced cognitive load
- **Usage:** Graduated hierarchy from subtle (50) to bold (900)
- **Brand Message:** Minimal distractions, focus on content over chrome
- **Effect:** Creates depth without color chaos; maintains zen-like calm

**Why Limited Accent Colors?**

We use only three accent colors at low saturation and strategic opacity:

**Blue-200 (#bfdbfe):**
- **Psychology:** Trust, stability, productivity, technology
- **Usage:** Links, interactive elements, primary accent
- **Why this shade:** Soft enough to not overpower, bright enough to guide attention
- **Frequency:** ~5% of visual space

**Pink-200 (#fbcfe8):**
- **Psychology:** Creativity, warmth, human touch
- **Usage:** Secondary UI elements, adds warmth to cold grayscale
- **Why this shade:** Balances professionalism with approachability
- **Frequency:** ~2% of visual space

**Yellow-100 (#fef9c3 at 20% opacity):**
- **Psychology:** Optimism, energy, highlights
- **Usage:** Subtle emphasis, borders, gentle highlights
- **Why this shade:** Nearly invisible warmth; adds subtle vibrancy
- **Frequency:** <1% of visual space

**Strategic Color Restraint:**
- 90%+ of design is achromatic (black/white/gray)
- Accent colors feel precious and intentional
- Prevents decision fatigue (fewer color choices to make)
- Mirrors our product philosophy: minimal distractions, maximum clarity
- Creates timeless aesthetic that won't feel dated

### Primary Colors

```css
Black: #000000
White: #FFFFFF
```

### Grayscale Spectrum

```css
Zinc-50:  #fafafa   /* Light backgrounds */
Zinc-100: #f4f4f5   /* Subtle borders */
Zinc-200: #e4e4e7   /* Light text on mobile */
Zinc-300: #d4d4d8   /* Light text on mobile hero */
Zinc-400: #a1a1aa   /* Secondary headings */
Zinc-500: #71717a   /* Body text, descriptions */
Zinc-600: #52525b   /* Muted emphasis, italic text */
Zinc-700: #3f3f46   /* Subtle UI elements */
Zinc-800: #27272a   /* Borders, dividers, badges */
Zinc-900: #18181b   /* Dark backgrounds, cards */
```

### Accent Colors

```css
Blue-200:   #bfdbfe   /* Primary accent, links, highlights */
Pink-200:   #fbcfe8   /* Secondary accent, UI elements */
Yellow-100: #fef9c3   /* Tertiary accent, subtle emphasis (20% opacity) */
```

### Color Usage Rules

- **Black backgrounds** for hero, product depth, logic sections
- **White backgrounds** for features section (creates contrast)
- **Zinc-900 backgrounds** for manifesto section
- **Accent colors** used sparingly for emphasis (dots, highlights, borders)
- **Text hierarchy**: White > Zinc-300/400/500/600 based on importance
- **Mobile text**: Lighter shades (Zinc-200, Zinc-300) for better readability on image backgrounds

---

## Typography

### Typography Philosophy & Psychology

**Why These Typefaces?**

Typography is the voice of our brand. We chose Inter and Outfit for specific psychological and functional reasons:

#### Primary: **Inter**

**Design Characteristics:**
- Modern neo-grotesque sans-serif
- Designed specifically for screen readability
- Tall x-height, open apertures, clear letterforms
- Subtle geometric foundation with humanist warmth

**Psychological Impact:**
- **Neutral & Professional:** Doesn't impose personality, lets content speak
- **Highly Legible:** Reduces cognitive load during reading
- **Contemporary:** Feels current without being trendy
- **Approachable:** Softer than rigid geometric sans-serifs like Helvetica

**Why Inter for Body Copy:**
- Optimized for UI/UX applications
- Excellent readability at small sizes (14px-16px)
- Wide range of weights allows flexible hierarchy
- Open-source, performant, web-optimized
- Used by Stripe, GitHub, Notion—establishes us in "serious tool" category

**Weights & Their Meaning:**
- **300 Light:** Friendly, breathable, modern (body text)
- **400 Regular:** Neutral baseline for UI elements
- **500 Medium:** Subtle emphasis without shouting
- **600 Semi-bold:** Strong but not aggressive (headings, labels)

---

#### Secondary: **Outfit**

**Design Characteristics:**
**Psychological Application of Type:**

- **Tracking (letter-spacing)**: 
  - **Tight tracking** for headlines: `tracking-tight` or `tracking-tighter`
    - *Psychology:* Creates density, importance, urgency
    - *Effect:* Words feel cohesive, impactful, statement-making
  - **Wide tracking** for labels: `tracking-[0.3em]` to `tracking-[0.4em]`
    - *Psychology:* Luxury, spaciousness, refinement
    - *Effect:* Uppercase labels feel premium, organized, categorized

- **Line height**: 
  - **Tight for display**: `leading-[0.95]` or `leading-tight`
    - *Psychology:* Dynamic, energetic, modern
    - *Effect:* Creates visual tension that demands attention
  - **Relaxed for body**: `leading-relaxed`
    - *Psychology:* Calm, readable, approachable
    - *Effect:* Reduces eye fatigue, invites sustained reading

- **Font weights**: 
  - **Light (300) for body**
    - *Psychology:* Delicate, modern, premium
    - *Effect:* Creates breathing room, feels less heavy
  - **Semibold (600) for emphasis**
    - *Psychology:* Confident without being aggressive
    - *Effect:* Draws eye without shouting

- **Italics**: 
  - Used strategically for de-emphasis or philosophical statements
  - *Psychology:* Thought, reflection, nuance
  - *Examples:* "rigid structures", "to-do app", "Flexibility"
  - *Effect:* Creates voice modulation; adds dimension to messaging
- **Distinctive:** Unique enough to be memorable, familiar enough to trust
- **Spacious:** Wide tracking creates luxury, breathing room

**Why Outfit for Headlines:**
- Creates clear visual hierarchy (distinct from Inter)
- Geometric structure conveys structure and organization (our product benefit)
- Rounded details add warmth to otherwise stark minimalism
- Scales beautifully to display sizes (72px-128px)
- Modern without being sci-fi; professional without being corporate

**Weights & Their Meaning:**
- **300 Light:** Elegant, refined, high-end (italic emphasis)
- **400 Regular:** Balanced, approachable headlines
- **600 Semi-bold:** Authority, confidence (primary headings)

---

### Font Pairing Strategy

**Why Inter + Outfit Works:**

1. **Contrast without Conflict:**
   - Inter (humanist grotesque) vs. Outfit (geometric rounded)
   - Different enough to create hierarchy, similar enough to feel cohesive

2. **Functional Clarity:**
   - Inter = functional, readable, utility
   - Outfit = expressive, attention-grabbing, brand
   - Clear separation of purpose

3. **Emotional Balance:**
   - Inter grounds the experience (rational, trustworthy)
   - Outfit adds personality (creative, forward-thinking)
   - Together: Professional yet innovative

4. **Screen Optimization:**
   - Both designed for digital environments
   - Excellent hinting and rendering at all sizes
   - Fast loading, variable font support (future)

---

### Font Families

#### Primary: **Inter**
- Weights: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semi-bold)
- Usage: Body copy, UI elements, descriptions, labels
- Fallback: `system-ui, -apple-system, sans-serif`
- Source: Google Fonts
- License: Open Font License

#### Secondary: **Outfit**
- Weights: 300 (Light), 400 (Regular), 600 (Semi-bold)
- Usage: Display headings, brand statements, hero text
- Fallback: `ui-sans-serif, system-ui, sans-serif`
- CSS Class: `.brand-font`
- Source: Google Fonts
- License: Open Font License

### Type Scale

#### Desktop
```
Display (Hero):     9xl (128px)   - font-semibold
Heading 1:          7xl (72px)    - font-semibold
Heading 2:          6xl (60px)    - font-medium
Heading 3:          5xl (48px)    - font-semibold
Heading 4:          2xl (24px)    - font-semibold/medium
Body Large:         xl (20px)     - font-light
Body:               base (16px)   - font-light
Body Small:         sm (14px)     - font-light
Labels/Tags:        xs (12px)     - font-bold, uppercase, tracking-[0.3-0.4em]
```

#### Mobile Scaling
```
Hero:        5xl → 6xl → 9xl
Section H1:  4xl → 5xl → 7xl
Section H2:  2xl → 3xl → 4xl → 6xl
Body:        sm/base → base/xl
```

### Typography Principles

- **Tracking (letter-spacing)**: 
  - Tight tracking for headlines: `tracking-tight` or `tracking-tighter`
  - Wide tracking for labels: `tracking-[0.3em]` to `tracking-[0.4em]`
- **Line height**: 
  - Tight for display: `leading-[0.95]` or `leading-tight`
  - Relaxed for body: `leading-relaxed`
- **Font weights**: Prefer light (300) for body, semibold (600) for emphasis
- **Italics**: Used for de-emphasis or philosophical statements (e.g., "rigid structures")

---

## Design Language

### Visual Style
- **Minimalist & Modern**: Clean interfaces with ample whitespace
- **Sophisticated Depth**: Subtle 3D transforms, layered mockups, soft shadows
- **High Contrast**: Stark black/white with strategic accent colors
- **Geometric Precision**: Rounded corners follow specific patterns

### Border Radius System

```css
Small:      rounded-lg (8px)
Medium:     rounded-xl (12px)
            rounded-2xl (16px)
Large:      rounded-3xl (24px)
            rounded-[32px] (32px)
            rounded-[40px] (40px)
```

**Usage:**
- Cards/Stat Cards: `rounded-[40px]` desktop, `rounded-3xl` mobile
- Laptop Mockups: `rounded-2xl` for screen bezels
- Badges/Numbers: `rounded-2xl` desktop, `rounded-xl` mobile
- Buttons: `rounded-xl`
- Small UI elements: `rounded-lg` or `rounded-full` for dots

### Spacing Scale

```css
Mobile:      py-12, py-16, py-20
Desktop:     py-24, py-40, py-60

Gaps:
Mobile:      gap-4, gap-6, gap-8, gap-12
Desktop:     gap-8, gap-12, gap-20, gap-32

Padding:
Cards Mobile:    p-6, p-8
Cards Desktop:   p-8, p-12
```

### Shadow System

```
Shadow SM:        Used for subtle card elevation
Shadow 2XL:       Used for laptop mockups, depth
Box Shadow:       Custom shadows for immersive 3D effects
```

---

## Component Patterns

### Laptop Mockups (3D)

**Structure:**
```
.laptop-mockup
├── .laptop-base (bottom)
└── .laptop-lid
    └── .screen-content
        ├── .bezel-top (with camera dot)
        ├── .ui-header (traffic light dots)
        └── Content area
```

**CSS Properties:**
- `transform-style: preserve-3d`
- `perspective: 2000px`
- Rotation: `rotationY`, `rotationX` for 3D positioning
- Aspect ratio: `16/10`
- Border: `border-zinc-800`
- Bezel: 8px padding on screen

**Responsive Sizing:**
- Mobile center laptop: `w-[280px]` → `w-[400px]` → `w-[500px]` → `w-[600px]`
- Side laptops: Hidden on mobile (`hidden lg:flex`)

### Stat Cards

**Structure:**
```
.stat-card
├── Badge (01, 02, 03)
├── Heading
└── Description
```

**Styling:**
- Gradient background via CSS (`linear-gradient` with transparency)
- Border: `border border-zinc-800/50`
- Padding: `p-8 lg:p-12`
- Radius: `rounded-3xl lg:rounded-[40px]`
- Staggered positioning: Middle card `mt-12 md:mt-20`

### Feature Cards

**Styling:**
- Background: `bg-zinc-50`
- Border: `border border-zinc-100`
- Hover: `hover:bg-zinc-100 transition-colors`
- Layout: Flex row with space-between
- Badge: White background with shadow

### Buttons

**Primary CTA:**
```
bg-white text-black
px-12 py-5
rounded-xl
text-lg font-medium
hover:bg-zinc-100 transition-all
```

**Secondary:**
```
border border-zinc-800 text-white
px-10 py-5
rounded-xl
hover:bg-zinc-900 transition-all
```

### Navigation

**Desktop:**
- Transparent background with border-bottom
- Links: `text-zinc-400 hover:text-white transition-colors`
- Logo: 32px × 32px image + brand text

**Mobile:**
- Simplified, collapsed menu (future implementation)
- Same color scheme

---

## Animation Philosophy

### GSAP ScrollTrigger Principles

**Timeline Structure:**
- Pinned hero section with 250% scroll distance (desktop)
- Pinned hero section with 150% scroll distance (mobile)
- Scrub value: `1.2` for smooth scrolling tie-in

**Hero Animation Phases (Desktop):**
1. Fade out hero text (opacity 0, y: -100, blur)
2. Center laptop scales down and fades (y: -200, scale: 0.4, opacity: 0)
3. Side laptops fly out (x: ±600, opacity: 0)
4. Reveal text appears (opacity: 1, scale: 1, deblur)

**Hero Animation (Mobile):**
1. Fade out hero text
2. Reveal static text overlay (no laptop animations)

**Section Entry Animations:**
- Stat cards: `y: 100, opacity: 0` → visible with `stagger: 0.2`
- Stationary laptops: `x: 200, opacity: 0` → visible with `stagger: 0.15`

**Mouse Parallax (Desktop Only):**
- Subtle rotation of laptop group based on cursor position
- Lerp interpolation for smooth tracking: `lerp factor: 0.08`

### Transition Guidelines

- **Duration**: 0.3s to 1.5s depending on complexity
- **Easing**: `power2.out`, `power3.out`, `back.out(1.7)` for bounce
- **Hover states**: Quick transitions (0.2-0.3s) with `transition-colors` or `transition-all`

---

## Responsive Design Strategy

### Breakpoints

```css
sm:  640px   (2-column layouts, show some hidden elements)
md:  768px   (3-column grids, reveal laptop mockups)
lg:  1024px  (Desktop view, full animations, 4-column grids)
```

### Mobile-First Approach

**Principles:**
1. **Hide complexity on mobile**: No laptop animations, background images instead
2. **Scale typography aggressively**: 2-4x size difference between mobile/desktop
3. **Stack layouts vertically**: Grid columns collapse to 1
4. **Reduce padding**: 50% less section padding on mobile
5. **Tighter spacing**: Smaller gaps, margins, card padding
6. **Center content**: Remove asymmetric positioning on small screens

**Mobile Optimizations Per Section:**

- **Hero**: Background image (bord2.png) with blur overlay instead of 3D mockups
- **Product Depth**: Hide background laptop, center foreground laptop
- **Logic**: Stat cards lose stagger offset on mobile
- **Features**: Single column stack, smaller text
- **Manifesto**: 1 → 2 → 4 column progression, bottom borders on mobile
- **Footer**: Vertical stack, centered text, wrap links

---

## Voice & Tone

### Brand Voice Characteristics

- **Clear & Direct**: No corporate jargon, straight to the point
- **Confident but Not Arrogant**: "We believe..." not "We're the best..."
- **Empowering**: Focus on user freedom and control
- **Minimal**: Few words, maximum impact

### Messaging Patterns

**Headlines:**
- Short, declarative statements
- Use of contrast (e.g., "More than a to-do app")
- Emphasis through italics or color shifts

**Body Copy:**
- Active voice
- Focus on benefits, not features
- Use "you" and "your" to engage users

**Microcopy:**
- Action-oriented button text: "Get Started", "Start for Free"
- Descriptive labels: "Core Features", "Modern Productivity"

### Example Phrases

✅ **Good:**
- "Visual productivity."
- "Planning meets freedom."
- "Organize visually. Work flexibly."
- "Built for Flexibility."

❌ **Avoid:**
- "Revolutionizing the productivity space"
- "Cutting-edge synergy solutions"
- "Empowering stakeholders to ideate"

---

## Grid & Layout System

### Container Widths

```css
max-w-4xl:  56rem (896px)   - Hero text, centered content
max-w-5xl:  64rem (1024px)  - Manifesto heading
max-w-7xl:  80rem (1280px)  - Main section container
```

### Content Padding

```css
px-4:  Mobile tight spacing
px-6:  Standard horizontal padding
```

### Section Structure Template

```jsx
<section className="py-20 lg:py-40 bg-[color]">
  <div className="max-w-7xl mx-auto px-6">
    {/* Header */}
    <div className="text-center mb-12 lg:mb-20">
      <span className="uppercase text-xs tracking-[0.3em]">Label</span>
      <h2 className="text-4xl lg:text-7xl">Heading</h2>
    </div>
    
    {/* Grid Content */}
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-12">
      {/* Cards */}
    </div>
  </div>
</section>
```

---

## Imagery & Graphics

### Logo Usage

**Primary Logo:**
- File: `bordclear.png`
- Size: 32px × 32px minimum
- Clear space: 8px minimum on all sides
- Always pair with "BORDS" wordmark

**Wordmark:**
- Font: Outfit, bold (600)
- Size: text-xl (20px) or larger
- Tracking: `tracking-tighter`
- Color: White on dark backgrounds

### Background Graphics

**bord2.png** (Scattered cards pattern):
- Usage: Hero section background (mobile), Product Depth section background
- Opacity: 5% for subtle texture
- Filter: `blur(2px)` to soften
- Background size: 70% to prevent overwhelming

**bord3.png** (Interface screenshot):
- Usage: Center laptop screen content
- Display: Full screen mockup
- Treatment: `object-cover` to fill space

### 3D Elements

- Laptop mockups with realistic bezels, camera dots, and shadows
- Perspective depth: `perspective(2000px)`
- Subtle rotation for dimensionality
- Layered positioning with z-index hierarchy

---

## Content Hierarchy

### Information Architecture

1. **Hero** (Immediate impact)
   - Main value proposition
   - Visual "wow" factor via animations
   
2. **Product Depth** (What it is)
   - Explanation of platform capabilities
   - Visual flexibility messaging
   
3. **Logic/Core Features** (How it works)
   - Three key features in stat cards
   - Functional benefits
   
4. **Features/Why BORDS** (Why choose us)
   - Differentiation from competitors
   - Philosophical approach
   
5. **Manifesto** (Brand beliefs)
   - Core values and principles
   - Emotional connection
   
6. **CTA** (Next steps)
   - Clear call to action
   - Minimal friction

---

## Accessibility Considerations

### Color Contrast

- White text on black: ✅ AAA compliant
- Zinc-500 text on black: ✅ AA compliant
- Zinc-600 on white: ✅ AA compliant
- Blue-200 accents: Decorative only, not for critical info

### Mobile Legibility

- Lighter text colors (Zinc-200, Zinc-300) on image backgrounds with semi-transparent overlay
- Minimum font size: 14px (text-sm)
- Adequate line height: `leading-relaxed` for body copy

### Focus States

- Implement visible focus indicators for keyboard navigation
- Use `focus:ring` or `focus:outline` utilities

---

## Technical Implementation

### CSS Architecture

**Tailwind CSS Configuration:**
- Extend default theme with custom values
- Use `@apply` sparingly, prefer utility classes
- Custom CSS for complex 3D transforms in `globals.css`

**Key Custom CSS Classes:**
```css
.brand-font           /* Outfit font family */
.laptop-mockup        /* 3D laptop structure */
.stat-card            /* Gradient background cards */
.scene-container      /* 3D scene wrapper */
.bg-reveal-text       /* White reveal text */
```

### File Structure

```
/src
  /app
    layout.js         /* Fonts, metadata, global styles */
    page.js           /* Main page composition */
    globals.css       /* Custom CSS, 3D styles */
  /components
    BordsAnimation.js     /* GSAP animation logic */
    HeroSection.js        /* Hero with laptop mockups */
    ProductDepthSection.js
    LogicSection.js
    FeaturesSection.js
    ManifestoSection.js
    CTASection.js
    Navbar.js
    Footer.js
/public
  bordclear.png       /* Logo */
  bord2.png          /* Background graphics */
  bord3.png          /* Interface screenshot */
  favicon.ico        /* Browser icon */
  icon.png           /* App icon (192×192, 512×512) */
```

---

## Usage Guidelines

### Do's ✅

- Use ample whitespace for breathing room
- Maintain strict alignment and grid discipline
- Apply responsive scaling consistently across breakpoints
- Use subtle animations to guide user attention
- Prioritize readability over decoration
- Keep accent colors to <10% of visual space

### Don'ts ❌

- Don't use bright, saturated colors outside accent palette
- Don't overcrowd mobile layouts with complex animations
- Don't use more than 2-3 font weights per section
- Don't break the grid system for "creative" layouts
- Don't add animations without purpose
- Don't reduce font sizes below 14px

---

## Future Considerations

### Planned Expansions

- **Dark Mode Toggle**: User preference for light/dark themes
- **Color Themes**: Alternative accent color schemes (green, purple)
- **Animation Library**: Reusable GSAP presets for new sections
- **Component Variants**: Alternative card styles, button sizes
- **Illustration System**: Custom icons and graphics matching brand style

### Maintenance

- Review brand guidelines quarterly
- Update color contrast ratios with WCAG updates
- Test responsive breakpoints with new device sizes
- Validate animation performance on lower-end devices

---

**Last Updated:** January 2, 2026  
**Maintained by:** AXECORE Labs Design Team  
**Contact:** branding@axecorelabs.com
