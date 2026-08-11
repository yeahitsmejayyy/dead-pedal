# Art direction

Every image dead-pedal needs, the look they all share, and a prompt to generate each one.

**Append the style suffix in section 4 to every prompt, byte-identical, no paraphrasing.** Vary the
scene above it, never the block itself. Drift across eight assets comes almost entirely from
rewording the style block "just a little" on the sixth generation, and a set that drifts is not a
set.

Finished files go in `_art/` (masters), `public/art/` (anything the game loads) and `docs/art/`
(anything only the README and GitHub load). Section 8 has the exact paths and why they differ.

This is cover art for a public GitHub repo with a playable demo link, so it is advertising and it
is the first thing anyone sees. A flat screen-printed style was tried first and dropped: the cover
is a painted one that deliberately oversells the game, because that is what game covers of
1988–2005 actually did and because it was asked for on purpose.

---

## The style

**WET STEEL.** An airbrush-and-acrylic box-art painting in which the hero's paint is a wet mirror
and everything that mirror reflects is filthy. Polish and rot are not two zones of the picture.
They are the same square inch: a stone strike through clearcoat, colour coat, grey primer and bare
steel is a four-layer edge you can only paint because the surface underneath is a mirror, and the
mirror is only credible because it is broken. The cover promises backlit smoke, scratched chrome
and a car frozen at the apex of a jump the physics can only approximate. That gap is the product.

The base coat is opaque and the clearcoat over it is transparent, which matters more than it
sounds. Custom candy lacquer puts transparent colour over a light ground, so the paint's own hex
appears nowhere on the panel — and four of the hexes here are load-bearing. Base coat plus clear
gets the same wet mirror out of the top layer while the lit face of the panel still eyedroppers to
`#d8452f`. That is the one decision this direction is built on.

### Influences

Named as movements and trades, never as a franchise, film, band or living artist. That constraint
is not politeness; this art gets published under a repo with the developer's name on it.

- Airbrush and acrylic on cold-press illustration board — the console and computer box-art
  tradition of roughly 1988–1998, credited on the original boards in exactly those words.
- Carnival and sideshow banner painting: the one tradition in Western art whose entire purpose is
  to oversell what is inside the tent. That is the licence for the whole direction.
- 1970s American custom-van and panel-truck mural airbrushing, including chrome-and-fire frisket
  work, as a genre.
- Airbrushed heavy-metal and thrash LP sleeve painting, roughly 1982–1992, as a genre.
- Pre-CGI photorealistic automotive advertising illustration — gouache and airbrush on board, the
  trade that painted car brochures before rendering existed.
- Hand-painted county-fair demolition-derby and dirt-track race posters.
- Tenebrism in Baroque oil painting: one hard source, no fill, everything outside the beam
  surrendered to black.
- Post-apocalyptic desert-scavenger vehicle design as a production-design tradition — welded plate,
  bull bars, roof racks, exposed cage.
- Trompe-l'oeil rendering of wet and reflective metal.
- Sodium-vapour and magnesium-flare night lighting as staged in pre-digital film production art.

### The palette

The inks are not invented. They are `LIVERIES` from `src/view/palette.ts:24`, the boost-chevron
orange from `src/view/renderer.ts:48`, the key light from `renderer.ts:171`, the arena materials
from `renderer.ts:32–34`, two crate hexes from `palette.ts:56` and `palette.ts:58`, and the scene
background from `renderer.ts:152`. The cover, the radar blips and the HUD pips are demonstrably one
colour system, which is a thing no other project can copy without copying this codebase.

| Hex | Name | Role | Source in code |
|---|---|---|---|
| `#0b0d10` | night black | The sky, the reserved wordmark band, and the deepest value in every image. Never lifted, never tinted, never atmospheric. | `renderer.ts:152` and `index.html` body background |
| `#d8452f` | rust red | **Livery 0, the player.** Armoured sports coupe. Largest saturated area in any image it appears in. | `palette.ts:24` |
| `#3f8ecc` | faded blue | **Livery 1.** Armoured pickup. The only cool livery, and the thing that stops a warm-keyed night picture going monochrome. Never used as sky, shadow or atmosphere. | `palette.ts:24` |
| `#6bbf59` | dirty green | **Livery 2.** Armoured box truck. Slabbiest silhouette, so it takes the second-largest saturated area. | `palette.ts:24` |
| `#c9a227` | mustard gold | **Livery 3.** Clean sports car. The only livery allowed to double as warm bare metal. | `palette.ts:24` |
| `#ff8c1a` | boost orange | The only warm emitter in the system: chevrons, fire, muzzle flash, ember dots. Light, never paint. Max ~8% of frame. | `renderer.ts:48` |
| `#fff2df` | key white | The single light source. Taken from `DirectionalLight(0xfff2df, 1.5)` and dropped to 25–35° for drama. Warm and almost unsaturated, so it can never be mistaken for a chevron. | `renderer.ts:171` |
| `#e6edf3` | off-white | Scratched speculars, the pale dust film, and the wordmark face. The only light value on the board. | `palette.ts:56`, machine-gun crate |
| `#6b5a3e` | desert ochre | The dirt plate and the ramp solids. Already the ramp material in the build, and the value the floor is meant to move toward. | `renderer.ts:34` |
| `#2a323c` | concrete | The four-metre board-formed perimeter wall. Also the hue soot is painted in. | `renderer.ts:32` |
| `#4c5666` | pale concrete | Pillars, angled barriers, crates. | `renderer.ts:33` |
| `#b44cff` | violet | One small accent per image, maximum, and never on a car. | `palette.ts:58`, homing-missile crate |
| `#c8d2dc` over `#1a1d22` | chrome | Not a colour. A two-value structure: pale reflection above, dark ground reflection below, a hard line between them, opaque white scratched through. | — |

### Why the liveries are load-bearing

`palette.ts` says it in its own comment: the radar draws a blip per car and has to agree with the
paint, and a second copy of those four numbers is a second copy that can drift. The HUD pips, the
scoreboard swatches and the radar blips all render the livery at **full strength**. If the poster
shows a red car that isn't `#d8452f`, the cover and the instrument panel are teaching the player
two different colour keys.

`#ff8c1a` sits between rust red and mustard gold in hue. **It must never physically touch either
one** or the four cars stop being four distinguishable objects. That is the only hard adjacency
rule and it is worth a re-roll on its own. It is also why the key light is `#fff2df` and not a
sodium amber: an amber key in a single-source scene means the only light in the picture is the
chevron hue landing on the red car, which is the same failure with extra steps.

### How grunge is achieved

Three mechanisms, and none of them is a filter.

**Causation binding.** No piece of damage is unlocated, because unlocated damage is exactly what
the model renders as an overlay floating on the image plane. Not "weathered" — rust bleeding
downward from the bolt heads on the left fender, following gravity, pooling at the panel seam.
Paint chipped at the leading edge of the bull bar where stones have struck it. Soot feathered back
from the exhaust port, heaviest at the port, sitting only on upward-facing surfaces. Brake dust
caked pale in the wheel arch and wiped clean in an arc where the tyre throws it. Dust settled only
in dead-air zones: behind the mirror, in the door shut-line, under the roof rack.

**Stated layer order.** One sentence, in the suffix, on every generation: all damage is painted
into the form, it follows each panel's curvature and perspective and receives the same key light as
the intact paint, and it is not a texture laid over the picture. That sentence is what kills the
grunge-overlay look, and because it lives in the suffix it propagates to all eight assets.

**Grime as value, never as hue.** Soot is a cool grey-blue, oil is near-black with one warm
specular along the edge of the pool, dust is a pale cool film, and all four liveries hold full
chroma from the lit plane into the shadow. Rust is the only genuinely brown thing in the picture
and it is painted as an orange bloom with dark pitting at its centre and a hard bright edge where
it meets intact paint. No global sepia, no desaturation pass, no orange-and-teal grade.

On top of that, the filth is split between the car and the ground on purpose. Churned ruts,
standing water, near-black oil pools, mud fans that are wet and dark at the centre and drying
chalky pale at the edge, scorched concrete, torn fencing, and a berm of unpainted derelict hulks
against the wall. That division does real work: the environment carries most of the dirt, so the
four livery hexes stay saturated and eyedropperable while the picture still reads filthy. A
direction that puts all the grunge on the paint is fighting its own palette rule on the one surface
where that rule is measured.

### How polish is achieved without AI sheen

Polish here is three zones taken to a genuine mirror finish and nothing else touched. Chrome as the
classic split reflection. Clearcoat as a wet transparent layer over an opaque base, with a cool
reflected edge running along the underside of every panel — the detail that separates real
automotive illustration from a shiny render. Wet dirt on the tyre sidewall. Speculars scratched in
last with opaque white, not glowed in. Everything outside those three zones is blocked in with
broad masses and single loaded strokes, because uniform detail density is precisely what makes an
image read as machine-made.

The counters matter as much as the target. An unbroken specular is the CG signature in any medium,
so every specular is interrupted at least twice by a scratch or by orange-peel ripple. No large
surface carries a continuous even tone; every panel is broken by at least three of a shallow dent
catching the key at a different angle, a sanded patch, a run in the clear, or a wiped streak
through the dust. Graduations are discrete airbrush passes with faint banding at each transition,
not continuous falloff. Highlights clip to a hard-edged white core with no halo, and the light
falls off inverse-square to near-black within two vehicle lengths.

One warning on vocabulary, and it is the trap in this direction. **The word "polished" must never
appear in a prompt.** It is a top-ranking sheen attractor alongside "smooth", "sleek", "glossy" and
"seamless", and writing it hands back the exact plastic surface the direction exists to avoid.
Write "mirror finish", "wet clearcoat", "hard specular", "scratched-in highlight". The direction is
called polished; the prompts never say it.

### The rules

1. **Airbrush and acrylic on cold-press illustration board, named in every prompt.** Naming the
   physical support is more reliable than naming the paint, because a board is incompatible with a
   render in a way the word "painting" is not. Drop the support and the model has nothing
   physically stopping it from handing back a 3D frame.

2. **Opaque base coat in decided value steps, transparent clear over it.** Three or four separated
   value steps per panel with dry-brush transitions, then the wet mirror in the top layer. This is
   the only paint chemistry that gives a mirror finish and still puts `#d8452f` on the lit face.
   Transparent candy colour does not, and the hex is not negotiable.

3. **The three mirror-finish zones are exempt from the value-step rule and nothing else is.** Say
   so explicitly or the posterisation instruction fights the mirror on every generation. Name the
   three zones by object in every prompt.

4. **One hard key of `#fff2df`, no fill, source named in the scene.** The far third of every
   subject falls to near-black silhouette held by one scraped highlight. Rim light on both sides, a
   bloom halo or a symmetrical hero glow is the loudest AI tell in this medium and is a re-roll.
   The key is never more saturated than the chevrons.

5. **`#ff8c1a` is light, never paint, and never touches `#d8452f` or `#c9a227`.** An emitter can be
   separated by a band of unlit ground or a black panel gap; a paint colour cannot. Eyedropper the
   red bodywork on every candidate.

6. **Grime is value, never tint.** The four liveries hold full chroma however filthy the car is. If
   a candidate comes back sepia it has failed however well it is drawn, because a brown wash is
   what the model does instead of understanding dirt.

7. **Every mark of damage names a cause and a location, and is painted into the form.** Damage that
   floats on the picture plane is an overlay, and an overlay is the failure this whole direction
   exists to avoid.

8. **Exactly three fully rendered zones per image, everything else in broad masses and single
   loaded strokes.** Do not render every rivet. Uniform detail density costs the hand-made read and
   buys nothing — but state that the summarised passages still carry hard value contrast and a
   decided silhouette, or the 400 px thumbnail is a dark smear with three bright spots.

9. **The cast is fixed: four silhouettes, never a fifth.** Rust red armoured sports coupe (player),
   faded blue armoured pickup, dirty green armoured box truck, mustard gold clean sports car. Any
   other vehicle in frame is dead scrap: unpainted, stripped grey steel and bare rust, roof caved.
   You must be able to tell who rammed you, and that only works if the set is closed.

10. **State the axle count as an affirmative structural fact: "four wheels, one at each corner",
    on every vehicle in every prompt.** Duplicated axles and five-wheeled cars are the most common
    geometry failure in this model family and this is the only wording that reliably fixes it.
    Eight words per car.

11. **No people, no faces, no drivers, no hands.** All windows are opaque black glass with one hard
    reflected highlight. The cover's one figure is a full-face crash helmet with a mirrored visor,
    seen through a smashed-out window — no skin, no eyes, no mouth. Three wins: it matches the
    build exactly (there are no driver models), it dodges the symmetric-plastic-face failure mode,
    and it is the cleanest route past the content filter. It also converts the build's opaque
    glass from a limitation into a fact about the world: you cannot see into a car in this game
    because everyone in here is behind a mirrored visor.

12. **Nothing in the picture is lettered and the model never renders the wordmark.** Bodywork,
    walls, ground, hoardings and props carry no writing, numerals, logos or symbols. Every
    sign-shaped object is a blank object with visible fixings. Section 6 explains why.

13. **Every asset reserves type space and the reserve is a single unmodulated value.** Top 24% on
    16:9 and 21:9, bottom 18% on the 4:5 portraits. Specifying a value is what stops the model
    filling the band with atmospheric noise you then cannot type over. "Empty sky" does not work;
    "unbroken `#0b0d10` at one value, nothing crosses into it" does.

14. **No dot screen, no halftone, no rosette, no visible print screen.** The previous direction was
    rejected for exactly that texture. Reproduction cues are limited to faint ink misregistration
    on the highest-contrast edges, board tooth reading through the midtones, overspray speckle at
    frisket boundaries, and slight paper warmth. Those carry the not-a-render signal without the
    printed look, and they are weaker than a dot screen would be — that is the price of the
    rejection and it is paid.

15. **Two gates on every candidate, in this order, both objective.** Downscale to 400 px first and
    look at it before judging anything else, because a GitHub social card renders around 400 px
    wide and an image that only works at 4K has failed. Then measure mean luminance and bin
    anything over 15. Section 3 has the commands.

---

## How to prompt

Target is **Google AI Studio, Nano Banana Pro (`gemini-3-pro-image`)**. Pick it explicitly in the
model dropdown.

**Do not use Imagen 4.** `imagen-4.0-generate-*` shuts down on 2026-08-17. Anything you read about
`negativePrompt`, `seed`, `sampleImageSize` or `aspectRatio` as prompt fields is dead API surface.
Nano Banana Pro is also the only current model with dedicated **style-reference slots** (3 style, 5
character, 6 object), which is the mechanism this whole eight-asset set depends on.

**Structure.** Subject, then action, then location, then composition, then style last. Write prose,
not a keyword list — comma-salad prompts measurably underperform here. Start every prompt with the
literal words "Create an image of", because an ambiguous prompt will hand you back *text describing*
an image. State the intent out loud ("cover illustration for a stylised arcade vehicular-combat
video game, ESRB Teen"); it conditions the whole render and it is also the documented way past the
content classifier.

**Use the step-by-step form for anything with more than one object.** "First, build the ground.
Then… Finally…" is the documented structure for complex scenes and every prompt below uses it.

**Aspect ratio and resolution are dropdowns.** Right-hand run settings panel. `image_size` takes an
uppercase `K`. Put the ratio sentence at the end of the prompt as well — the chat surface ignores
one or the other often enough that both are worth having — but the dropdown is the one that
actually binds. Verify the pixel dimensions of what comes back.

| Asset | Ratio | Size | Output pixels |
|---|---|---|---|
| Key art | 16:9 | 2K | 2752×1536 |
| Key art, portrait variant | 3:4 | 2K | 1792×2400 |
| Menu backdrop | 21:9 | 2K | 3168×1344 |
| Vehicle portrait | 4:5 | 2K | 1856×2304 |
| Arena establishing | 16:9 | 2K | 2752×1536 |
| Social card | 16:9 | 2K | 2752×1536, cropped after |

The ultra-wide 4:1 and 8:1 ratios exist only on Nano Banana 2, which has no style-reference slots.
Not worth the trade — shoot 21:9 on Pro and crop.

**There is no negative prompt.** Describe what you want, not what you don't. Roughly ninety per
cent of the negative work should be a positive replacement: not "no smooth gradients" but
"graduations built as discrete airbrush passes with faint banding at each transition". Save three
to five short prohibitions for the very end, phrased as prose constraints, for the failure modes
that have no positive counterpart. Never dump a comma-separated negative keyword list — in a
language-grounded model, listing `no chrome, no glow, no smoke` puts *chrome, glow, smoke* into the
context and measurably increases their appearance.

**There is no seed.** Any guide showing a `seed` or a reference `strength: 0.8` for "92% feature
lock" is fabricated; those parameters do not exist on this path. Every image also carries a SynthID
watermark that cannot be turned off in AI Studio, which is one of the reasons the wordmark is set
in real type rather than generated.

**Holding style across eight images**, in order of how much they actually do:

1. **Style-reference slots.** Generate the key art first, pick the one you love, attach it as style
   reference #1 on all seven remaining prompts with an explicit role instruction: *"Use the attached
   image as a style reference only: match its medium, palette, paint handling, level of finish and
   lighting. Do not copy its subject or composition."* Roles must be stated in the prompt text or
   the model guesses.
2. **The byte-identical suffix.** Section 4. Paste, don't paraphrase.
3. **A single-generation contact sheet for the four vehicle portraits.** Strongest consistency
   available, because it is one denoise: ask for all four in a 2×2 grid in one image at 1:1 and
   4K, with "strict continuity across all four panels: identical medium, identical palette,
   identical key-light direction and angle, identical level of finish, identical camera height".
   Slice it, then re-render each cell at 4:5 using the sheet as style reference #2.
4. **Multi-turn chaining.** Keep everything in one chat. Always re-anchor to image #1, never to
   image #N−1, because drift compounds.

**Generate one image at a time.** The model does not reliably honour a requested output count.

**If clauses start dropping, cut the scene, never the style block.** Past roughly 200 words of
scene description the model starts silently ignoring things, and every prompt below runs longer
than that. Each one names its own cut order. The suffix is the durable asset across eight assets;
the scene is disposable and can be rebuilt in a follow-up turn.

### Anti-sheen and anti-slop vocabulary

Paste these verbatim. They are already in the suffix; this is the list to check against when a
candidate comes back wrong.

- Never write the bare word "airbrushed". It is the same token the retouching trade uses for
  plastic skin and it will smooth everything. Always attach the tooling: "airbrush over hand-cut
  frisket masks, hard mask edges where the spray stops, overspray speckle at the mask boundary".
- "Graduations built as discrete airbrush passes with faint banding at each transition, and a hard
  frisket edge where the light stops rather than a soft falloff."
- "No large surface carries a continuous even tone. Every panel is broken by at least three of: a
  shallow dent catching the key at a different angle, a sanded patch, a run in the clear, a wiped
  streak through the dust."
- "Every specular highlight on the bodywork is interrupted at least twice by a scratch or by
  orange-peel ripple in the clearcoat."
- "Highlights clip to a hard-edged white core with no halo around them. Falloff is inverse-square
  and reaches near-black within two vehicle lengths."
- "Brush direction follows the form of each panel, not the picture plane."
- "The tooth of the cold-press board reads through the midtones; paint sits on the raised grain and
  skips the pits."
- "Each chip shows its full paint-thickness edge — clearcoat over colour coat over grey primer over
  bare steel, four layers deep." The layer count is what makes wear read as observed rather than
  invented.
- "Sparks and embers are individual dots of opaque white and `#ff8c1a` applied last with a fine
  brush, sitting on top of everything, each with a short flicked motion trail and a small warm
  light-spill onto the metal beside it." This reads as paint; "particles" and "glowing embers" read
  as a render.
- "Dirt is packed into the tyre treads and thrown in clods, not sprayed as mist."
- "The grade is not orange and teal. The cool side is a desaturated slate, under ten per cent
  saturation, never cyan."
- "Roughly two-thirds of the frame sits below fifteen per cent brightness." A number the model can
  act on, where "dark and moody" is ignored.
- "Exaggerated 14mm-equivalent perspective distortion — drawn, not photographed." Any focal-length
  language must carry that trailing clause or it drags the whole image toward photography.
- "The composition sits slightly off-centre and the horizon is not level." Deliberate asymmetry is
  the cheapest anti-AI signal there is.

Words that must never appear in any prompt in this set, because each is a documented attractor
toward render, photograph, vector or sheen: polished, smooth, sleek, glossy, seamless, masterpiece,
epic, stunning, award-winning, beautiful, concept art, digital painting, photorealistic,
hyperrealistic, cinematic, trending, octane, unreal engine, studio lighting, bokeh, depth of field,
HDR, 4K, 8K, vector, minimalist, cel-shading, sticker, bold clean outlines. Resolution is a
dropdown, not a prompt word.

The word **flat** deserves its own line. It is a top-ranking vector attractor and the developer has
just rejected a flat style, so it is scrubbed out of every prompt here. Where it would have said
"blocked in as flat shapes" it says "broad masses and single loaded strokes"; where it would have
said "flat near-black" it says "a single unmodulated value".

### Failure modes and the wording that dodges each

| Failure | Wording that dodges it |
|---|---|
| AI sheen, plastic surface | The panel-break clause and the interrupted-specular clause, both in the suffix. Named physical medium with named defects at named locations. If a candidate is still waxy, the frisket clause probably got dropped — check it landed before re-rolling. |
| Over-smooth graduations | "Discrete airbrush passes with faint banding at each transition, and a hard frisket edge where the light stops." Never negate the gradient; replace it. |
| Grunge as an overlay | "All damage is painted into the form: it follows the curvature and perspective of each panel and receives the same key light as the intact paint. It is not a texture laid over the picture." Plus a cause and a location on every mark. |
| Brown or sepia wash | "Grime is rendered as value, never as a brown tint. Soot is a cool grey-blue in the shadows, oil is near-black with one warm specular edge, and there is no global sepia." Say the liveries hold chroma from the lit plane into the shadow. |
| Symmetric hero glow, bloom halo | One hard key, no fill, source named in the scene, far third to near-black. Then the positive replacement: clipped highlight cores, inverse-square falloff to near-black within two vehicle lengths. |
| Extra wheels, duplicated axles | "Four wheels, one at each corner", on every vehicle. Three-quarter views fail less than broadside. Correct multi-turn with "keep everything identical, correct the rear axle to a single wheel per side" rather than re-rolling and losing the drawing. |
| A sky appears in the reserved band | Strongest prior in the whole prompt. Specify a value, not emptiness, and list what must not cross it by name. Correct multi-turn: "keep everything identical, replace the top quarter with a single unmodulated `#0b0d10`." |
| Scribbled pseudo-lettering | The blanket "every surface is unlettered" clause is in the suffix so it propagates. Sign-shaped objects are still magnets; expect to paint some out. |
| Uniform detail density | Name the three fully rendered zones by object. Add that everything else still carries hard value contrast and a decided silhouette, or the thumbnail dies. |
| Orange washing across the red car | Physical separation, stated: "a band of unlit ground or a black panel gap sits between the fire and the red bodywork at every point." Correct multi-turn, do not re-roll. |
| Returns text instead of an image | Say "Create an image of". |
| Refusal or `IMAGE_SAFETY` | Front-load the medium words before any weapon noun — every prompt below opens with "Create an image of a fully worked-up airbrush-and-acrylic painted cover illustration". Aim damage at vehicles and property, never bodies. Immediate refusal is the prompt classifier: soften "machine gun" to "mounted cannon" and move on. Generation runs and nothing comes back is the image classifier: pull the camera back, shrink the fire, drop the helmet. Practitioner measurement puts the ceiling on borderline content at 70–80%, so budget a fifth of attempts returning nothing and don't argue with the filter. |

### The two gates, as commands

```sh
magick in.png -resize 400x -strip /tmp/thumb-400.png
magick in.png -colorspace Gray -format "%[fx:mean*100]" info:
```

Thumbnail first, luminance second. The build measures **10.6% mean luminance**, **98.3% of pixels
below luminance 64** and **94.6% of pixels effectively greyscale**. A bright saturated poster over
that is a bait-and-switch and the complaint writes itself, so the composite gate is 15.

The wordmark eats most of the headroom and the arithmetic is worth doing once. `#e6edf3` has a luma
around 92% and `#0b0d10` around 5%, so every 1% of frame the off-white letterforms cover adds about
0.87 points. Letterform ink at 5% of frame costs 4.4 points; at 8% it costs 7.0. **Keep the mark's
ink under 5% of frame and measure the illustration plate at 10% or under**, and the composite
lands inside the gate with the build's own number as the plate budget. Measure the composite, never
the plate alone.

---

## The style suffix

Append this to every prompt. Byte-identical. Do not paraphrase, do not trim, do not reorder.

```
STYLE — apply exactly, do not reinterpret.

MEDIUM. Painted cover illustration — not a photograph, not a 3D render, not digital concept art, not vector art. Airbrush and acrylic on cold-press illustration board, in the tradition of late-1980s to late-1990s console box art, airbrushed heavy-metal LP sleeves and hand-painted county-fair demolition-derby posters. Airbrush laid down over hand-cut frisket masks: hard mask edges where the spray stops, overspray speckle at every mask boundary, graduations built as discrete passes with faint banding at each transition rather than continuous falloff. Dry-brushed acrylic on every metal edge. Opaque-white speculars scratched in last with a fine brush. Ink and dye in the deepest shadows. The tooth of the board reads through the midtones, paint sitting on the raised grain and skipping the pits. Brush direction follows the form of each panel, not the picture plane. The paint does not quite reach the board edge in the lower right.

PAINT AND SURFACE. Vehicle paint is an opaque base coat with a transparent wet clearcoat over it. The base coat is laid in three or four separated value steps per panel with dry-brush transitions between them, so the lit face of each panel is the true livery colour. The clearcoat is the mirror: deep and wet, with a cool reflected edge running along the underside of every panel and a hot white specular scratched in last. Chrome is painted as the classic split reflection — dark ground reflection below, pale reflection above, a hard horizon line between them, fine bright scratches cutting through the reflection in the opposite direction to the surface they sit on, never a soft metallic gradient. No large surface carries a continuous even tone: every panel is broken by at least three of a shallow dent catching the key at a different angle, a sanded patch, a run in the clear, or a wiped streak through the dust. Every specular highlight on the bodywork is interrupted at least twice by a scratch or by orange-peel ripple in the clearcoat.

COLOUR. Locked to #d8452f rust red, #3f8ecc faded blue, #6bbf59 dirty green, #c9a227 mustard gold, #ff8c1a boost orange, #fff2df key white, #e6edf3 off-white, #6b5a3e desert ochre, #2a323c concrete grey, #4c5666 pale concrete and #0b0d10 night black. The four car colours hold full chroma from the lit plane into the shadow, however filthy the car is. #ff8c1a belongs only to things that emit light — painted boost chevrons, muzzle flash, fire, ember — and it never physically touches #d8452f or #c9a227: a band of unlit ground or a black panel gap always separates them. Grime is rendered as value and temperature, never as a brown tint: soot is a cool grey-blue in the shadows, oil is near-black with one warm specular edge, dust is a pale cool film. There is no global sepia anywhere. The grade is not orange and teal; the cool side is a desaturated slate, under ten per cent saturation, never cyan.

LIGHT. One hard key of warm near-white #fff2df, no fill, motivated by a floodlight mast standing inside the scene or just outside the frame edge. The key is warm but almost unsaturated and can never be as saturated as the chevrons. The far third of every subject falls to near-black silhouette held by a single scraped highlight along the edge. Cast shadows are hard-edged and read as shape. Highlights clip to a hard-edged white core with no halo around them, and falloff is inverse-square, reaching near-black within two vehicle lengths. No rim light on both sides of any object, no bloom, no glow halo, no symmetrical backlight, no atmospheric haze and no fog — the air is clear and the black is empty black.

MATERIALS AND WEAR. Every mark of damage has a cause and a location. Rust blooms orange with dark pitting at its centre and bleeds downward from bolt heads and weld seams, chalky and matte, with a hard bright edge where it meets intact paint. Paint chips carry a visible paint-thickness edge and cluster on the leading edges that get struck, showing clearcoat over colour coat over grey primer over bare steel, four layers deep. Welds are proud and blued, ground flat in some places and not others. Soot feathers back from exhaust ports and gun muzzles, heaviest at the source, sitting only on upward-facing surfaces. Oil is near-black and wet, pooled in the panel seams and the ground ruts, with a thin warm specular line along the edge of each pool. Brake dust cakes pale grey in the wheel arches and is wiped clean in an arc where the tyre throws it. Exhaust steel is heat-tinted straw, then blue, then violet running away from the port. Mud is thrown in fans behind the wheels, wet and dark at the centre and drying chalky pale at the edge. Dust settles only in the dead-air zones — behind the mirror, in the door shut-line, under the roof rack. Dirt is packed into the tyre treads and thrown in clods, not sprayed as mist. All of this is painted into the form: it follows the curvature and perspective of each panel and receives the same key light as the intact paint. It is not a texture laid over the picture.

FINISH. Detail hierarchy is deliberate and severe: exactly three zones are taken to a full mirror finish and everything else is resolved in broad masses and single loaded strokes. The three mirror zones are the only places exempt from the value-step rule. Do not render every rivet — the wall, the far cars and the ground beyond the mid-ground are blocked in with a palette knife, but the summarised passages still carry hard value contrast and a decided silhouette so the picture holds at thumbnail size. Sparks and embers are the last marks made: individual dots of opaque white and #ff8c1a from a fine brush, sitting on top of everything, each with a short flicked motion trail and a small warm light-spill onto the metal beside it. Roughly two-thirds of the frame sits below fifteen per cent brightness. The composition sits slightly off-centre and the horizon is not level.

CAMERA. Always low: between 0.3 and 1.5 metres above the dirt, bonnet height or below, never raised and never aerial. Three-point perspective with the vanishing points pushed off-canvas. Exaggerated wide-angle perspective distortion — drawn, not photographed.

VEHICLES. Every vehicle has four wheels, one at each corner. All vehicle glass is opaque black with a single hard reflected highlight and no car has a driver. No visible faces and no visible skin anywhere in the image.

REPRODUCTION. As scanned from a painted board printed on a 1993 box: faint offset ink misregistration on the highest-contrast edges only, slight paper warmth, a very faint bevel where the original board edge was. The surface is continuous painted pigment throughout, with no printed dot pattern anywhere.

CONSTRAINTS. Every surface in the picture is unlettered — bodywork, walls, ground, hoardings, fencing and props carry no writing, numerals, logos, signage or symbols of any kind, and every sign-shaped object is blank. No other text anywhere in the image. No lens flare, no bloom, no glow halo, no vignette, no watermark, no signature. Not a 3D render, not a photograph, not digital concept art, not vector art.
```

That block is roughly 900 words and it is the durable asset. It survives every scene rewrite, it is
what the style-reference slot reinforces rather than replaces, and it is the only thing in this
document that must not be edited casually. If a generation comes back wrong, check whether the
frisket clause, the layer-order clause and the detail-hierarchy clause actually landed **before**
you touch it — a suffix that turns out to be half-inert is worse than a shorter one that works, and
that check happens once, on generation one, not on generation forty.

---

## Prompt 1 — key art

`gemini-3-pro-image`. Aspect ratio **16:9**, image size **2K**, both set in the right-hand run
settings panel. One image at a time.

```
Create an image of a fully worked-up airbrush-and-acrylic painted cover illustration for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. The scene is a floodlit night arena of dirt and concrete. All damage in this picture is to machinery and property. Build it in this order.

First, build the ground. A bounded arena floor of dry high-desert dirt in ochre #6b5a3e, churned into deep wheel-cut ruts with standing water and near-black oil pools sitting in them. Running across the middle distance is a four-metre board-formed concrete perimeter wall in grey #2a323c, stained and chipped, scorched in feathered black blooms that are heaviest at each bloom's centre, with two squat pale concrete pillars in front of it. Bulldozed into a low berm along the base of the wall are three derelict wrecked cars, stripped to grey steel and bare orange rust, roofs caved, wheels gone. They carry no paint colour at all. Above and behind the wall there is only unlit black night with no stars, no moon and no cloud.

Then, at frame-left in the near-middle ground, a broad tent-shaped dirt ramp with three chevron arrows painted in #ff8c1a on its short steep back face. The chevrons are freshly painted and catch the key, throwing a low warm pool of orange across the dirt at the foot of the ramp only.

Then the hero. A battered armoured sports coupe in rust red #d8452f — welded steel plate bolted over the doors, a heavy tubular bull bar across the nose, a roof rack, an exposed roll cage, and one machine gun mounted on the bonnet with its barrel raked slightly up and to the right. It is airborne off the ramp, all four wheels clear of the dirt, nose high, turned three-quarters toward the picture plane and slightly across it, with clods of dirt still falling out of the tyre treads and off the undertray. It has four wheels, one at each corner. Its near-side window has no glass left, only the black rubber channel and a bent frame, and inside the cage sits a full-face crash helmet with a mirrored visor down and sealed — bare scuffed shell going grey at the crown, a chipped hand-painted band across the top in the same rust red, soot on the chin bar. The visor is an opaque black mirror carrying one small warped reflection of the floodlight mast and the chevrons. No skin, no face, no eyes, no hands.

Then three rival cars, smaller and further back, so the full cast reads. A #c9a227 mustard-gold low unarmoured sports car in close pursuit at frame-right in the mid-ground, catching one hard edge of key light down its flank. A #3f8ecc faded-blue armoured pickup with a plated flatbed further back at frame-right near the wall. A #6bbf59 dirty-green slab-sided armoured box truck at far frame-left against the wall, almost in silhouette. Each has four wheels, one at each corner.

Finally, at frame-left just past the ramp, a wrecked car burns on the dirt: torn sheet metal, a shredded tyre carcass unwinding, hydraulic fluid pooled near-black on the ground, and a column of backlit smoke rising and dispersing before it reaches the top of the frame. A band of unlit dirt separates the fire and the chevrons from the red car's bodywork at every point.

CAMERA. Worm's-eye view, camera height thirty centimetres above the dirt. The horizon line sits in the bottom quarter of the frame. Three-point perspective with all vanishing points pushed off-canvas, exaggerated 14mm-equivalent perspective distortion — drawn, not photographed. The hero's bull bar fills the lower-left third of the frame and the front-left tyre is cropped by the bottom frame edge; the rear of the car tapers to a third of that width. The bonnet gun barrel rakes up toward the upper right and stops short of the top of the frame. The mirrored visor sits one third in from the left edge and slightly above the vertical centre.

LIGHT. One hard key from camera-left, twenty-five degrees above the horizon, motivated by a steel lattice floodlight mast standing just outside the left frame edge — warm near-white #fff2df, throwing hard-edged shadows to the right across the dirt. No fill light. The right third of the hero falls to near-black silhouette. The only other light is warm and low: #ff8c1a from the chevron paint, the burning wreck and the muzzle flash, sitting inside the shadows as its own value without lifting them.

DETAIL HIERARCHY. Taken to a full mirror finish in only three places: the mirrored visor and the bent window frame around it; the front-left wheel arch, tyre sidewall and the wet clearcoat over it; and the bull bar with the muzzle of the bonnet gun behind it. Everything else is resolved in broad masses and single loaded strokes.

GRIT. Rust bleeds downward from the bolt heads along the welded door plate in vertical streaks that follow gravity and pool at the sill seam. Paint is chipped away at the leading edge of the bull bar and along the front wing where stones have struck it, each chip showing its full paint-thickness edge — clearcoat over colour coat over grey primer over bare steel, four layers deep. Soot feathers back across the bonnet from the gun muzzle, heaviest at the muzzle. Brake dust cakes pale grey in the front-left wheel arch and is wiped clean in an arc where the tyre throws it. Mud is thrown in fans behind the wheels, wet and dark at the centre and drying chalky pale at the edge. Fine bright scratches cut through the chrome reflection on the bull bar and the roll-cage tube, catching the light in the opposite direction to the surface they sit on.

RESERVED SPACE. The top twenty-four percent of the frame is unbroken night at a single unmodulated #0b0d10 — one value, no rendered detail, no bright pixel, clean negative space for a logo. Nothing crosses into that band: no spark, no smoke plume, no floodlight mast, no gun barrel, no antenna. The tallest element in the composition tops out just below it.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Aspect ratio 16:9.
```

**Cut order if clauses start dropping.** The three rival cars collapse to one sentence. Then the
derelict hulks go. Then the burning wreck. Then the pillars. If the reserved band is what drops,
re-roll — that one is not negotiable, and neither is the suffix.

### How to judge the result

Gates first, taste second, and in this order.

1. **Downscale to 400 px and look at it before anything else.** The hero silhouette against the
   reserved band has to carry the whole image on its own. If it is a dark smear with three bright
   spots, the summarised passages lost their value contrast and the picture has failed at the size
   most people will meet it.
2. **Mean luminance under 10 on the plate.** Over that and the composite will not survive the
   wordmark. Fix by darkening the dirt, shrinking the fire and enlarging the reserved band — never
   by dimming the chrome, because dimming the chrome removes the direction.
3. **Eyedropper the mid-value of the red bonnet.** It should be `#d8452f` or within a few points.
   If firelight has washed it orange, correct multi-turn: *"keep everything identical, remove all
   orange light from the red car's bodywork and put a band of unlit dirt between the fire and the
   car."* Do not re-roll — you lose the drawing.
4. **Check the visor.** If it came back with skin, an eye or a mouth, correct multi-turn: *"keep
   everything identical, replace the visor with an opaque black mirror reflecting the floodlight;
   there is no face and no skin."* If that recurs twice, cut the helmet and shoot the same
   composition with an empty cab. The picture survives it, and a helmet strapped into a harness
   with nobody in it reads more sinister anyway.
5. **Count the wheels.** Four per car, one at each corner. Correct multi-turn, never re-roll.
6. **Check the reserved band for smoke, stars or a warm gradient.** Correct multi-turn: *"keep
   everything identical, replace the top quarter of the image with a single unmodulated `#0b0d10`."*
7. **Check the derelict hulks for livery colour.** Told to paint dead cars beside four coloured
   ones, the model will occasionally give a wreck a faded blue or a red. That breaks the four-hex
   key, which is the one thing in this project that cannot break.
8. **Then look at whether the mirror is a mirror.** Split reflection with a hard horizon line, or a
   soft metallic gradient. The second one is the whole direction failing quietly.

### Two variations, one variable each

**Variation A — the hero is planted, not airborne.** Change only the hero paragraph: the coupe is
on the ground, all four wheels down, broadside and sliding hard toward camera-left with the front
wheels turned into the slide, throwing a wall of dirt clods off the near-side tyres. Everything
else identical, including the camera, the light and the suffix. This tests whether the jump is
selling the picture or the paint is. If A wins, the flight was decoration.

**Variation B — the portrait trim.** Same prompt, one dropdown: aspect ratio **3:4**, image size
**2K**, output 1792×2400. A game box is portrait and the reference the developer named is a
portrait object, so this costs one dropdown and it is worth having both on screen side by side.
The reserved band stays at 24% of frame height, which on 3:4 is a deeper block and takes the
two-line mark more comfortably. Choose between them by looking, not by argument.

---

## The wordmark

The typography is the one thing that survived the rejected pass, so it keeps its bones and gets
brutalised in the surface only. **Grunge goes in the surface, never in the geometry.** The moment a
letter skews, arcs, tapers, splinters or leans, it stops being the approved mark and becomes a
generic metal logo.

### What survived

Ten properties. Everything else is available.

| # | Property | Why it matters |
|---|---|---|
| 1 | Two-line stack, flush block. "DEAD" over "PEDAL", both lines the same measure, so the pair reads as one solid rectangle. | The single most recognisable property. Four characters over five, so you get flush edges by scaling each line's point size until the widths match — never by tracking DEAD apart. Cap heights differ, DEAD landing 15–20% taller. That difference is what makes the block edges read as cut rather than typeset. |
| 2 | Very heavy. Stroke width roughly a quarter of cap height, counters small slot-shaped voids. | If a treatment thins the strokes it has failed, however good the texture is. |
| 3 | Condensed. Cap height to average character width around 2:1. | Each glyph is a tall narrow rectangle and the block is wider than tall. |
| 4 | Geometric grotesque skeleton, flat terminals. Horizontal cuts, near-vertical stems, no bracketing, no serifs, no spurs, no thick-thin contrast. | The D is a rectangle with one turned end. The E's three arms are the same length. |
| 5 | Tight letterspacing. Negative tracking, sidebearings almost gone. | Deliberately the opposite of the HUD's `0.18em`, and that opposition is doing real work: the display face is loud, the overlay is quiet. |
| 6 | Hard-edged offset accent, displaced right and slightly down. No blur, no falloff, no opacity ramp. | Not a drop shadow. It reads as a manufacturing artefact — a second pass, a double strike, a misregistration — which is exactly why it survives into every metal treatment, and why the painted reproduction chain underneath it rhymes rather than clashes. |
| 7 | One offset for the whole mark, not one per line. | A misregistered pass displaces the whole plate. Compute one absolute displacement from PEDAL's cap height and apply it identically to both lines. |
| 8 | Two-value system on near-black. `#e6edf3` does all the letterform work, `#ff8c1a` does only the offset, field is `#0b0d10`. | No third value inside the letters in the base mark. The treatments add material variation; they do not add a third brand colour. |
| 9 | Maximum value contrast. | Off-white against near-black is what survives a 400 px link preview. Any treatment that pulls the letterforms toward mid-grey has traded the one property that makes the mark work at thumbnail size for texture nobody will see there. |
| 10 | Nothing else in the mark. Two words, no icon, no chevron, no skull, no rule, no bar, no keyline, no containing shape. Level, centred, symmetrical. | This is also why the cover's mirrored visor is a detail and not a mascot: nothing that appears on the cover can enter the mark, so a cover element that only works as a logo is a cover element with nowhere to live. |

The adjacency rule bites here too. `#ff8c1a` sits between `#d8452f` and `#c9a227` in hue and must
never touch either. On near-black the mark is safe; the moment it is composited over the player's
red car it is not.

### Do not let the model render the shipping wordmark

Short strings land often — one to four words hit around 80% first try on this generation, and
"DEAD PEDAL" is close to the best case at two words and ten characters. That is not the problem.
The problem is that it will not land *identically* twice, and a mark that drifts in kerning and
letterform across eight assets is not a mark. Every generated image also carries a SynthID
watermark, which is a second reason the model output is a texture source and never the shipping
file.

Reserving negative space and compositing real type is not a workaround. It is a documented
first-class use case, and it is why every prompt in this document reserves a band.

### Four grunge treatments

Generate these as exploration and as texture sources. Each is self-contained; the style suffix is
**not** appended, because these are studies on a bare field rather than assets in the set. 16:9,
2K, `gemini-3-pro-image`.

**1. Struck plate — die-stamped and corroded mild steel.** The default, and the one to try first.
Most legible, most controlled, closest to the approved mark's crisp geometry, and the only one
whose damage makes the letterforms sharper rather than softer — the deboss puts a hard bright edge
on every stem. It is also the only one that survives derivation to a 32 px favicon, because a
deboss reduces cleanly to a two-value shape. If you are shipping one treatment and never revisiting
it, ship this.

```
Create an image of a title wordmark for a stylised arcade vehicular-combat video game, painted as cover illustration in the tradition of early-1990s airbrushed game box art. Acrylic and airbrush on cold-press illustration board, airbrushed over hand-cut frisket masks so every letterform edge is a hard mask edge rather than a brush edge, with dry-brushed acrylic highlights and hand-scratched opaque-white speculars applied last with a fine brush. The tooth of the board reads through the midtones.

Subject: a single slab of heavy mild steel filling the frame, with the title die-struck into it by a drop press. The word "DEAD" sits on the upper line and the word "PEDAL" sits directly beneath it. The two lines are scaled so they are exactly the same width and the pair reads as one solid rectangular block with flush left and right edges. The type is a very heavy condensed grotesque: flat horizontal terminals, near-vertical stems, no serifs and no bracketing, tight negative letterspacing so adjacent letters almost touch, small slot-shaped counters, and a stroke width about one quarter of the cap height.

The letters are pressed three millimetres down into the plate. Their struck faces are burnished bright to an off-white #E6EDF3 where the die crushed the metal; the surrounding plate stays a dark grey steel. A second misaligned strike of the same word shows as a hard-edged ghost displaced to the right and slightly down, filled with warm oxide orange #FF8C1A — a hard cut edge, not a soft shadow, no blur, no glow, no falloff.

Corrosion: rust bleeding downward from the bottom inside edge of each letter, pooling where the stamped wall meets the plate floor, an orange bloom with dark pitting at its centre, chalky and matte, with a hard bright edge where the rust meets clean steel. Fine bright scratch lines cut across the burnished faces at an angle to the plate's mill grain. Soot sits only on the upward-facing ledges. The damage is unevenly distributed: heaviest at the lower left of "PEDAL" and along the top edge of "DEAD", almost absent through the centre of the block. All of it is painted into the form, following each pressed wall and receiving the same key light as the clean metal. It is not a texture laid over the picture.

The letterforms stay geometrically intact and fully legible. Erosion is additive only: pitting inside the strokes and small bites out of the outer contours. No letter is broken through, no stroke is severed, no counter is filled.

One hard key from upper left, thirty degrees above horizontal, no fill. The left and top interior walls of each letter catch the light; the right and bottom walls fall to near-black. The palette holds its chroma: the orange stays orange, and grime is rendered as value and never as a brown tint across the whole image.

Behind and around the plate there is nothing: an even near-black field #0B0D10 at a single unmodulated value, with no scene, no gradient, no vignette and no rendered detail, and a generous even margin on all four sides so the mark can be cut out.

No other text anywhere in the image. No lens flare, no bloom, no glow halo. Not a photograph, not a 3D render, not a logo mockup. Aspect ratio 16:9.
```

**2. Stencil over rust — off-white spray through a hand-cut stencil on a rusted sheet.** The only
treatment where the mark is paint rather than metal, and the loudest of the four. It preserves the
offset accent literally, as a real two-pass registration failure. Use it where the mark has to
fight rendered illustration and win. It brings one typographic feature with it: a hand-cut stencil
needs bridges holding the counters of D, E, A and P, and those bridges are the first thing to close
up on a downscale. Do not use it as the source for anything below about 300 px — a filled counter
turns the D into an O.

```
Create an image of a title wordmark for a stylised arcade vehicular-combat video game, painted as cover illustration in the tradition of early-1990s airbrushed game box art and airbrushed heavy-metal LP sleeves. Acrylic and airbrush on cold-press illustration board, sprayed over hand-cut frisket masks so every letterform edge is a hard mask edge with fine overspray speckle just outside it. Dry-brushed acrylic and hand-scratched opaque-white speculars applied last with a fine brush.

Subject: a sheet of rusted steel filling the frame, with the title sprayed onto it through a hand-cut card stencil. The word "DEAD" sits on the upper line and the word "PEDAL" sits directly beneath it. The two lines are scaled so they are exactly the same width and the pair reads as one solid rectangular block with flush left and right edges. The type is a very heavy condensed grotesque: flat horizontal terminals, near-vertical stems, no serifs, tight negative letterspacing so adjacent letters almost touch, small slot-shaped counters, and a stroke width about one quarter of the cap height.

The spray is an opaque off-white #E6EDF3. Because the stencil was cut by hand from card, each enclosed counter is held by a clean straight bridge bar: a narrow horizontal gap crossing the counters of the D, the A, the E and the P. Those bridges are deliberate, straight and crisp — they are cuts, not damage. A second pass of the same stencil, shifted to the right and slightly down, is sprayed in warm orange #FF8C1A and shows only where it clears the off-white: a hard-edged offset, no blur, no gradient, no glow.

The spray behaves like real aerosol: hard mask edges where the card sat against the sheet, a soft feathered bleed under the two corners where the card lifted, overspray speckle scattered a few centimetres beyond the stencil boundary, and two thin runs where the paint went on too wet and dripped straight down before drying. Paint has chipped off the high points of the rusted sheet, leaving the off-white broken and grainy over the roughest corrosion and solid over the even areas. Rust bleeds downward from the sheet's bolt holes in vertical streaks that follow gravity and pool at the lower seam: orange bloom with dark pitting at its centre, chalky and matte, with a hard bright edge where it meets intact paint. The wear is unevenly distributed, heaviest along the bottom of "PEDAL" and thinning to almost nothing across the top of "DEAD". All of it is painted into the form, following the sheet's dents and receiving the same key light as the clean surface. It is not a texture laid over the picture.

The letterforms stay geometrically intact and fully legible. Erosion is additive only: pitting inside the strokes and small bites out of the outer contours. No letter is broken through, no stroke is severed, no counter is filled beyond its bridge.

One hard key from upper left, thirty degrees above horizontal, no fill. The right edge of the sheet falls toward near-black. The palette holds its chroma: the orange stays orange, and grime is rendered as value and never as a brown tint across the whole image.

Around the sheet there is nothing: an even near-black field #0B0D10 at a single unmodulated value, with no scene, no gradient, no vignette and no rendered detail, and a generous even margin on all four sides so the mark can be cut out.

No other text anywhere in the image. No lens flare, no bloom, no glow halo. Not a photograph, not a 3D render, not a logo mockup. Aspect ratio 16:9.
```

**3. Torch-cut and welded plate — fabricated letterforms with grind marks and weld beads.** Each
letter oxy-fuel cut from 10 mm plate and tacked to a backing plate, so the mark is assembled rather
than made. The offset accent becomes the orange oxide primer on the backing plate, showing in the
hard gap down-right of every letter. This is the treatment that ties the wordmark to the vehicle
design language — welded plate armour, bull bars, roll cages — so the cover and the cars are
demonstrably out of the same shop. It is also the most physically deep, which means it needs air
around it and will fight a busy cover. Weakest at small sizes: the relief collapses below about
400 px and you lose the orange, which is structural here rather than decorative.

```
Create an image of a title wordmark for a stylised arcade vehicular-combat video game, painted as cover illustration in the tradition of early-1990s airbrushed game box art. Acrylic and airbrush on cold-press illustration board, airbrushed over hand-cut frisket masks so every letterform edge is a hard mask edge rather than a brush edge, graduations built as discrete airbrush passes with faint banding at each transition, and hand-scratched opaque-white speculars applied last with a fine brush.

Subject: the title fabricated as separate letters cut from ten-millimetre steel plate with an oxy-fuel torch and tack-welded onto a backing plate. The word "DEAD" sits on the upper line and the word "PEDAL" sits directly beneath it. The two lines are scaled so they are exactly the same width and the pair reads as one solid rectangular block with flush left and right edges. The type is a very heavy condensed grotesque: flat horizontal terminals, near-vertical stems, no serifs, tight negative letterspacing so adjacent letters almost touch, small slot-shaped counters, and a stroke width about one quarter of the cap height.

The letter faces are ground and wire-brushed back to a bright off-white steel #E6EDF3, with visible circular swirl marks left by the grinding disc. The cut edges of the plate show vertical drag lines from the torch and small hardened dross beads hanging under the bottom of each cut. Short weld beads run where each letter meets the backing plate, stacked as overlapping ripples; a few have been ground flush and show bright bare metal, the rest are left proud and dark. Straw, bronze and peacock heat-tint colours halo outward from every weld and from the torch cuts, painted as discrete banded steps rather than a continuous gradient.

The letters stand about fifteen millimetres proud of the backing plate. That backing plate is coated in warm orange oxide primer #FF8C1A, and it shows as a hard-edged band of orange down the right side and along the bottom of every letter where the raised plate does not cover it — a hard cut edge, not a shadow, no blur, no gradient, no glow.

Grime: spatter from the welding stuck to the plate around each bead as hard little dots of solidified metal. Soot feathered back from the torch cuts, matte, sitting only on the upward-facing surfaces. Rust starting at the untreated bottom edges of the plate and bleeding downward in vertical streaks that pool at the seam. The damage is unevenly distributed, heaviest around the joints at the lower left of "PEDAL" and almost absent across the centre of the block. All of it is painted into the form, following the curvature of each plate and receiving the same key light as the clean steel. It is not a texture laid over the picture.

The letterforms stay geometrically intact and fully legible. Weld beads and dross sit at the joints only and never cross a counter. No letter is broken through, no stroke is severed, no counter is filled.

One hard key from upper left, thirty degrees above horizontal, no fill. The right side of every letter falls to near-black. The palette holds its chroma: the orange primer stays orange, and grime is rendered as value and never as a brown tint across the whole image.

Around the backing plate there is nothing: an even near-black field #0B0D10 at a single unmodulated value, with no scene, no gradient, no vignette and no rendered detail, and a generous even margin on all four sides so the mark can be cut out.

No other text anywhere in the image. No lens flare, no bloom, no glow halo, no sparks. Not a photograph, not a 3D render, not a logo mockup. Aspect ratio 16:9.
```

**4. Sand-cast iron — a single poured casting with pitting and parting flash.** The whole two-line
block as one monolithic casting: grainy sand surface, gas porosity, a single horizontal parting
line with a ragged fin of flash along it. The offset becomes a second impression still pressed into
the moulding sand, packed with orange foundry sand. The odd one out, and worth generating precisely
because it will tell you whether the mark should belong to the cars or sit above them. The soft
cast contour is the trade: it eats the counters first, so it is the worst performer below 400 px
and the wrong source for the favicon. Also the treatment most likely to need re-rolls, because
casting flash is the one damage type the model will happily run across a counter and break a letter
with.

```
Create an image of a title wordmark for a stylised arcade vehicular-combat video game, painted as cover illustration in the tradition of early-1990s airbrushed game box art. Acrylic and airbrush on cold-press illustration board, airbrushed over hand-cut frisket masks so every letterform edge is a hard mask edge rather than a brush edge, with dry-brushed acrylic and hand-scratched opaque-white speculars applied last with a fine brush. The tooth of the board reads through the midtones.

Subject: the title as a single monolithic iron casting, poured in a green-sand mould and lying face up. The word "DEAD" sits on the upper line and the word "PEDAL" sits directly beneath it, cast as one connected piece. The two lines are scaled so they are exactly the same width and the pair reads as one solid rectangular block with flush left and right edges. The type is a very heavy condensed grotesque: flat horizontal terminals, near-vertical stems, no serifs, tight negative letterspacing so adjacent letters almost touch, small slot-shaped counters, and a stroke width about one quarter of the cap height.

The casting is thick and blunt. Its top planes have been filed and wire-brushed back to a bright off-white iron #E6EDF3; the vertical sides stay dark unfinished black iron, so the mark reads as two values. The whole surface carries the fine grain of the moulding sand, matte and slightly powdery, with scattered round gas-porosity pits punched into the filed faces. A single mould parting line runs straight and horizontal across the entire block at one consistent height, and along it a thin ragged fin of casting flash has been squeezed out, hard and irregular. A broken sprue stub sits at the top left corner of the block where the metal was poured in.

Displaced to the right and slightly down, a second impression of the same word is still pressed into the moulding sand beside the casting, packed with warm orange foundry sand #FF8C1A. It is a hard-edged shape, the exact negative the casting came from — not a shadow, not a glow, no blur, no gradient.

Grime: black iron oxide dust settled in the counters and along the base of every stem. Rust bleeding downward from the porosity pits in short vertical streaks that pool at the parting line, orange bloom with dark pitting at its centre. Fine bright file scratches cut across the filed faces in one consistent direction. The damage is unevenly distributed, heaviest along the lower left of "PEDAL" and almost absent across the centre of the block. All of it is painted into the form, following the curvature of each cast letter and receiving the same key light as the filed metal. It is not a texture laid over the picture.

The letterforms stay geometrically intact and fully legible. Casting flash appears only along the single parting line and nowhere else. Erosion is additive only: pitting inside the strokes and small bites out of the outer contours. No letter is broken through, no stroke is severed, no counter is filled.

One hard key from upper left, thirty degrees above horizontal, no fill. The right side of every letter falls to near-black. The palette holds its chroma: the orange sand stays orange, and grime is rendered as value and never as a brown tint across the whole image.

Around the casting and the sand there is nothing: an even near-black field #0B0D10 at a single unmodulated value, with no scene, no gradient, no vignette and no rendered detail, and a generous even margin on all four sides so the mark can be cut out.

No other text anywhere in the image. No lens flare, no bloom, no glow halo, no molten metal. Not a photograph, not a 3D render, not a logo mockup. Aspect ratio 16:9.
```

Judge these on shape and weight only. Whatever they hand you, the shipping mark gets rebuilt in
real type and the model output becomes a greyscale texture source.

### The face

| Face | Licence | Read |
|---|---|---|
| `Anton` | SIL OFL 1.1, Google Fonts | **The default pick.** Single weight, all-caps display, very heavy, condensed, flat horizontal terminals, near-zero sidebearings, slot counters. Closest free match to the approved bones and it needs almost nothing beyond tracking. |
| `Sofia Sans Extra Condensed` | SIL OFL 1.1, Google Fonts | Variable weight to 1000. Narrower and heavier at the top of the axis than Anton, and the real weight axis lets you land stroke width at exactly a quarter of cap height rather than accepting what Anton ships. |
| `Archivo` (variable, weight to 900, width axis) | SIL OFL 1.1, Google Fonts | **The tuneable option.** Dial width down and weight up and you land close to a commercial condensed black, then freeze that named instance and outline it. Same superfamily covers UI text, so the menu never needs a second licence. |
| `Big Shoulders` | SIL OFL 1.1, Google Fonts | Ink traps already cut into the letterforms, which read as manufacturing defects at large size and do some grunge work before any distress is applied. Genuinely useful under struck plate and cast iron. Costs weight: it is tall and narrow rather than heavy and blunt, so the block reads lighter than the approved mark. |
| `Saira ExtraCondensed` 900 | SIL OFL 1.1, Google Fonts | Neutral heavy condensed grotesque, a clean fallback if Anton reads too familiar. Slightly more mechanical and less geometric. |
| `Bebas Neue`, `Oswald` | SIL OFL 1.1 | Both wrong, listed so they get ruled out rather than tried and abandoned. Bebas is far too light; Oswald tops out at 700 and is text-adjacent. Both fail the quarter-of-cap-height rule, and outlining then dilating to add weight destroys the counters. |
| `Druk Condensed`, `Compacta`, `Knockout`, `GT America Compressed Black` | Commercial, desktop and web licensed separately | These are the reference articles for very heavy condensed display grotesques and Compacta is the most historically honest for the box-art era being reached for. Safe to *use*: outline the two words and ship paths, so no font binary enters the repo. Not safe to self-host as a webfont without the web licence. Read the EULA's logo clause before adopting one as a trademark — some foundries require an extended licence for marks. |

**The licence rule, once, covering all of the above.** The shipping wordmark is outlined paths in an
SVG, so no font file ships with it and the question is narrow: almost every commercial EULA permits
converting purchased type to outlines for a logo, and OFL permits everything. It only becomes live
if the browser menu renders live text in the display face, because that is webfont distribution.
That is the strongest argument for Anton or Archivo — with an OFL face you can self-host, and
`index.html` currently loads no webfont at all, so whatever you pick is new network weight on a
demo page.

### Production plan

The mark is two files and confusing them wastes a day. **The identity is vector; the distress is
raster.** Distress is high-frequency by definition: auto-traced it becomes a 3–8 MB SVG with tens
of thousands of nodes that stalls the browser on the menu screen, and it still looks fake, because
a vectorised chip has a smooth Bézier contour and a real chip does not. The SVG never carries the
grunge.

| Path | What it is |
|---|---|
| `_art/wordmark-master.svg` | Clean outlines, two colours, no distress. Source of truth. Never served. |
| `_art/grunge-map.png` | Greyscale, 4000 px wide. The distress as a file, which is what makes the mark reproducible. |
| `_art/wordmark-distressed.png` | 4000 px, straight alpha. The raster master. |
| `docs/art/wordmark.png` | 2400 px, transparent. README and GitHub. |
| `docs/art/favicon-32.png`, `docs/art/favicon.svg` | Derived, clean, no distress. |
| `public/art/wordmark.webp` | 1200 px, 60–90 KB. The only copy the running game downloads. |

**Setting the type.** Set "DEAD" and "PEDAL" as two separate text objects with identical tracking on
both lines — that tightness is property 5 and it must not vary between lines. Scale each line's
point size until the two widths are equal to the pixel; DEAD comes out 15–20% taller in cap height,
which is correct. Baseline to baseline is 1.05–1.10 of PEDAL's cap height, so the lines nearly
touch. **Never horizontal-scale the glyphs to force the widths to match** — that breaks the
stem-to-counter ratio and the mark stops reading heavy. Convert to outlines, delete the live text,
then optically correct the two pairs that go wrong under tight tracking: the DE in DEAD and the LA
in PEDAL are the usual offenders.

**The offset, in relative units so it survives scaling.** One displacement for the whole mark,
computed once from PEDAL's cap height H and applied identically to both lines. Start at 0.045H
right and 0.028H down, roughly 32° below horizontal, and adjust by eye at 800 px. At H = 400 px
that is 18 px right, 11 px down. The orange duplicate sits behind the off-white at 100% opacity,
zero blur, zero feather.

**Applying the distress, with one knob.** Multiply the greyscale grunge map into the type's alpha
channel. That is the whole technique, and the reason is worth understanding rather than copying:
multiplying into alpha means erosion can only ever eat inward. It is mechanically impossible to
break the silhouette outward, add a stray mark outside a letter, or produce the floating-overlay
look. "Erosion is additive only, no stroke severed" stops being a hope and becomes a property of
the pipeline.

```sh
magick -background none _art/wordmark-master.svg -resize 4000x _art/wordmark-clean.png

magick _art/grunge-source.png -colorspace Gray -resize 4000x -level 30%,85% _art/grunge-map.png

magick _art/wordmark-clean.png \
  \( +clone -alpha extract _art/grunge-map.png -compose Multiply -composite \) \
  -compose CopyOpacity -composite _art/wordmark-distressed.png
```

The black point in that `-level` is the only grunge knob in the system. 30% is heavy, 55% moderate,
70% barely there. When a counter fills at 200 px, raise the black point and re-run. One number, one
command, repeatable — which is the difference between a wordmark and a one-off image.

`grunge-source.png` is the desaturated, crushed model output from whichever treatment you pick.
**The model output is a texture source, never the shipping mark.** Do not key its near-black
background to get transparency: you will get a dark halo on every anti-aliased edge that only shows
up when the mark lands on the light parts of the cover, which is exactly when it is too late. Alpha
comes from the vector, always. Using the output only as a greyscale map is also what keeps the
SynthID watermark out of the shipping file.

**The size ladder.** Distress is invisible below about 200 px and actively harmful below about 100,
because the first thing it eats is the counters and a filled counter turns D into O.

| Size | Treatment |
|---|---|
| ≥ 800 px | Full distress. Cover, menu, README hero. |
| 200–800 px | Reduced distress. Re-run with the level black point at 60% so only the large chips survive. |
| < 200 px | Clean vector outlines, no distress, offset intact. The offset is the last property to die. |
| ≤ 48 px | A single glyph. Neither line survives at 32 px: PEDAL at 32 px tall gives about 6 px per character and the counters close. Crop the D from the clean master, or use one boost-orange chevron on `#0b0d10`. |

```sh
magick -background none _art/wordmark-favicon.svg -resize 32x32 docs/art/favicon-32.png
magick _art/wordmark-distressed.png -resize 2400x -strip docs/art/wordmark.png
magick _art/wordmark-distressed.png -resize 1200x -quality 88 public/art/wordmark.webp
```

Use PNG for the README, not SVG. GitHub's markdown pipeline sanitises SVG and renders it
inconsistently across contexts; the SVG is the master, the PNG is what GitHub sees.

**Four gates on the mark.** Composite `docs/art/wordmark.png` over an `#e6edf3` field and look at
the letter edges — any dark halo means the alpha came from a key rather than from the vector and
the file is wrong. At 200 px every counter must still be open, no stroke severed, both lines flush
left and right; if any of those fail the knob is the level black point, not a re-roll. `#ff8c1a`
never physically touching `#d8452f` or `#c9a227`. And the composite mean luminance under 15, with
the mark's ink under 5% of frame per the arithmetic in section 3.

**Where it must never go.** The in-game HUD. That is `ui-monospace` at 12 px with `0.18em` tracking
and it argues against decoration in its own source comments. The display face touches the cover,
the menu and marketing. It does not touch the overlay.

---

## Follow-on prompts

Seven more images. Style suffix on all of them, plus the approved key art attached as style
reference #1 with the role instruction from section 3.

| File | Ratio | Size | What it is for |
|---|---|---|---|
| `menu-backdrop` | 21:9 | 2K | Title screen. Menu items composite into the reserved band. |
| `cars-sheet` | 1:1 | 4K | A 2×2 contact sheet of all four cars in one generation. Sliced, then used as style reference #2. |
| `car-0-red` … `car-3-gold` | 4:5 | 2K | Car-select plates, one per livery. Reserve is the bottom 18%. |
| `arena` | 16:9 | 2K | README establishing shot. No type reserve. |
| `social-card` | 16:9 | 2K | GitHub social preview. Cropped to 1280×640 after. |

### Menu backdrop

```
Create an image of a fully worked-up airbrush-and-acrylic painted cover illustration for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. A floodlit night arena of dirt and concrete, empty of action and waiting. All damage in this picture is to machinery and property.

First, build the ground. A wide plate of dry high-desert dirt in ochre #6b5a3e running back about eighty metres, churned into deep wheel-cut ruts with standing water and near-black oil pools sitting in them, tyre fans dried chalky pale at their edges. A four-metre board-formed concrete perimeter wall in grey #2a323c runs the full width behind it, stained, chipped along its top edge and scorched in feathered black blooms heaviest at each bloom's centre, with sagging torn wire fencing hanging off its top rail in two places. Bulldozed into a low berm along the base of the wall are four derelict wrecked cars, stripped to grey steel and bare orange rust, roofs caved, wheels gone. They carry no paint colour at all.

Then two steel lattice floodlight masts. The near one stands at frame-left with its head two-thirds of the way up the frame, lamp housings dark grey and the lamps reading as small hard warm rectangles with no glare star. The far one is small and deep at the right edge. These are the only light sources in the picture.

Then, at right of centre in the mid-ground, a tent-shaped dirt ramp turned three-quarters to camera, with three chevron arrows painted in #ff8c1a on its short steep back face, scuffed and half-buried in dirt.

Then one vehicle only, parked and still. A battered armoured sports coupe in rust red #d8452f at frame-left in the near-middle ground, three-quarter front to camera, welded steel plate over the doors, a heavy bull bar, a roof rack, an exposed roll cage and one machine gun on the bonnet with the barrel raked away toward the wall. Four wheels, one at each corner. Engine off, nobody in it, all glass opaque black. A thin column of heat shimmer is absent and the air is clear.

CAMERA. Camera height one metre above the dirt, looking slightly up. The horizon sits one third of the way up the frame. Three-point perspective with the vanishing points off-canvas, exaggerated wide-angle perspective distortion — drawn, not photographed. The composition is weighted left and the horizon is not level, leaving the centre and right of the frame comparatively open.

LIGHT. One hard key from the near mast at frame-left, warm near-white #fff2df, raking down at fifty-five degrees. No fill. The right third of the picture falls to near-black. A band of unlit dirt separates the chevrons from the red bodywork at every point.

DETAIL HIERARCHY. Taken to a full mirror finish in only three places: the coupe's front-left wheel arch and bull bar; the wet clearcoat across its bonnet; and the chevron face of the ramp. Everything else — the wrecks, the wall, the far mast, the whole right third — is resolved in broad masses and single loaded strokes.

RESERVED SPACE. The top twenty-four percent of the frame is unbroken night at a single unmodulated #0b0d10, one value, no rendered detail, no bright pixel. Nothing crosses into that band: no mast head, no spark, no fencing, no antenna. The tallest element tops out just below it. Additionally, the middle-right third of the frame below that band stays comparatively open and low in contrast, so menu items can sit over it and stay legible.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Aspect ratio 21:9.
```

**Cut order:** the far mast, then the fencing, then two of the four hulks.

### The four-car contact sheet

Shoot this once, at 1:1 and 4K, before any individual portrait. One denoise is the strongest
continuity mechanism available, and 4096×4096 gives roughly 2000 px per cell.

```
Create an image of a fully worked-up airbrush-and-acrylic painted contact sheet of four vehicle portraits for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. Four panels in a strict two-by-two grid, one vehicle per panel, separated by a thin gap of unmodulated #0b0d10. All damage in this picture is to machinery and property.

Strict continuity across all four panels: identical medium, identical palette, identical key-light direction and angle, identical level of finish, identical camera height, identical ground treatment, identical near-black background. The four vehicles differ only in silhouette and paint colour.

Top left: a battered armoured sports coupe in rust red #d8452f, welded steel plate over the doors, a heavy bull bar, a roof rack, an exposed roll cage and one machine gun mounted on the bonnet.

Top right: a battered armoured pickup in faded blue #3f8ecc, a plated flatbed, a heavy bull bar, an exposed roll cage over the cab and one machine gun mounted on the bonnet.

Bottom left: a slab-sided armoured box truck in dirty green #6bbf59, plated flanks, a heavy bull bar, a roof rack over the cab and one machine gun mounted on the cab roof.

Bottom right: a low unarmoured sports car in mustard gold #c9a227, clean-bodied and unplated, a small rear spoiler and one machine gun mounted on the bonnet.

Every vehicle has four wheels, one at each corner, and is shown three-quarter front from the low left, standing on a shallow patch of churned dirt in ochre #6b5a3e that fades to unmodulated #0b0d10 within two vehicle lengths. All glass is opaque black with a single hard reflected highlight and no car has a driver.

LIGHT. One hard key of warm near-white #fff2df from camera-left, thirty degrees above the horizon, in every panel, motivated by a floodlight standing outside each panel's frame. No fill. The right third of every vehicle falls to near-black silhouette held by one scraped highlight. There is no #ff8c1a anywhere in this image.

DETAIL HIERARCHY. In each panel, taken to a full mirror finish in only two places: the front-left wheel arch with the bull bar behind it, and the wet clearcoat across the bonnet or cab front. Everything else is resolved in broad masses and single loaded strokes.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Square image, aspect ratio 1:1.
```

### Vehicle portrait template

Substitute `{{INK}}` and `{{BODY}}` from the table. Attach the approved key art as style reference
#1 and the sliced contact-sheet cell as style reference #2, with the role instruction from
section 3. 4:5, 2K.

```
Create an image of a fully worked-up airbrush-and-acrylic painted vehicle portrait for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. One vehicle, standing still, filling the frame. All damage in this picture is to machinery and property.

The vehicle is {{BODY}}, painted {{INK}}. It has four wheels, one at each corner. All glass is opaque black with a single hard reflected highlight and there is no driver. It stands three-quarter front to camera, angled slightly to the left, on a shallow patch of churned high-desert dirt in ochre #6b5a3e that falls away to unmodulated #0b0d10 within two vehicle lengths. There is no wall, no ramp, no other vehicle and no #ff8c1a anywhere in this image.

CAMERA. Camera height sixty centimetres above the dirt, looking very slightly up. Three-point perspective with the vanishing points off-canvas, exaggerated wide-angle perspective distortion — drawn, not photographed. The vehicle sits slightly left of centre and its front-left tyre is the nearest object to camera. The composition is not perfectly level.

LIGHT. One hard key of warm near-white #fff2df from camera-left, thirty degrees above the horizon, motivated by a floodlight standing outside the left frame edge. No fill. The right third of the vehicle falls to near-black silhouette held by one scraped highlight along the edge.

DETAIL HIERARCHY. Taken to a full mirror finish in only two places: the front-left wheel arch with the bull bar behind it, and the wet clearcoat across the bonnet. Everything else is resolved in broad masses and single loaded strokes.

GRIT. Rust bleeds downward from the bolt heads along the welded plate and pools at the seam below. Paint is chipped at the leading edge of the bull bar where stones have struck it, each chip showing clearcoat over colour coat over grey primer over bare steel. Soot feathers back from the gun muzzle, heaviest at the muzzle. Brake dust cakes pale grey in the front-left wheel arch and is wiped clean in an arc where the tyre throws it. Dirt is packed into the tyre treads.

RESERVED SPACE. The bottom eighteen percent of the frame is unbroken unmodulated #0b0d10, one value, no rendered detail and no bright pixel — clean negative space for a name plate. Nothing crosses into that band: no tyre, no shadow edge, no dirt. The vehicle's lowest point sits just above it.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Aspect ratio 4:5.
```

| File | Car id | `{{INK}}` | `{{BODY}}` | Model in `public/models/` |
|---|---|---|---|---|
| `car-0-red` | 0, player | `rust red #d8452f` | a battered armoured sports coupe with welded steel plate over the doors, a heavy bull bar, a roof rack, an exposed roll cage and one machine gun mounted on the bonnet | `Vehicle_Sports_Armored.gltf` |
| `car-1-blue` | 1 | `faded blue #3f8ecc` | a battered armoured pickup with a plated flatbed, a heavy bull bar, an exposed roll cage over the cab and one machine gun mounted on the bonnet | `Vehicle_Pickup_Armored.gltf` |
| `car-2-green` | 2 | `dirty green #6bbf59` | a slab-sided armoured box truck with plated flanks, a heavy bull bar, a roof rack over the cab and one machine gun mounted on the cab roof | `Vehicle_Truck_Armored.gltf` |
| `car-3-gold` | 3 | `mustard gold #c9a227` | a low unarmoured sports car, clean-bodied and unplated, with a small rear spoiler and one machine gun mounted on the bonnet | `Vehicle_Sports.gltf` |

Two casting notes. `car-3-gold` is the risky plate: `#c9a227` and `#ff8c1a` are neighbours in hue,
so that prompt states there is no `#ff8c1a` in the image at all rather than trying to place it
safely. And `car-2-green` has the slabbiest silhouette of the four, which means it is the one where
"broad masses and single loaded strokes" can quietly eat the whole vehicle — push the mirror zones
harder on that one.

The plates work with nothing but the hex and the silhouette. If you want them to read as a cast
rather than as four spec sheets, each needs a name in the reserved band, and the game currently has
none. That is a product decision, not an art one.

### Arena establishing shot

No type reserve on this one. It is a README image that sits next to a real in-play frame, so it is
the asset where the cover's promise and the build's reality are compared directly.

```
Create an image of a fully worked-up airbrush-and-acrylic painted establishing illustration of an arena for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. A bounded square of high-desert dirt about a hundred and eighty metres across, at night, under floodlights. All damage in this picture is to machinery and property.

First, the ground: dry dirt in ochre #6b5a3e, churned into wheel-cut ruts with standing water and near-black oil pools, tyre fans dried chalky pale at their edges, loose grit and stones thrown across it.

Then the box: a four-metre board-formed concrete perimeter wall in grey #2a323c running around the far edge, stained, chipped, scorched in feathered black blooms. Inside it, two squat square concrete pillars in pale grey #4c5666 well apart from each other, one long angled steel barrier, and three scattered low crates. Bulldozed against the base of the wall at frame-right, three derelict wrecked cars stripped to grey steel and bare orange rust, roofs caved, wheels gone, carrying no paint colour at all.

Then three tent-shaped dirt ramps, spread across the plate at different angles, each with a long gentle approach and a short steep back face carrying three chevron arrows painted in #ff8c1a. One is near and left, one is mid-distance and right, one is far and small.

Then two steel lattice floodlight masts standing above the wall, one at frame-left and one deep at frame-right, lamp housings dark grey, lamps reading as small hard warm rectangles with no glare star. They are the only light sources in the picture.

There are no vehicles in this image and no people anywhere.

CAMERA. Camera height one and a half metres above the dirt at the near edge of the plate, looking across it. The horizon sits two fifths of the way up the frame. Three-point perspective with the vanishing points off-canvas, exaggerated wide-angle perspective distortion — drawn, not photographed. The horizon is not level.

LIGHT. One hard key from the near mast at frame-left, warm near-white #fff2df, raking down at fifty-five degrees, throwing hard-edged shadows to the right. No fill. The far half of the plate falls toward near-black and the corners of the arena are lost entirely — the lamps do not reach that far. Above the wall there is only unlit black night: no stars, no moon, no cloud, no gradient.

DETAIL HIERARCHY. Taken to a full mirror finish in only three places: the near ramp's chevron face, the standing water in the nearest rut, and the near mast's lamp housings. Everything else is resolved in broad masses and single loaded strokes.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Aspect ratio 16:9.
```

### GitHub social preview card

**Required: 1280×640 px, 2:1, under 1 MB.** GitHub's minimum is 640×320 and it renders around
400 px wide in a link preview, so the thumbnail gate is the binding constraint on this one. 2:1 is
not an offered ratio, so generate 16:9 and crop.

The card is a tighter crop of the key-art idea, not a downscale of it. One car, one ramp, one wall.
Everything important in the middle band or the crop eats it.

```
Create an image of a fully worked-up airbrush-and-acrylic painted cover illustration for a stylised arcade vehicular-combat video game, ESRB Teen, in the tradition of late-1980s to late-1990s console box art. One vehicle, close, at night, under a floodlight. All damage in this picture is to machinery and property.

A battered armoured sports coupe in rust red #d8452f fills the left half of the frame — welded steel plate over the doors, a heavy tubular bull bar across the nose, a roof rack, an exposed roll cage and one machine gun mounted on the bonnet with the barrel raked up and to the right. Four wheels, one at each corner. It is airborne, nose high, turned three-quarters toward the picture plane, with clods of dirt still falling out of the tyre treads. Its near-side window has no glass, only a bent frame, and inside sits a full-face crash helmet with an opaque mirrored visor down and sealed, carrying one small warped reflection of the floodlight. No skin, no face, no hands.

Behind and below it, a tent-shaped dirt ramp with three chevron arrows painted in #ff8c1a on its short steep back face, and beyond that a four-metre board-formed concrete wall in grey #2a323c, scorched and chipped. Above the wall there is only unlit black night. A band of unlit dirt separates the chevrons from the red bodywork at every point. There are no other vehicles in this image and no people anywhere.

CAMERA. Worm's-eye view, camera height thirty centimetres above the dirt. All essential content sits inside the central horizontal band of the frame; the top and bottom eighths carry no critical detail. The horizon sits low. Three-point perspective with the vanishing points off-canvas, exaggerated wide-angle perspective distortion — drawn, not photographed.

LIGHT. One hard key of warm near-white #fff2df from camera-left, twenty-five degrees above the horizon, motivated by a floodlight mast standing just outside the left frame edge. No fill. The right third of the car falls to near-black silhouette.

DETAIL HIERARCHY. Taken to a full mirror finish in only three places: the mirrored visor and the bent window frame; the front-left wheel arch and the wet clearcoat over it; and the bull bar. Everything else is resolved in broad masses and single loaded strokes, and the silhouette of the car against the black stays hard and unambiguous.

RESERVED SPACE. The right third of the frame, below the top eighth, is comparatively open: unlit dirt and black night at low contrast with no rendered detail, clean negative space for a logo. Nothing bright crosses into it.

[APPEND THE STYLE SUFFIX FROM SECTION 4 HERE, BYTE-IDENTICAL]

Aspect ratio 16:9.
```

Then crop and deliver:

```sh
magick _art/social-card-master.png -gravity center -crop 2752x1376+0+0 +repage \
  -resize 1280x640 -strip docs/art/social-card.png
```

Upload it under repo **Settings → General → Social preview**. It is not served from the repo, so
the committed copy is a backup and a source of truth, not the live asset.

---

## What to do with the images

| Path | What goes there | Why |
|---|---|---|
| `_art/` | 4K and 2K masters, SVG and PSD working files, `grunge-map.png` | Matches the existing `_models/` and `_sounds/` convention: source material, outside the build, never served |
| `public/art/` | Only what the running game loads: `menu-backdrop.webp`, `car-0-red.webp` … `car-3-gold.webp`, `wordmark.webp` | Vite copies `public/` verbatim into `dist/`, so anything here ships to the demo |
| `docs/art/` | `key-art.png`, `arena.png`, `social-card.png`, `wordmark.png`, `favicon-32.png`, `favicon.svg` | README and GitHub only. Keeping them out of `public/` keeps them out of `dist/` |

**Watch the demo's download size.** A 2K PNG is several megabytes and every player pays for anything
in `public/`. Convert the menu backdrop and the four portraits to WebP at the size they actually
display — 1920 wide for the backdrop, 800 wide for the plates — and keep the masters in `_art/`.
The README images can stay PNG because they are fetched by GitHub, not by the game.

### What the repo needs

- **README hero.** `docs/art/key-art.png` at the top with the wordmark composited, and the demo link
  directly under it.
- **A gameplay screenshot or GIF near it. Not optional.** The cover is a painting that oversells the
  game on purpose, and the game is a dark 3D frame. Showing both together is what makes the cover
  read as advertising rather than as a promise — the joke only lands if the reader is in on it, and
  layout is what lets them in. The visual-regression baseline at
  `tests/e2e/fixtures/arena-live-darwin.png` is a real in-play frame and is the honest choice.
- **`index.html` has no `og:image`, no `twitter:card` and no favicon.** Add all three. The card
  points at the hosted `social-card.png`; the favicon is the wordmark's D crop or a single orange
  chevron on `#0b0d10`, which is the only mark that survives 32 px.
- **`CREDITS.md`.** It currently says all code is original and no third-party audio ships. Add a
  line for the art: that it was generated with Google's Nano Banana Pro and carries a SynthID
  watermark, that the wordmark is outlined paths from a named typeface with its licence stated, and
  that the Quaternius Zombie Apocalypse Kit models in `public/models/` are CC0.

### The arena pass

The cover is deliberately ahead of the renderer, and four changes narrow the gap for almost
nothing. These are optional and separate from shipping the cover.

| Change | Where | Cost | Note |
|---|---|---|---|
| Bring the livery tint back toward the paint | `carModels.ts:110`, `lerp(paint, 0.55)` → 0.25–0.35 | One constant, 0 draw calls | Biggest single cover-to-game colour gap |
| Retint the sun toward sodium | `renderer.ts:171`, `DirectionalLight(0xfff2df)` | One constant, 0 draw calls | Makes "one warm key" true in the build, not just on the cover |
| Floodlight masts | New, four poles plus unlit emissive quads | ~4 draw calls | First structure in the game taller than the wall. Gives the black void a reason to be black: you are standing inside a lit pool |
| Floor toward dirt | `renderer.ts:31`, `0x272d36` → toward `0x6b5a3e` | One constant | **Do this last and carefully.** The terrain was decided as high desert dirt and the floor is currently concrete blue-grey, so it is a real bug. But lightening the ground is what the crate-colour separation asserts against. Run the crate-colour tests *before* re-recording the fixture, and abandon the change if separations fail |

The first row is the one that matters. **The build currently does not honour its own key:**
`carModels.ts:110` lerps each livery 55% toward white before multiplying it over the Quaternius
texture atlas, so the player's car renders as `#ebb9b6` dusty pink against a HUD that says
`#d8452f`. The art shows the code value, not the screen value. Closing that gap is one constant.

Draw-call budget is 100 and the frame currently measures around 70, so the masts fit. Any of these
that changes a pixel breaks the pinned fixture at `tests/e2e/fixtures/arena-live-darwin.png`, whose
threshold is 0.01% of pixels. That file must be deliberately re-recorded, not overwritten by
accident.

## Not this way

**What the renderer should not chase:** fog, tone mapping, bloom, post-processing. `scene.fog` is
never assigned anywhere in the repo and `toneMapping` is never set, so the renderer runs three's
default `NoToneMapping` with zero post-processing — and the art must not promise any of it. Adding
a full extra render target against a 100-call budget to chase a cover is the wrong trade. The
cover oversells the *painting*; it does not ask the engine to become one.

**Halftone, dot screens and print separations.** Tried, rejected, gone. The reproduction cues that
survive are listed in rule 14 and that is the whole list.

---

## Checklist

Eight images, one wordmark, four code touches.

**Type** — blocking, nothing else finishes without it:

- [ ] Pick the face and record its licence (`Anton` unless there is a reason)
- [ ] Generate all four wordmark treatments as studies, pick one
- [ ] `_art/wordmark-master.svg` — clean outlines, two colours, one offset
- [ ] `_art/grunge-map.png` — greyscale, 4000 px, from the picked treatment
- [ ] `_art/wordmark-distressed.png`, `docs/art/wordmark.png`, `public/art/wordmark.webp`
- [ ] `docs/art/favicon-32.png`, `docs/art/favicon.svg`

**Images** — style suffix on every one, key art locked as style reference #1 after the first:

- [ ] `key-art` (16:9) and its 3:4 portrait variant, chosen side by side
- [ ] `menu-backdrop` (21:9)
- [ ] `cars-sheet` (1:1, 4K) — shoot this before any individual plate
- [ ] `car-0-red` … `car-3-gold` (4:5)
- [ ] `arena` (16:9)
- [ ] `social-card` (16:9, cropped to 1280×640)

**Gates, per image:**

- [ ] Judged at 400 px first, before anything else
- [ ] Mean luminance measured — plate under 10, composite under 15
- [ ] Four livery hexes eyedroppered on the lit face
- [ ] `#ff8c1a` touching neither `#d8452f` nor `#c9a227`
- [ ] Four wheels per car, one at each corner
- [ ] Reserved band still a single unmodulated value
- [ ] Reads as a car at 200 px

**Wiring:**

- [ ] README hero with the wordmark composited, demo link under it
- [ ] Gameplay frame or GIF directly beneath the hero
- [ ] `og:image`, `twitter:card` and favicon in `index.html`
- [ ] Social preview uploaded under Settings → General
- [ ] `CREDITS.md` line for the art, the typeface licence and the CC0 models

**Arena pass** (optional, and separate from shipping the cover):

- [ ] `carModels.ts:110` lerp 0.55 → 0.25–0.35
- [ ] `renderer.ts:171` sun toward sodium
- [ ] Floodlight masts
- [ ] `renderer.ts:31` floor toward dirt *(last, and only if the crate-colour tests still pass)*

Generation one is a test of the suffix, not of the picture. Before you fall in love with anything,
check that the frisket clause, the layer-order clause and the detail-hierarchy clause actually
landed — a suffix that turns out to be half-inert across eight assets is worse than a shorter one
that works, and that is the only thing in this document I have not been able to verify without
generating. The mirrored visor is the one element I would cut first if it costs more than a handful
of re-rolls; the picture survives an empty cab, and a helmet strapped into a harness with nobody in
it reads worse anyway.
