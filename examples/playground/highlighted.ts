import { createHighlighter } from 'shiki'
import {
  CLINICAL_SNIPPET,
  COMPOSED_SNIPPET,
  DROP_IN_SNIPPET,
  EDITORIAL_SNIPPET,
  HEADLESS_SNIPPET,
  LANDING_SNIPPET,
  LIGHT_SNIPPET,
  MIDNIGHT_SNIPPET,
  VOLUME_SNIPPET,
} from './snippets'

/**
 * Playground-only. Loaded when the landing snippet or a Code tab needs HTML.
 * Snippets are static — highlight once, then serve HTML.
 */
const highlighter = await createHighlighter({
  langs: ['tsx'],
  themes: ['github-dark'],
})

function highlight(code: string) {
  return highlighter.codeToHtml(code, {
    lang: 'tsx',
    theme: 'github-dark',
    rootStyle: false,
    transformers: [
      {
        name: 'pg-code',
        pre(node) {
          this.addClassToHast(node, 'pg-code')
        },
      },
    ],
  })
}

const cache = new Map<string, string>([
  [LANDING_SNIPPET, highlight(LANDING_SNIPPET)],
  [DROP_IN_SNIPPET, highlight(DROP_IN_SNIPPET)],
  [COMPOSED_SNIPPET, highlight(COMPOSED_SNIPPET)],
  [HEADLESS_SNIPPET, highlight(HEADLESS_SNIPPET)],
  [CLINICAL_SNIPPET, highlight(CLINICAL_SNIPPET)],
  [MIDNIGHT_SNIPPET, highlight(MIDNIGHT_SNIPPET)],
  [EDITORIAL_SNIPPET, highlight(EDITORIAL_SNIPPET)],
  [VOLUME_SNIPPET, highlight(VOLUME_SNIPPET)],
  [LIGHT_SNIPPET, highlight(LIGHT_SNIPPET)],
])

export function htmlForSnippet(code: string): string {
  const cached = cache.get(code)
  if (cached) return cached
  const html = highlight(code)
  cache.set(code, html)
  return html
}
