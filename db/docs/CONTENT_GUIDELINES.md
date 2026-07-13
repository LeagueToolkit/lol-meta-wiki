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

- Document only **verified** behavior — from reverse engineering, engine analysis, or in-game testing. If you can't verify it, don't write it.
- Mark unknowns explicitly rather than guessing: `"Unknown byte, default 5. Purpose not yet identified."` An honest gap is useful; a plausible-sounding guess is misinformation.
- If something is known only partially, say exactly what is known and stop there.
- Note version-specific behavior when relevant ("Removed from current builds", "no legacy troybin equivalent").

## Conventions

**Formatting**

- `code formatting` for property names, class names, values, flags, hashes, file extensions, and settings keys.
- **Bold** a key term once, on first introduction — not on every mention.
- Link other documented classes with a site link: `[VfxSystemDefinitionData](/classes/vfxsystemdefinitiondata)`. Reference properties of the same or another class in backticks: `` `VfxEmitterDefinitionData.Importance` ``.
- Use tables for bitfields, enums, and value→behavior mappings — they are the clearest form for those.

**Values**

- Always state units: seconds, world units, degrees, particles per second.
- State the default when known, in `notes`: `"Default 250."`
- Write hashes and flag bits in hex (`0x45CD899F`, bit `0x10`); state what unset/sentinel values mean (`-1 (default) disables it`).
- Name unknown hash properties by their hex key (`"0x9836cd87":`) and document whatever is known about them.

**Field usage**

- `description` — the behavior itself: what it is, how the engine uses it, what values mean.
- `notes` — short standalone facts: defaults, class hashes, edge cases, legacy-format differences, cross-references.
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
- [ ] Are unknowns marked as unknown instead of guessed?
- [ ] Is there anything the reader could delete without losing information? Delete it first.

## Reference examples

[`VfxSystemDefinitionData.yaml`](VfxSystemDefinitionData.yaml) and [`VfxEmitterDefinitionData.yaml`](VfxEmitterDefinitionData.yaml) are the model for these standards — use them as the template for new documentation.
