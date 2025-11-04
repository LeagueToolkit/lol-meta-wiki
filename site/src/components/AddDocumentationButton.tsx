import { getDocEditUrl } from '../config/repo';
import './AddDocumentationButton.css';

interface AddDocumentationButtonProps {
  className: string;
  propertyName?: string;
}

/**
 * Button component that links to GitHub to edit documentation files
 */
export default function AddDocumentationButton({
  className,
  propertyName,
}: AddDocumentationButtonProps) {
  // Get the GitHub edit URL
  const editUrl = getDocEditUrl(className);
  
  const handleClick = () => {
    window.open(editUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="add-docs-button"
      title={`Edit documentation for ${propertyName || className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <title>Edit documentation</title>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
      Add documentation
    </button>
  );
}

