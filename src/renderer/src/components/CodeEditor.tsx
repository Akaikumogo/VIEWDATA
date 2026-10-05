import { json } from '@codemirror/lang-json'
import { MariaSQL, MySQL, PLSQL, PostgreSQL, SQLite, sql } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { DbKind } from '@shared/types'

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: '#d4d4d8', fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'Geist Mono Variable', ui-monospace, monospace", lineHeight: '1.65' },
    '.cm-content': { caretColor: 'var(--color-accent)', padding: '14px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#3f3f46', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a1a1aa' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(95,212,173,0.18) !important'
    },
    '.cm-matchingBracket': { backgroundColor: 'rgba(95,212,173,0.15)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: '#141416', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(95,212,173,0.14)', color: '#fafafa' },
    '.cm-completionDetail': { color: '#71717a', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-placeholder': { color: '#52525b' },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: '#71717a' }
  },
  { dark: true }
)

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'oklch(0.8 0.115 168)' },
  { tag: [t.string, t.special(t.string)], color: 'oklch(0.82 0.08 140)' },
  { tag: [t.number, t.bool, t.null], color: 'oklch(0.82 0.09 250)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#52525b', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#71717a' },
  { tag: [t.typeName, t.className], color: 'oklch(0.85 0.1 85)' },
  { tag: [t.propertyName, t.name], color: '#e4e4e7' }
])

const DIALECT = {
  postgres: PostgreSQL,
  mysql: MySQL,
  mariadb: MariaSQL,
  oracle: PLSQL,
  demo: SQLite
} as const

function language(kind: DbKind, schema: Record<string, string[]>) {
  if (kind === 'mongodb') return json()
  return sql({ dialect: DIALECT[kind], schema, upperCaseKeywords: true })
}

export function CodeEditor({
  value,
  onChange,
  onRun,
  kind,
  schema,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  kind: DbKind
  schema: Record<string, string[]>
  placeholder?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lang = useRef(new Compartment())
  const handlers = useRef({ onChange, onRun })
  handlers.current = { onChange, onRun }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  handlers.current.onRun()
                  return true
                }
              }
            ])
          ),
          basicSetup,
          theme,
          syntaxHighlighting(highlight),
          lang.current.of(language(kind, schema)),
          placeholderExt(placeholder ?? ''),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString())
          })
        ]
      })
    })
    view.current = v
    v.focus()
    return () => v.destroy()
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(language(kind, schema)) })
  }, [kind, schema])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
