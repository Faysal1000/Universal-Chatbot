/**
 * Answers are markdown; a one-line preview in a table should read as plain text, so the
 * emphasis, code, heading and quote marks and the link targets are dropped.
 */
export function toPlainPreview(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[^\w*])(\*\*|__|\*|_)(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
