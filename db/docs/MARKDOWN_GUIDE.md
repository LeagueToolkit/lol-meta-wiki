# Using Markdown in Documentation

You can use Markdown formatting in your YAML documentation files! This allows you to create rich, well-formatted documentation.

## How to Use Multi-line Strings in YAML

YAML supports multi-line strings using the pipe (`|`) operator:

```yaml
description: |
  This is a multi-line description.
  
  You can use **bold**, *italic*, and other Markdown formatting.
  
  - Bullet points work too
  - As do numbered lists
  
  Even [links](https://example.com) work!
```

## Supported Markdown Features

### Text Formatting
```yaml
description: |
  Use **bold text** for emphasis.
  Use *italic text* for subtle emphasis.
  Use `code` for inline code or property names.
  Use ~~strikethrough~~ for deprecated information.
```

### Links
```yaml
description: |
  Reference external resources with [link text](https://example.com).
  Link to other classes: see `BuffComponent` for more details.
```

### Lists

**Bullet Lists:**
```yaml
description: |
  This property controls:
  - Movement speed
  - Animation timing
  - Particle effects
```

**Numbered Lists:**
```yaml
description: |
  Calculation steps:
  1. Get base value
  2. Apply multipliers
  3. Add flat bonuses
  4. Clamp to min/max
```

### Code Blocks
```yaml
description: |
  Example usage:
  
  ```lua
  local health = unit.mMaxHealth
  print(health)
  ```
```

### Headings
```yaml
description: |
  ## Overview
  
  This property represents...
  
  ### Technical Details
  
  The underlying implementation...
```

### Emphasis and Warnings
```yaml
notes:
  - "⚠️ **Warning**: This value can be `null` in some contexts"
  - "💡 **Tip**: Always check for zero before division"
  - "🔧 **Technical**: Uses IEEE 754 floating-point representation"
```

## Complete Example

```yaml
# Champion Documentation

class:
  description: |
    Represents a **playable champion** in League of Legends.
    
    Champions are the primary player-controlled units with unique:
    - Abilities (Q, W, E, R)
    - Stats (HP, Mana, AD, AP, etc.)
    - Gameplay mechanics
    
    For more information, see the [Champion Wiki](https://leagueoflegends.fandom.com/wiki/Champion).
  
  examples:
    - "Annie - a mage champion with burst damage"
    - "Garen - a tank/fighter with high durability"
  
  notes:
    - "⚠️ Champion data is loaded at game start"
    - "Each champion has a unique `CharacterRecord` reference"

properties:
  mMaxHealth:
    description: |
      The **maximum health** (HP) the champion can have.
      
      ## Calculation
      
      Final max health is calculated as:
      ```
      MaxHP = BaseHP + (LevelHP × Level) + BonusHP
      ```
      
      Where:
      - `BaseHP` = Champion's base health
      - `LevelHP` = Health per level
      - `BonusHP` = From items, runes, buffs
    
    examples:
      - "Annie at level 1: 560 HP"
      - "Annie at level 18: 2100 HP (no items)"
      - "With Warmog's Armor: +800 HP"
    
    notes:
      - "Different from current health (`mHealth`)"
      - "Can be temporarily exceeded by shields"
      - "💡 **Tip**: Some abilities scale with max HP"
```

## Best Practices

### DO ✅
- Use **bold** for important terms on first use
- Use `code formatting` for property names, values, and technical terms
- Break long descriptions into sections with bullet points
- Add links to external resources when helpful
- Use emojis sparingly for warnings and tips (⚠️, 💡, 🔧)

### DON'T ❌
- Don't use excessive formatting
- Don't use Markdown tables (they're hard to read in YAML)
- Don't use images (not supported in this context)
- Don't overuse emojis
- Don't nest lists too deeply

## YAML Syntax Reminders

### Single-line Strings
```yaml
description: "Simple one-line description"
```

### Multi-line Strings (preserves line breaks)
```yaml
description: |
  Line 1
  Line 2
  Line 3
```

### Multi-line Strings (folds into single line)
```yaml
description: >
  This text will be
  folded into a single
  line with spaces.
```

### Lists
```yaml
examples:
  - "Example 1"
  - "Example 2"
```

### Multi-line List Items
```yaml
notes:
  - |
    This is a longer note that
    spans multiple lines.
  - "Short note"
```

## Rendering

Your Markdown will be rendered on the website using standard Markdown parsers. The final output will display on the class and property pages with proper formatting, links, and styling.

---

Happy documenting! 📝

