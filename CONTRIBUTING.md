# Contributing to LoL Meta Wiki

Thank you for your interest in contributing documentation to the League of Legends Meta Wiki! This guide will help you add documentation for meta classes and their properties.

## How to Contribute

### Quick Start

1. **Find a class or property** you want to document on the wiki
2. **Click the "Add documentation" button** on the class or property
3. **Edit the YAML file** directly on GitHub (you'll be prompted to fork the repo if needed)
4. **Submit a Pull Request** with your changes

### Documentation Structure

Documentation is stored in YAML files in the `db/docs/` directory. Each class has a single YAML file (e.g., `AiBaseClient.yaml`, `Turret.yaml`) containing both class-level and property-level documentation.

## Documentation Format

Each class has a single YAML file in `db/docs/` (e.g., `AiBaseClient.yaml`, `Turret.yaml`) containing both class-level and property-level documentation.

### File Structure

```yaml
# ClassName Documentation

class:
  description: |
    A detailed description of what this class represents.
    
    You can use **Markdown** formatting here:
    - Bold, italic, `code`
    - Bullet lists
    - [Links](https://example.com)
  
  examples:
    - "Example usage or context where this class is used"
    - "Another example or scenario"
  
  notes:
    - "Additional notes, warnings, or important information"
    - "⚠️ **Warning**: Use emojis sparingly for important callouts"

properties:
  propertyName1:
    description: |
      A detailed description of what this property does.
      
      Use the pipe (`|`) operator for multi-line descriptions with Markdown.
    
    examples:
      - "Example value or usage"
    
    notes:
      - "Additional notes or warnings"
  
  propertyName2:
    description: "Short descriptions can use quotes"
    examples:
      - "Example value"
```

### Using Markdown

All `description` fields support full Markdown formatting! See [db/docs/MARKDOWN_GUIDE.md](db/docs/MARKDOWN_GUIDE.md) for details.

**Quick Tips:**
- Use `|` after the field name for multi-line text
- Use **bold** for important terms
- Use `code formatting` for technical terms and values
- Add [links] to external resources
- Keep formatting simple and readable

### Complete Example (`db/docs/AiBaseClient.yaml`)

```yaml
# AiBaseClient Documentation

class:
  description: "Base class for all AI-controlled game clients, including champions, minions, and monsters. Handles core AI behaviors and decision-making."
  examples:
    - "Used by champion AI during bot games"
    - "Controls minion pathing and behavior"
  notes:
    - "This class is inherited by most unit types in the game"
    - "AI behavior is heavily influenced by game difficulty settings"

properties:
  mMaxHealth:
    description: "The maximum health points this unit can have. This value is calculated based on base stats and modifiers from items, runes, and buffs."
    examples:
      - "A level 18 champion might have 2500 max health"
      - "Modified by items like Warmog's Armor (+800 HP)"
    notes:
      - "This is different from current health (mHealth)"
      - "Can be temporarily increased by shields and barriers"

  mMoveSpeed:
    description: "The base movement speed of the unit in units per second."
    examples:
      - "Most champions have 325-350 base movement speed"
      - "Modified by boots and movement speed items"
    notes:
      - "Subject to diminishing returns above certain thresholds"
      - "Can be affected by slow and speed boost effects"
```

## Guidelines

### Writing Good Documentation

**Read [db/docs/CONTENT_GUIDELINES.md](db/docs/CONTENT_GUIDELINES.md) before writing** — it defines the content standard for the wiki. The short version:

1. **Describe engine behavior, not game trivia**: Explain what the engine does with the value — when it's read, what it affects, what values mean
2. **Be complete but not padded**: Explain context fully once, then reference it; don't restate what the reader can already see
3. **State units and defaults**: Seconds, world units, degrees; note the default value when known
4. **Document only verified behavior**: Mark unknowns explicitly instead of guessing
5. **Use Proper Formatting**: Follow the YAML format exactly to avoid parsing errors

### What to Document

- **Purpose**: What does this class/property represent?
- **Usage**: How and when is it used in the game?
- **Values**: What kind of values does it hold? What's the typical range?
- **Relationships**: Does it interact with other classes/properties?
- **Changes**: Has it changed between game versions?

### What NOT to Do

- ❌ Don't include copyrighted game content (dialogue, lore, etc.)
- ❌ Don't add speculative or unverified information
- ❌ Don't write player-facing gameplay/balance descriptions — this is an engine-data wiki
- ❌ Don't use offensive or inappropriate language
- ❌ Don't break the YAML formatting (the build will fail)

## Categories

Every class sits in one **domain** (VFX, UI, Scripting, ...). Domains are
listed in `db/categories.yaml`; the build places every class by the first rule
that applies:

1. **Pin** - `pins:` names the class.
2. **Seed** - its nearest ancestor (or the class itself) is listed under a
   domain's `roots:`.
3. **Prefix** - the root of its inheritance family starts with one of a
   domain's `prefixes:`.
4. **Usage** - every class using its family is in the same domain.
5. **Shared** - the classes using its family span several domains.
6. **Uncategorized** - none of the above.

```yaml
domains:
  logic:
    title: Logic drivers and concepts
    description: Expression nodes evaluated per object, and the concepts they read.
    roots: [ILogicDriver, ILogicDriverSource, ConceptBase]
pins:
  SomeHelperStruct: logic
```

- **To place a family**, add its root class to a domain's `roots`. A class
  name or an unpadded `0x` hash both work, so a family whose root is still
  unnamed can be seeded too. The [Uncategorized](https://meta-wiki.leaguetoolkit.dev/domains/uncategorized/)
  page lists what is waiting, largest family first, with what uses each one.
- **To split a family**, seed the subclass: the nearest seeded ancestor wins,
  so a root in one domain can have a subtree in another.
- **Prefer a seed to a prefix.** A prefix only looks at a name; keep the lists
  short and use them for families that have no single root.
- **Pin last.** A pin is for one class the rules put in the wrong place.
- A domain for content the game has not shipped sets `unreleased: true`. When
  it ships, move its entries into the real domain and delete it.

The generator prints a coverage table on every run (classes per domain, how
many each rule placed, and the largest uncategorized families). A root or pin
that names a class the db does not have is a warning there, and an error in the
pull request check.

## Testing Your Changes

Before submitting a PR, you can test your documentation locally:

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/lol-meta-wiki.git
   cd lol-meta-wiki
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run the development server**
   ```bash
   pnpm dev
   ```
   It builds the wiki data from `db/meta.db.json` and your `db/docs/*.yaml` before it
   starts, and rebuilds it whenever you save a documentation file, so an edit shows up
   on the page you are looking at without a restart. You never need to run the
   generator by hand.

4. **View your changes at** `http://localhost:4321`

## Commit Message Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification. All commit messages are automatically validated.

### Format

```
<type>(<scope>): <subject>
```

### Allowed Types

- `docs`: Documentation changes (most contributions will use this)
- `feat`: A new feature
- `fix`: A bug fix
- `refactor`: Code changes without adding features or fixing bugs
- `style`: Code formatting changes
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Other changes

### Examples

✅ **Good commit messages:**
```bash
docs: add documentation for AiBaseClient class
feat: add search functionality to wiki
```

❌ **Bad commit messages:**
```bash
Update files
Added stuff
WIP
quick fix
```

## Submitting Your Contribution

1. **Commit your changes** following the commit message guidelines:
   ```bash
   git add db/docs/
   git commit -m "docs: add documentation for AiBaseClient class"
   ```

2. **Push to your fork**
   ```bash
   git push origin main
   ```

3. **Create a Pull Request** on GitHub with:
   - A clear title describing what you documented
   - A description of what information you added
   - Any sources or references you used

## Review Process

- All contributions are reviewed by maintainers
- We may ask questions or request changes to ensure accuracy
- Once approved, your contribution will be merged and deployed to the live site

## Getting Help

- **Questions?** Open an issue on GitHub
- **Need guidance?** Check existing documentation files for examples
- **Found a bug?** Report it in the issue tracker

## Code of Conduct

Please be respectful and constructive in all interactions. We're building this documentation as a community resource for everyone interested in League of Legends modding and development.

---

Thank you for contributing to the LoL Meta Wiki! Your documentation helps the entire community better understand the game's internal structure.

