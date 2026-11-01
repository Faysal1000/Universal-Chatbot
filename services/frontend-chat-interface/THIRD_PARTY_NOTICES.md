# Third-party notices

## thinking-orbs

The animated "thinking" orbs are adapted from [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)
by Jakub Antalik (commit `de85557`). A trimmed copy lives in `src/features/thinking/thinking-orb/`: rewritten
in strict TypeScript with typed options, keeping only the five animations this app uses. Every file there
carries the attribution, and the license is kept next to the code in `src/features/thinking/thinking-orb/LICENSE`.
The mapping from chat states to orb animations lives in `src/features/thinking/orbStateForReply.ts`.

```
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Other dependencies (React, KaTeX, highlight.js, Radix UI, lucide, i18next, zod, zustand, Inter, Noto Sans Bengali,
JetBrains Mono) are used under their own permissive licenses as listed in `package-lock.json`.
