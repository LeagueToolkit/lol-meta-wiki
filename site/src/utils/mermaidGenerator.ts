/**
 * Generate Mermaid diagram code for class inheritance hierarchies
 */

interface ClassData {
  name: string;
  bases: string[];
  ancestors?: string[];
  descendants?: string[];
  directChildren?: string[];
}

/**
 * Generate Mermaid inheritance diagram
 * Returns empty string if no inheritance relationships exist
 */
export function generateInheritanceDiagram(
  data: ClassData,
  classIndex: Record<string, string>
): string {
  const currentClass = data.name;
  const bases = data.bases || [];
  const directChildren = data.directChildren || [];

  // If no inheritance relationships, return empty
  if (bases.length === 0 && directChildren.length === 0) {
    return "";
  }

  // For very large hierarchies, limit what we show directly in the diagram
  const MAX_CHILDREN_IN_DIAGRAM = 8;
  const showAllChildren = directChildren.length <= MAX_CHILDREN_IN_DIAGRAM;
  const childrenToShow = showAllChildren
    ? directChildren
    : directChildren.slice(0, MAX_CHILDREN_IN_DIAGRAM);
  const hiddenChildrenCount = directChildren.length - childrenToShow.length;

  const lines: string[] = ["flowchart TB"];
  const processed = new Set<string>();

  // Helper to sanitize class names for Mermaid (replace special chars)
  const mermaidSafe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");

  // Helper to create a node with proper styling
  const createNode = (className: string, isCurrent = false) => {
    const safeId = mermaidSafe(className);
    if (isCurrent) {
      return `${safeId}["<b>${className}</b><br/><i>current</i>"]:::current`;
    }
    return `${safeId}["${className}"]`;
  };

  // Add the current class
  const currentSafe = mermaidSafe(currentClass);
  lines.push(`  ${createNode(currentClass, true)}`);
  processed.add(currentClass);

  // Add direct inheritance relationships (current class inherits from bases)
  for (const base of bases) {
    if (!processed.has(base)) {
      lines.push(`  ${createNode(base)}`);
      processed.add(base);
    }
    lines.push(`  ${mermaidSafe(base)} --> ${currentSafe}`);
  }

  // Add direct children (classes that inherit from current)
  for (const child of childrenToShow) {
    if (!processed.has(child)) {
      lines.push(`  ${createNode(child)}`);
      processed.add(child);
    }
    lines.push(`  ${currentSafe} --> ${mermaidSafe(child)}`);
  }

  // Add a note about hidden children if any
  if (hiddenChildrenCount > 0) {
    lines.push(`  more["... and ${hiddenChildrenCount} more"]:::more`);
    lines.push(`  ${currentSafe} -.-> more`);
  }

  // Add click events to make classes clickable
  for (const className of processed) {
    if (className !== currentClass && classIndex[className]) {
      const url = classIndex[className];
      lines.push(
        `  click ${mermaidSafe(className)} href "${url}" "View ${className}"`
      );
    }
  }

  // Add class definitions for styling
  lines.push(
    `  classDef current fill:#4f46e5,stroke:#3730a3,stroke-width:3px,color:#fff,font-weight:bold`
  );
  lines.push(
    `  classDef more fill:transparent,stroke:#9ca3af,stroke-dasharray:5 5,color:#6b7280`
  );

  return lines.join("\n");
}
