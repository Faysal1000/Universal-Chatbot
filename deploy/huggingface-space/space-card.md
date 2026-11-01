---
title: Universal Chatbot
emoji: 💬
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
startup_duration_timeout: 1h
pinned: false
short_description: Chat with your documents, with cited answers
---

# Universal Chatbot

Ask questions about the uploaded documents and get streamed answers that cite the pages they
came from. Admins manage documents, models and settings at [`/admin/`](./admin/).

This Space is deployed from [Faysal1000/Universal-Chatbot](https://github.com/Faysal1000/Universal-Chatbot);
every push to `main` rebuilds the image and replaces this repository with a single commit.
