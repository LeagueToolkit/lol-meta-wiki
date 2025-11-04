# LoL Meta Wiki

A community-driven wiki for documenting League of Legends Meta (.bin) classes and properties.

## What is this?

This project provides **interactive documentation** for the internal structure of League of Legends game data. It combines a database of meta classes with community-contributed documentation to help developers and modders understand the game's data structures.

**Features:**
- Browse 4000+ meta classes with inheritance relationships
- Interactive inheritance trees and property listings
- Community-contributed documentation via GitHub PRs
- Full Markdown support in documentation

## Getting Started

### Prerequisites

- [pnpm](https://pnpm.io/) - Package manager
- [Bun](https://bun.sh/) - JavaScript runtime

### Installation & Setup

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/lol-meta-wiki.git
cd lol-meta-wiki
pnpm install
bun install

# 2. Configure repository URL (for documentation contributions)
# Edit site/src/config/repo.ts and update your GitHub URL

# 3. Generate database
pnpm generate-db

# 4. Start dev server
pnpm dev
```

Visit **http://localhost:4321** to see the wiki.

### Build for Production

```bash
pnpm generate-db
pnpm build
```

Deploy the `site/dist/` directory to any static hosting service.

## Contributing Documentation

You can add documentation for classes and properties:

**Via Web:** Click "Add documentation" buttons on any class page → Edit on GitHub → Submit PR

**Locally:** Create/edit files in `db/docs/ClassName.yaml`:

```yaml
# ClassName Documentation

class:
  description: |
    Your class description with **Markdown** support.

properties:
  propertyName:
    description: "What this property does"
    examples:
      - "Example value"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines and [db/docs/MARKDOWN_GUIDE.md](db/docs/MARKDOWN_GUIDE.md) for Markdown formatting tips.

## Documentation

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - How to add documentation
- **[SETUP.md](SETUP.md)** - Detailed setup and development guide
- **[db/docs/MARKDOWN_GUIDE.md](db/docs/MARKDOWN_GUIDE.md)** - Using Markdown in YAML

## Built With

- [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) - Static site framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe development
- [YAML](https://yaml.org/) - Documentation format

## License

[Add license information here]

---

Made with ❤️ for the League of Legends modding community
