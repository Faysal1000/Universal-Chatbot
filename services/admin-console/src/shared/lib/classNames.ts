/** Joins truthy class names: `joinClassNames("a", isActive && "b")`. */
export function joinClassNames(...classNames: (string | false | null | undefined)[]): string {
  return classNames.filter(Boolean).join(' ');
}
