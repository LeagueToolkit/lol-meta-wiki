# Content Guidelines

This document defines the standard for written documentation on the wiki. It covers *what* to write; for YAML/Markdown mechanics see [MARKDOWN_GUIDE.md](MARKDOWN_GUIDE.md).

## Audience and purpose

The wiki documents how the game's data **works and behaves in the game engine**. The reader is someone modding the game: they are looking at a property in a bin file and want to know what the engine does with it — when it's read, what it affects, what values mean, and what it interacts with.

Write for that reader. Assume they are technical (comfortable with bin files, hashes, and engine terminology) but do **not** assume they know the engine internals — that knowledge is exactly what the wiki exists to provide.

## The core rule: describe engine behavior, not game trivia

Every description should answer: *what does the engine do with this value?*

❌ **Don't** write player-facing gameplay descriptions:

> The maximum health points of the turret. Outer turrets have higher HP with plating, inner turrets have moderate HP...

✅ **Do** describe the data and its behavior:

> Radius (in world units) of the bounding box used for **visibility culling**. The system's cull box is its position ± `VisibilityRadius · √½` on each axis; when the box leaves the camera frustum the system is hidden and (unless flagged otherwise) its simulation is paused.

Balance numbers, champion trivia, and strategy belong on gameplay wikis, not here. Mention gameplay only when it explains *why* the data behaves the way it does (e.g. "gameplay-critical emitters are never culled").

## Don't restate the page

Your text is one block on a generated page. Around it the page already renders
the class's **inheritance tree**, its **own properties** with types, defaults and
type history, the **"Added in"/"Removed in"** patches, and the **classes that
reference it**. All of that comes from the db, so it is always current and never
needs saying twice - a hand-written copy adds nothing on the first day and is
wrong on some later one.

❌ **Don't** spend the documentation on structure the page shows:

> Class hash `0x8C9D99D3`, inherits `FloatConceptBase` (`0xCBDD4DDE`) which inherits `ConceptBase`. `FloatConceptBase` adds the typed `DefaultValue: f32`. Has no properties.

✅ **Do** say what the thing is and how it works:

> A float-valued **concept**: a named channel that carries a gameplay value from whatever writes it to everything that reads it. Until something writes it, readers see the concept's default value.

Concretely, keep out of both `description` and `notes`: class hashes, "inherits
X", "is an interface", "X adds property Y", "has no properties", lists of
subclasses, and lists of classes that reference this one. Document it the way you
would document code whose declaration sits right next to the comment: the
declaration is visible, so write the purpose, the mechanism, the evaluation
order, the meaning of values, and the interactions - the things the reader cannot
see for themselves.

## Anatomy of a good description

Order the information by how the reader needs it:

1. **What it is** — one sentence identifying the property in data terms. Start with the thing itself, not filler ("Emission rate in particles per second", never "This property is used to control the emission rate").
2. **How the engine uses it** — when it's evaluated, what it affects, the mechanism if it's non-obvious.
3. **Values** — units, range, what special values mean (`-1` = disabled, unset = no cap).
4. **Interactions** — other properties, flags, or settings that change its behavior, linked or named in backticks.

Not every property needs all four. A simple property gets one line:

```yaml
TimeBeforeFirstEmission:
  description: "Delay, in seconds, before the emitter starts emitting."
```

A complex one gets paragraphs, and a table if it's a bitfield or enum. Match length to complexity — padding a simple property to look thorough is as bad as leaving a complex one unexplained.

## Verbosity: complete but not padded

- **Explain the context in full** the first time. If a property only makes sense together with a system-wide concept (culling, quality settings, value-with-dynamics embeds), explain that concept **once** — usually in the class description — and reference it from the properties.
- **Don't repeat** what the reader can already see: the type, the name, or a paraphrase of the name. `EmitterName: "The name of the emitter."` adds nothing; document what the name is *used for* instead.
- **Don't pad** with hedges, restatements, or tutorial framing ("As you can see", "It's important to note").
- Prefer one precise sentence over three vague ones.

## Accuracy

- Document only **verified** behavior. Verify it however you can - reverse engineering, engine analysis, in-game testing - but write the *behavior*, not the evidence. If you can't verify it, don't write it.
- **Keep the evidence out of the page.** Byte offsets, struct layouts, disassembly, register names, and "verified against the client" provenance are how you learned the rule, not the rule itself. The reader is holding a bin file, not a debugger: none of it helps them, and all of it goes stale the moment the layout shifts. State the observable rule instead - "cast instances carrying an internal flag are ignored", not "the flag byte at offset 435 is set".
- **Don't pin prose to a patch or build number** ("as of 16.16", "from build 6841658"). The db already tracks when every class and property appeared or disappeared, and the site renders that as "Added in"/"Removed in" pills - a version written into the text only contradicts them later. Where version-specific behavior matters, say it in relative terms: "Removed from current builds", "no legacy troybin equivalent".
- Mark unknowns explicitly rather than guessing: `"Unknown byte, default 5. Purpose not yet identified."` An honest gap is useful; a plausible-sounding guess is misinformation.
- If something is known only partially, say exactly what is known and stop there.

## Conventions

**Formatting**

- `code formatting` for property names, class names, values, flags, hashes, file extensions, and settings keys.
- **Bold** a key term once, on first introduction — not on every mention.
- Link other documented classes with a site link: `[VfxSystemDefinitionData](/classes/vfxsystemdefinitiondata)`. Reference properties of the same or another class in backticks: `` `VfxEmitterDefinitionData.Importance` ``.
- Use tables for bitfields, enums, and value→behavior mappings — they are the clearest form for those.

**Values**

- Always state units: seconds, world units, degrees, particles per second.
- Don't restate the default value - the page prints it next to the type. Explain it only where the value alone doesn't tell the reader what happens: `"The default matches no slot, so the property must be set explicitly."`
- Write hashes and flag bits in hex (`0x45CD899F`, bit `0x10`); state what unset/sentinel values mean (`-1 (default) disables it`).
- Name unknown hash properties by their hex key (`"0x9836cd87":`) and document whatever is known about them.

**Field usage**

- `description` — the behavior itself: what it is, how the engine uses it, what values mean.
- `notes` — short standalone facts that don't belong in the flow of the description: edge cases, caveats, what a sentinel value means, legacy-format differences, cross-references. Not defaults, hashes, or inheritance; the page renders those.
- `examples` — concrete values or usage scenarios, only when they genuinely clarify. Omit rather than invent.

**Tone**

- Neutral, factual, present tense: "the system is hidden", not "the system will be hidden".
- No marketing language, no exclamation points, no emojis in class/property docs.
- Write in complete sentences; fragments are fine for one-line descriptions of simple values.

## Checklist before submitting

- [ ] Does every description say what the *engine* does with the value?
- [ ] Are units and defaults stated?
- [ ] Are interactions with other properties/settings named and linked?
- [ ] Is everything written actually verified?
- [ ] Is it the behavior on the page rather than the evidence for it - no offsets, disassembly, or patch/build pins?
- [ ] Are unknowns marked as unknown instead of guessed?
- [ ] Does the text stay off what the page already renders - hashes, inheritance, defaults, patches, referencing classes?
- [ ] Is there anything the reader could delete without losing information? Delete it first.

## Reference examples

[`VfxSystemDefinitionData.yaml`](VfxSystemDefinitionData.yaml) and [`VfxEmitterDefinitionData.yaml`](VfxEmitterDefinitionData.yaml) are the model for these standards — use them as the template for new documentation.
