import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const THEME_SELECTOR = ':root,:host'
const SCOPED_SELECTOR = '.medical-viewer,.medical-viewer-portal,.orchid-medical-viewer,.orchid-medical-viewer-portal,.orchid-mri-viewer,.orchid-mri-viewer-portal'
const STYLE_TAG_ID = 'medical-viewer-styles'

/**
 * Runtime snippet prepended to the JS entry. Idempotent: a second import of
 * the package (or a host that also links `styles.css`) must not append another
 * `<style>` tag. SSR / worker evaluation is a no-op.
 */
function cssInjectionSnippet(css: string): string {
  return `;(function(){if(typeof document=="undefined")return;if(document.getElementById(${JSON.stringify(STYLE_TAG_ID)}))return;var s=document.createElement("style");s.id=${JSON.stringify(STYLE_TAG_ID)};s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();\n`
}

function shiftSourcemapByOneLine(mappings: string): string {
  return `;${mappings}`
}

/**
 * Move Tailwind's default theme tokens off `:root`, then inline the scoped CSS
 * into the library JS so `import { MedicalViewer } from 'medical-viewer'` is
 * enough. `dist/styles.css` is still emitted for hosts that want the file.
 *
 * `tailwindcss/theme.css` emits `--font-sans`, `--spacing`, `--radius-md` and
 * friends on `:root,:host`. Those names are not ours: a host that defines any of
 * them would have its own value replaced by whichever stylesheet happens to load
 * last, which is the one thing this library promises not to do. `--radius-md` is
 * the worst case, since it resolves against a `--radius` that only exists inside
 * the viewer and would therefore break the host's own components.
 *
 * The tokens only ever need to be visible to the viewer's own utilities, so
 * re-scoping them to the viewer roots is both sufficient and inert. Injection
 * runs in the same pass so the JS copy is the scoped one, not the `:root` draft.
 */
function scopeThemeTokens(): Plugin {
  return {
    name: 'orchid-scope-theme-tokens',
    // Vite emits the CSS asset from its own `generateBundle`, so this has to run
    // after every other plugin or there is nothing to rewrite yet.
    enforce: 'post',
    generateBundle(_options, bundle) {
      let scopedCss: string | undefined

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'asset' || !chunk.fileName.endsWith('.css')) continue

        const css = String(chunk.source)
        const occurrences = css.split(THEME_SELECTOR).length - 1
        if (occurrences !== 1) {
          // Fail loudly rather than publish CSS that quietly retheme's the host.
          this.error(
            `Expected exactly one "${THEME_SELECTOR}" rule in ${chunk.fileName}, found ${occurrences}. ` +
              `Tailwind's theme output changed shape; update this plugin.`,
          )
        }
        const scoped = css.replace(THEME_SELECTOR, SCOPED_SELECTOR)
        chunk.source = scoped
        scopedCss = scoped
      }

      if (scopedCss == null) {
        this.error('Library CSS was not emitted; cannot inject styles into the JS entry.')
        return
      }

      const prelude = cssInjectionSnippet(scopedCss)
      let injected = false

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.fileName !== 'index.js') continue

        chunk.code = prelude + chunk.code
        if (chunk.map && typeof chunk.map.mappings === 'string') {
          chunk.map.mappings = shiftSourcemapByOneLine(chunk.map.mappings)
        }

        const mapAsset = bundle['index.js.map']
        if (mapAsset && mapAsset.type === 'asset') {
          try {
            const map = JSON.parse(String(mapAsset.source)) as { mappings?: string }
            if (typeof map.mappings === 'string') {
              map.mappings = shiftSourcemapByOneLine(map.mappings)
              mapAsset.source = JSON.stringify(map)
            }
          } catch {
            // Sourcemap adjustment is best-effort; the JS itself is authoritative.
          }
        }

        injected = true
      }

      if (!injected) {
        this.error('Expected an index.js entry to inject the library CSS into.')
      }
    },
  }
}

const src = fileURLToPath(new URL('./src', import.meta.url))

/**
 * Everything the consumer's bundler should resolve itself. Keeping React and
 * Radix external is not just about size: two copies of either one break
 * context, so the library must never carry its own.
 */
const external = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^three($|\/)/,
  'radix-ui',
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'dicom-parser',
  'nifti-reader-js',
  'marching-cubes-fast',
]

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), scopeThemeTokens()],
  resolve: {
    alias: { '@': src },
  },
  // Playground NIfTI in /public. The library build must not copy 11 MB into dist/.
  publicDir: command === 'serve' ? 'public' : false,
  // The marching-cubes worker is emitted as its own ES chunk so that mesh mode
  // never blocks the host application's main thread.
  worker: { format: 'es' },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    sourcemap: true,
    rollupOptions: {
      external,
      output: {
        assetFileNames: (asset) =>
          asset.names?.[0]?.endsWith('.css') ? 'styles.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
}))
