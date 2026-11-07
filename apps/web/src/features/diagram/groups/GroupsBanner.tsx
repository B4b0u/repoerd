import { useTranslation } from 'react-i18next'

/** Says that the groups on the canvas are proposals: nothing is saved for this schema yet. */
export function GroupsBanner({ count }: { count: number }) {
  const { t } = useTranslation('diagram')
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border bg-card px-3.5 py-1.5 text-sm shadow-md"
    >
      {t('groups.proposed', { count })}
    </div>
  )
}
