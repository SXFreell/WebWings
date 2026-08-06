import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('entry page layout contracts', () => {
  it('marks the popup and options entries with distinct static page identifiers', () => {
    expect(readRepoFile('index.html')).toContain('data-page="popup"')
    expect(readRepoFile('options.html')).toContain('data-page="options"')
  })

  it('keeps the popup on its fixed workspace size', () => {
    const css = readRepoFile('src/styles.css')
    expect(css).toContain("html[data-page='popup'] body")
    expect(css).toMatch(/width: 760px/)
    expect(css).toMatch(/height: 580px/)
    expect(css).toMatch(/overflow: hidden/)
  })

  it('lets the options page fill the viewport and scroll vertically', () => {
    const css = readRepoFile('src/styles.css')
    expect(css).toContain("html[data-page='options'] body")
    expect(css).toMatch(/min-height: 100vh/)
    expect(css).toMatch(/width: 100%/)
    expect(css).toMatch(/overflow-y: auto/)
    expect(css).toMatch(/overflow: visible/)
  })
})
