# Plan: Class categories

Replace the first-word buckets in the "Classes" sidebar with a small set of
authored **domains** (VFX, UI, Scripting, ...). A domain is seeded with a few
root classes in one YAML file; the generator places every other class by
inheritance and by who uses it. The category then drives the sidebar, the class
page, the `/classes/` index, the API and the changelog.

Supersedes issue #6 (hashes last) and answers issue #7 (automatic
categorisation) without nesting on common name words.

## Why

The sidebar buckets by the first PascalCase word of the class name
(`generate-db.ts`, `firstWord`). Measured on the current db (5,547 classes,
4,710 live, 2,001 unnamed):

- **A word is not a subsystem.** `Tft` holds 268 classes from 165 unrelated
  inheritance families. `I` is a group of 186 interfaces. `Tft` and `TFT` are
  two groups.
- **Families are scattered.** 231 of the 367 inheritance families with two or
  more members are split across buckets. The 147 logic drivers land in 58 of
  them (`FloatLiteralMaterialDriver` under `Float`, `MathAddFloatDriver` under
  `Math`, `ILogicFloatDriver` under `I`).
- **Unnamed classes have no placement.** Every `0x...` class sits in one flat
  list, and 724 named classes sit in a flat "other" list.

## Decisions

- **Domains are authored, placement is derived.** A fully automatic grouping
  (inheritance plus ownership, no authored layer) was prototyped and rejected:
  it reaches 89% coverage in 120 groups, but ownership chains merge unrelated
  systems (`StaticMaterialDef` ends up inside the VFX group) and the group
  labels are arbitrary. Seeds stop propagation at a class that already has a
  domain.
- **One domain per class.** No tags, no multi-membership. A class used by
  several domains is **Shared**, not a member of each.
- **Second level = inheritance family**, the same key the changelog already
  groups on. No word nesting.
- **Kind, status, named and documented are facets, not tree levels.**
- **Codenames get their own domain, flagged `unreleased`.** Monarch (an
  unreleased game mode, 132 classes, none in the live build) and Nova (an
  unreleased item rework, 53 classes, all live in the schema) each get a
  domain that sorts after the released ones and carries an "unreleased" pill.
  When one ships, its entries move into the real domain (Nova into Items) and
  the codename domain is deleted: a YAML-only change.
- **A new patch never fails the build over categories.** Unplaced classes are
  Uncategorized, which is a normal state and a visible to-do list.
- **The config lives at `db/categories.yaml`**, not under `db/docs/` (that
  directory is one file per class).

## Placement rules

The unit is the **family**: the topmost ancestor on a class's primary (first)
base chain at its latest revision, plus everything deriving from it. 125
classes have more than one base; only the primary chain counts. There are
2,203 families, 367 with two or more members.

A class takes its domain from the first rule that applies:

| # | Rule | Source |
|---|---|---|
| 1 | **Pin** | `pins:` names this class |
| 2 | **Seed** | the nearest ancestor (or the class itself) listed under a domain's `roots:` |
| 3 | **Prefix** | the family root's name starts with a domain's prefix; longest prefix wins |
| 4 | **Usage** | every family that uses this family has a domain, and they all agree |
| 5 | **Shared** | the families that use it span two or more domains |
| 6 | **Uncategorized** | none of the above |

- "Uses" is the edge the generator already computes for the "Referenced by"
  section (`usedByMap`): a live property of a live class whose type names the
  class (the `kh` slot). A family with no live member falls back to the users
  it had at its final revision, so removed classes still get placed.
- Rule 4 runs to a fixed point over families in sorted order. Each family's
  result depends only on its users' results, so the outcome does not depend on
  iteration order.
- Rule 3 is plain `startsWith`, case sensitive. The same prefix under two
  domains is a config error.

### `db/categories.yaml`

```yaml
domains:
  logic:
    title: Logic drivers and concepts
    description: Expression nodes evaluated per object, and the concepts they read.
    roots: [ILogicDriver, ILogicDriverSource, ConceptBase]
  vfx:
    title: VFX
    description: Particle systems, emitters and their drivers.
    roots: [IVfxBaseDriver, VfxPrimitiveBase, VfxComponentBase]
    prefixes: [Vfx, IVfx]
  monarch:
    title: Monarch
    description: Unreleased game mode.
    unreleased: true
    prefixes: [Monarch, IMonarch]
pins:
  SomeHelperStruct: logic
```

- `roots` and `pins` keys take a class name or an unpadded `0x` hash, resolved
  like every other class reference on the site. Unnamed roots are seedable.
- Domain order in the file is the display order; `unreleased` domains sort
  after the rest, then Shared, then Uncategorized.
- `shared` and `uncategorized` are reserved ids.

## Prototype result

Starter config in the appendix: 20 domains, 132 seed roots, 57 prefixes.

| Placed by | Classes | Share |
|---|---|---|
| Seed, through inheritance | 2,701 | 48.7% |
| Prefix on the family root | 872 | 15.7% |
| Usage | 1,088 | 19.6% |
| Shared | 54 | 1.0% |
| Uncategorized | 832 | 15.0% |

- 4,087 of the 4,710 live classes (87%) and 1,412 of the 2,001 unnamed classes
  land in a domain.
- Uncategorized is 554 families: 294 are used by nothing, 351 have an unnamed
  root. The largest is `BaseParams` (96 classes).
- Biggest domains: UI 1,216, Scripting 645, TFT 366, VFX 310, Map 259,
  Spells 257, Game modes 211.

The starter seeds were written quickly from family names. The table measures
the mechanism; individual placements need review (Phase 1). The first draft
already needed one correction of the kind rule 2 exists for: the `IResource`
family holds `StaticMaterialDef`, `VfxSystemDefinitionData`, `TextureResource`
and `ContextualActionData`, so it is seeded per subclass, not at the root.

## Phase 1 - Categoriser and config

- [x] `scripts/categorize.ts`: a pure function
      `(classes, usedBy edges, config) -> Map<className, ClassCategory>`. No
      file access, so it is testable with `bun test` and reusable by
      `api/scripts`.
- [x] `db/categories.yaml` from the appendix, reviewed: every seed root checked
      against its class page, `BaseParams` decided (see Open questions).
- [x] Loader and validation in `generate-db.ts`: unknown domain id in `pins`, a
      class seeded twice, a duplicate prefix are errors. A root or pin that
      resolves to no class is a **warning** (the weekly db refresh must not
      break the deploy over a renamed class) and an error under `--strict`.
- [x] The generator prints a coverage table (classes per domain and per rule,
      plus the ten largest uncategorized families) on every run.
- [x] Tests: every class gets exactly one category; a seeded subtree overrides
      its family's seed; a pin overrides everything; a family used by two
      domains is Shared; output is identical for shuffled input.
- [x] `site/integrations/generate-db.mjs`: watch `db/categories.yaml` next to
      `db/docs/` so the dev server regenerates on edit.

## Phase 2 - Generated data

- [x] `site/src/types.ts`: `ClassCategory { domain: string; via: "pin" | "seed"
      | "prefix" | "usage" | "shared" | "none"; family: string }` and
      `DomainInfo { id, title, description, unreleased, counts: { classes,
      live, unnamed, documented } }`.
- [x] `ClassJson.category`. Every class JSON is rewritten once; after that only
      the classes whose placement changes are.
- [x] `site/public/db/categories.json`: the ordered `DomainInfo[]`.
- [x] `classSidebar.json` changes shape to
      `{ domains: [{ id, title, unreleased, groups: [{ label, entries }],
      loose: entries, unnamed: entries }] }`. `groups` are families with
      `MIN_GROUP_SIZE` (5) or more members, labelled by the family root; `loose`
      is the rest of the named classes A-Z; `unnamed` is the `0x...` classes of
      the domain that sit in no group. Inside a group, unnamed classes sort
      last. Shared and Uncategorized are the last two entries.
- [x] `ClassChange.domain` for the changelog (resolved against the latest
      categorisation, unlike `family`, which is resolved at the build of the
      change).

## Phase 3 - Sidebar and class page

- [x] `ClassesGroup.astro`: render domain -> family group -> class. The current
      page's domain and group open; everything else stays collapsed. Bump the
      session cache key (`wiki-classes-group-html-v5`).
- [x] `PageTitle.astro`: a breadcrumb above the title, `Domain / Family`, both
      links, next to the existing hash pill. Unreleased domains add a pill.
- [x] Shared classes: one line under the title, "Shared - used by VFX,
      Materials", built from the existing `usedBy` data.
- [x] Uncategorized classes: the same "add documentation" affordance pattern,
      pointing at `db/categories.yaml`.

## Phase 4 - Browse pages

- [x] `/classes/`: replace the "Popular Base Classes" block in
      `ClassReference.astro` with one card per domain (title, description,
      class count, documented count). A new `DomainCards` in the `TopicCards`
      shape - a domain has counts where a topic has an icon. Keep the stats row.
- [x] `/domains/<id>/`: one generated page per domain (stub MDX plus build-time
      JSON, same pattern as the changelog) listing its families with member
      counts and its loose classes. Not under `/classes/`, so a domain id can
      never collide with a class slug.
- [x] `/domains/uncategorized/` doubles as the contributor to-do list: families
      largest first, with what uses each one.

## Phase 5 - Facets

- [x] Sidebar toggle "Hide removed", on by default, stored per browser. With it
      on, the Monarch domain is empty and hides itself.
- [x] Kind pill on the class page and in domain page lists: interface (630),
      value struct (318), class.
- [x] Domain pages: filter chips for documented, unnamed and removed. The
      removed chip is the same switch as the sidebar's.

## Phase 6 - API and CLI

- [x] `category` on `/v1/classes/{nameOrHash}`; `domain` filter on
      `/v1/classes`; new `/v1/categories`. Update `api/openapi.json`.
- [x] `cli/`: regenerate types, add `--domain` to `search` (the class listing
      command), a `domains` command, and the domain in `class` output.
      Categories are not in `/v1/db`, so `--db` runs carry `kind` only.
- [ ] Decide whether `/v1/categories` (authored titles and descriptions) is a
      facts endpoint, and update the licensing page and README to say so.
- [ ] Re-record the CLI fixtures once the API is deployed (they were patched
      from the local build).

## Phase 7 - Changelog and contributor docs

- [x] `changelog/ClassChipSection`: group new and removed classes by domain,
      then by family (the existing `ClassFamilyGroup`).
- [x] `CONTRIBUTING.md`: a "Categories" section - how to seed a family, when to
      pin, how to read the coverage table.
- [x] A PR workflow that runs the generator with `--strict` when
      `db/categories.yaml` changes (the site has no PR check today).
- [ ] Close #6 and #7.

## Later

- **Third level for UI.** UI is 1,216 classes with 605 outside any family
  group, and `ViewController` has 224 direct subclasses. 422 of the 533 helper
  families there are used by exactly one class (456 classes), so nesting a
  helper under its single user is derivable. Worth doing only if the UI domain
  proves unusable in practice.
- **Cycles.** 29 families (59 classes) have users that agree on a domain but
  are held back by another uncategorized user. Running rule 4 on the
  strongly connected components of the usage graph would place them.
- **Where it ships.** Which bin files hold instances of a class would be a
  strong facet, but that data is not in `meta.db.json`.

## Risks

- **Seeds are judgement calls.** A wrong root misplaces a whole family. The
  `via` field is shown on the class page so a reader can see why a class sits
  where it does, and a fix is a one-line PR.
- **Prefixes are the weakest rule** (15.7% of placements). Keep the list short;
  prefer a seed whenever a family has a named root.
- **Placement can move between patches.** One new property can turn a
  usage-placed family into a Shared one. Pins exist for classes that should
  not move.
- **Seeds can go stale.** A root that disappears from the db only warns in the
  deploy build; the coverage table is the place it gets noticed.

## Verification

- `bun test` for the categoriser (Phase 1 cases).
- `pnpm --filter site build` passes and the page count grows only by the domain
  pages.
- The coverage table matches the prototype within a few classes; any larger
  gap is a rule implemented differently.
- Spot checks: every float logic driver (named or not) and
  `ConceptEasingData` are under Logic drivers; `StaticMaterialDef` is under
  Materials and `VfxSystemDefinitionData` under VFX although they share a
  root; `SpellObject` is under Spells and `ItemData` under Items;
  `BinFileContainer` is Shared.

## Open questions

- **`BaseParams`** (96 classes: `ParamsSpellCast`, `ParamsDamage`,
  `ParamsPlayerReport`, ...) is used by nothing in the schema. Scripting, its
  own "Event parameters" domain, or left uncategorized until someone
  documents it?
- **"Engine and client state"** currently holds only the `ClientState` tree and
  `EventBusObject`. Keep as a domain or fold into another?
- **Hide removed by default** changes what a first-time visitor sees (837
  classes disappear from the sidebar). Confirm before Phase 5.

## Appendix - starter `db/categories.yaml` (for review)

```yaml
domains:
  ui:
    title: UI and HUD
    roots: [ViewController, UiElementIData, IFilterItem, IOptionItemFilter,
            UiMetricTypeI, UiMetricUnitTypeI, IUiTextureDataProvider,
            ViewControllerFilterI, IValueUpdateElement, IUiVariable,
            IPictureInPictureSource, ILoadoutInfoPanel, LoadoutGridButtonData,
            RadialMenuBase, UIElementI, InstanceDataBase, ElementDataBase,
            FloatingInfoBarData, TooltipInstance, UiPositionBase,
            HealthBarTickStyleBase, SpellSlotBasicUiDefinition, LayoutStyleBase,
            AnchorBase, UiDraggableBasic, TipStyleBase,
            DeathRecapShowcaseSlotData, MinimapIconBehavior,
            IMinimapIconModifier, IOptionTemplate, UiPropertyLoadable,
            "0x2a4d735b"]
    prefixes: [Ui, UI, Hud, Minimap, Loading, Tooltip, Scoreboard]
  scripting:
    title: Scripting and sequences
    roots: [IScriptBlock, ISequenceAction, IScriptEvent,
            ISequenceActionInstance, IScriptValueGet, ScriptTable,
            ScriptTableSet, SeqInputFloat, SeqInputVector, SeqInputColor,
            SeqInputObjectArray, SeqInputCreateObject, SeqInputBool, RScript,
            IScriptCondition, IScriptSequence, IFloatGet, SeqSplinePointBase,
            ISequenceLocation]
    prefixes: [Seq, Script, Sequence]
  tft:
    title: Teamfight Tactics
    prefixes: [Tft, TFT]
  vfx:
    title: VFX
    roots: [IVfxBaseDriver, VfxPrimitiveBase, VfxComponentBase,
            VfxPhysicsModifierBase, IVfxShimmerGeometry, IVfxMaterialDriver,
            IVfxEmissionSource, IVfxShape, VfxShimmerFacingMode,
            IVfxDynamicParameterModifier, VfxModifierBase,
            VfxBeamBaseDefinitionData, VfxSpawnBehavior, IVfxEmissionSurface,
            VfxSystemDefinitionData]
    prefixes: [Vfx, IVfx]
  materials:
    title: Materials and rendering
    roots: [IX3dShadingModel, SkinnedMeshDataMaterialController,
            StaticMaterialDef, TextureResource]
    prefixes: [Material, StaticMaterial, DynamicMaterial, CustomShader, X3d, Shader]
  logic:
    title: Logic drivers and concepts
    roots: [ILogicDriver, ILogicDriverSource, ConceptBase]
  animation:
    title: Animation
    roots: [IBaseParametricUpdater, ClipBaseData, BaseRigPoseModifierData, BaseEventData]
    prefixes: [Anim, Clip, Rig, Blend]
  map:
    title: Map and environment
    roots: [MapPlaceableBase, MapComponent, MapAction, IMapVisibilityController,
            EnvironmentEffectorBase, IMapLightUpdater, IMapGroup, ILevelController]
    prefixes: [Map, Environment]
  entities:
    title: Game objects and entities
    roots: [IGeComponentDef, GameEntityComponent, GameEntityDefinition,
            IComponentData, IDeathGeComponentDef, "0xa4795108", "0x129e311"]
  characters:
    title: Characters and skins
    roots: [ICharacterSubcondition, ISkinAugmentModifier, ICharacter]
    prefixes: [Character, Skin, Champion]
  spells:
    title: Spells and combat
    roots: [IGameCalculationPart, ICastRequirement, MissileBehaviorSpec,
            TargetingTypeData, MissileMovementSpec, MissileTriggeredActionSpec,
            TargeterDefinition, IGameCalculation, HeightSolverType,
            ISpellRankUpRequirement, ITargetingRangeValue, ICcBehaviorData,
            ITargeterFadeBehavior, AreaTriggerShapeData, SpellObject]
    prefixes: [Spell, Missile, Buff, Targeting, Targeter]
  items:
    title: Items
    roots: [ItemData]
    prefixes: [Item]
  gamemodes:
    title: Game modes
    roots: [IGameModeConfigBase, GameModeConstant, IMinionWaveBehavior]
    prefixes: [GameMode, Mutator]
  audio:
    title: Audio and contextual actions
    roots: [IContextualCondition, IContextualAction, AudioContextEventType,
            AudioContextEvent, ListenerConstraintInfo, ContextualActionData]
    prefixes: [Contextual, Audio, Sound, Music, Announcer]
  input:
    title: Input and options
    roots: [IKeyBind, ILolKeybindCheck, IInputSourceBool, IInputSourceFloat,
            IInputUpdater, InputEventBase]
    prefixes: [Option, Keybind, Input]
  loadouts:
    title: Loadouts, catalog and store
    roots: [ICatalogEntryOwner, IStatStoneLogicDriver, IRewardBase]
    prefixes: [Catalog, Loadout, Store, Companion, Regalia, Emote, Ward]
  engine:
    title: Engine and client state
    roots: ["0xf8cc0ea3", EventBusObject]
  tools:
    title: Cheats and debug
    roots: [Cheat]
    prefixes: [Cheat, Debug]
  monarch:
    title: Monarch
    description: Unreleased game mode.
    unreleased: true
    prefixes: [Monarch, IMonarch]
  nova:
    title: Nova
    description: Unreleased item rework.
    unreleased: true
    prefixes: [Nova]
```

`0x2a4d735b` is the runtime `UiElement*` tree, `0xa4795108` the `GameObject`
tree, `0x129e311` the `*GeComponent` tree and `0xf8cc0ea3` the `ClientState`
tree; their roots are unnamed. `SpellObject` and `ItemData` share an unnamed
root, and `UiPropertyLoadable` sits under the shared `PropertyLoadable`, so
each is seeded below the root.
