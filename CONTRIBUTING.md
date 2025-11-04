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

1. **Be Clear and Concise**: Write descriptions that are easy to understand for both developers and modders
2. **Provide Context**: Explain how the property/class is used in the game
3. **Include Examples**: Real-world examples help users understand the practical application
4. **Note Edge Cases**: Mention any special behaviors, limitations, or version-specific information
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
- ❌ Don't use offensive or inappropriate language
- ❌ Don't break the YAML formatting (the build will fail)

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

3. **Generate the database with your documentation**
   ```bash
   pnpm generate-db
   ```

4. **Run the development server**
   ```bash
   pnpm dev
   ```

5. **View your changes at** `http://localhost:4321`

## Submitting Your Contribution

1. **Commit your changes** with a descriptive message:
   ```bash
   git add db/docs/
   git commit -m "Add documentation for AiBaseClient class"
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

