import type { PhrasingContent, Root } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';

/**
 * Turns `[n]` citation markers in answer text into `<sup data-citation="n">` nodes, which the renderer swaps
 * for interactive citation chips. Code spans and code blocks are untouched (they are not text nodes), and
 * markdown links `[text](url)` are parsed before this runs, so only bare numeric markers match.
 */
export function remarkCitationMarkers() {
  return (tree: Root) => {
    findAndReplace(tree, [
      /\[(\d{1,3})\]/g,
      // An element-type mdast node is used because `data.hName` is ignored on plain text nodes.
      (_match: string, marker: string): PhrasingContent => ({
        type: 'emphasis',
        data: { hName: 'sup', hProperties: { dataCitation: marker } },
        children: [{ type: 'text', value: marker }],
      }),
    ]);
  };
}
