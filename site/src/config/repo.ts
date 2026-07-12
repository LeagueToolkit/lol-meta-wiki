export const REPO_CONFIG = {
  repoUrl: 'https://github.com/LeagueToolkit/lol-meta-wiki',
  branch: 'main',
  docsDir: 'db/docs',
};

/**
 * URL for documenting a class on GitHub: the web editor for an existing
 * docs file, or the "create new file" flow (prefilled with a YAML skeleton)
 * when none exists yet. GitHub handles the fork-and-PR flow automatically
 * for contributors without write access.
 */
export function getDocUrl(
  className: string,
  docExists: boolean,
  propertyName?: string,
): string {
  const { repoUrl, branch, docsDir } = REPO_CONFIG;

  if (docExists) {
    return `${repoUrl}/edit/${branch}/${docsDir}/${className}.yaml`;
  }

  // GitHub's /new/ route prefills the editor from the `filename` and
  // `value` query params.
  const params = new URLSearchParams({
    filename: `${className}.yaml`,
    value: docTemplate(className, propertyName),
  });
  return `${repoUrl}/new/${branch}/${docsDir}?${params}`;
}

/**
 * YAML skeleton for a new docs file, matching the format described in
 * CONTRIBUTING.md. When the contributor came from a property's button,
 * that property is stubbed out ready to fill in.
 */
function docTemplate(className: string, propertyName?: string): string {
  const propertiesStub = propertyName
    ? `properties:
  ${propertyName}:
    description: |
      TODO: Describe this property.
    # examples:
    #   - "..."
    # notes:
    #   - "..."
`
    : `# properties:
#   mSomeProperty:
#     description: |
#       TODO: Describe this property.
`;

  return `# ${className} Documentation
# Format: see CONTRIBUTING.md and db/docs/MARKDOWN_GUIDE.md
# Descriptions support Markdown. Delete any sections you don't fill in.

class:
  description: |
    TODO: Describe ${className}.
  # examples:
  #   - "..."
  # notes:
  #   - "..."

${propertiesStub}`;
}
