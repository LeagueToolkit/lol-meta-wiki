# Documentation Files

This directory contains community-contributed documentation for League of Legends meta classes and properties. Each class has a single YAML file containing both class-level and property-level documentation.

## File Structure

Each file is named after the class (e.g., `AiBaseClient.yaml`, `Turret.yaml`) and contains:
- **Class documentation** - Overview, examples, and notes about the class
- **Property documentation** - Details about each property in the class

## File Format

```yaml
# ClassName Documentation

class:
  description: "What this class represents"
  examples:
    - "Example 1"
  notes:
    - "Note 1"

properties:
  propertyName:
    description: "What this property does"
    examples:
      - "Example value"
    notes:
      - "Additional info"
```

## Example Files

- `Turret.yaml` - Complete example with class and property documentation
- `AiBaseClient.yaml` - Template for adding new documentation

## Contributing

Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed instructions on how to add documentation.

## Workflow

1. Documentation is written in YAML files in this directory
2. Build script (`scripts/generate-db.ts`) reads these files
3. Documentation is embedded into generated JSON files
4. Astro components display the documentation on the website
5. Users can click "Add documentation" buttons to contribute via GitHub PRs
6. All documentation for a class (class-level and properties) is in one convenient file

