export const REPO_CONFIG = {
  repoUrl: 'https://github.com/LeagueToolkit/lol-meta-wiki',
  branch: 'main',
  useWebEditor: true,
};

/**
 * Generate a GitHub edit URL for documentation files
 */
export function getDocEditUrl(className: string): string {
  const { repoUrl, branch } = REPO_CONFIG;
  
  const filePath = `db/docs/${className}.yaml`;
  
  return `${repoUrl}/edit/${branch}/${filePath}`;
}

