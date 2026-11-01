import { useState, type DragEvent } from 'react';

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/**
 * Drag-and-drop of images onto a chat area: tracks whether files hover over it (for the drop overlay) and hands
 * dropped files to `onFiles`. Spread `dropZoneProps` onto the area's element.
 */
export function useImageDropZone(onFiles: (files: File[]) => void) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const dropZoneProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (hasFiles(event)) setIsDraggingFiles(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (hasFiles(event)) event.preventDefault();
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const isLeavingZone =
        event.currentTarget === event.target ||
        !event.currentTarget.contains(event.relatedTarget as Node | null);
      if (isLeavingZone) setIsDraggingFiles(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setIsDraggingFiles(false);
      onFiles(Array.from(event.dataTransfer.files));
    },
  };

  return { isDraggingFiles, dropZoneProps };
}
