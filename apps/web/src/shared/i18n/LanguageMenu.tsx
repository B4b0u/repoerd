import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { isLanguage, LANGUAGES, setLanguage, toLanguage } from './i18n'

/** The language choices, inside any dropdown menu. */
export function LanguageRadioGroup() {
  const { t, i18n } = useTranslation('common')
  return (
    <>
      <DropdownMenuLabel>{t('language.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={toLanguage(i18n.resolvedLanguage)}
        onValueChange={(value) => {
          if (isLanguage(value)) void setLanguage(value)
        }}
      >
        {LANGUAGES.map((language) => (
          <DropdownMenuRadioItem key={language} value={language} lang={language}>
            {t(`language.${language}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

/** Language picker of the pages without account menu (sign-in, setup). */
export function LanguageMenu() {
  const { t } = useTranslation('common')
  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('language.label')}>
                <Languages />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('language.label')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end">
        <LanguageRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
