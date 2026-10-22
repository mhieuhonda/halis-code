/** Tiny i18n runtime: t('key') + params, backed by the app store language. */
import { useAppStore } from '../stores/app'
import { en, type Dict } from './en'
import { vi } from './vi'

const dictionaries: Record<string, Dict> = { en, vi }

export function translate(lang: string, key: keyof Dict, params?: Record<string, string | number>): string {
  const dict = dictionaries[lang] ?? en
  let text: string = (dict[key] as string) ?? (en[key] as string) ?? String(key)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

export function useT() {
  const lang = useAppStore((s) => s.settings?.language ?? 'en')
  return (key: keyof Dict, params?: Record<string, string | number>) => translate(lang, key, params)
}
