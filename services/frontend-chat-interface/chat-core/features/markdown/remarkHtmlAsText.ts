import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Model output is untrusted. Instead of parsing raw HTML (and then trying to clean it), raw HTML nodes are
 * converted to plain text so `<script>` is *shown*, never interpreted. rehype-sanitize still runs afterwards
 * as defence in depth for everything markdown itself can produce (links, images, attributes).
 */
export function remarkHtmlAsText() {
  return (tree: Root) => {
    visit(tree, 'html', (node, index, parent) => {
      if (!parent || index === undefined) return;
      parent.children[index] = { type: 'text', value: node.value } as never;
    });
  };
}
