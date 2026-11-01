-- Version 1 of the chatbot settings, so the public chat works before an admin edits anything.
INSERT INTO "chatbot_settings_versions" ("bot_name", "greeting_message", "system_instruction", "fallback_message", "is_active")
SELECT
  'Assistant',
  'Hello! Ask me anything about our documents.',
  'You are a helpful, friendly assistant for this organisation. Answer clearly and concisely. Reply in the language the visitor writes in.',
  'I couldn''t find anything about that in our documents. Please rephrase your question or ask about something else.',
  true
WHERE NOT EXISTS (SELECT 1 FROM "chatbot_settings_versions");
