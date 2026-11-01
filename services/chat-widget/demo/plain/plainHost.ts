import { demoWidgetAttributes } from '../demoConfig';

// A real site writes the element straight into its HTML; the demo builds it from the query string instead.
const widget = document.createElement('universal-chat-bot');
for (const [name, value] of Object.entries(demoWidgetAttributes())) widget.setAttribute(name, value);
document.body.append(widget);
