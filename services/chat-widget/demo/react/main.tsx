import '@faysal1000/universal-chatbot';
import type {} from '@faysal1000/universal-chatbot/jsx';

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { demoWidgetAttributes } from '../demoConfig';

function ReactHost() {
  const [attributes] = useState(demoWidgetAttributes);
  const [openCount, setOpenCount] = useState(0);
  return (
    <main className="site">
      <h1>Orion Lighthouse</h1>
      <p>A React page. The widget is a custom element, so it is used like any other tag.</p>
      <p data-testid="open-count">Chat opened {openCount} times</p>
      <universal-chat-bot
        api-key={attributes['api-key'] ?? ''}
        api-url={attributes['api-url'] ?? ''}
        {...attributes}
        ref={(element) => {
          if (!element) return;
          const onOpen = () => setOpenCount((count) => count + 1);
          element.addEventListener('chat-open', onOpen);
          return () => element.removeEventListener('chat-open', onOpen);
        }}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <ReactHost />
  </StrictMode>,
);
