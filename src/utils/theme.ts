const darkThemeMq = window.matchMedia('(prefers-color-scheme: dark)')

const isThemeAuto = () => {
  return localStorage.getItem('__theme') === 'auto'
}

const themeChange = (matches: boolean) => {
  if (!isThemeAuto()) {
    return
  }
  if (matches) {
    document.body.setAttribute('arco-theme', 'dark')
  } else {
    document.body.setAttribute('arco-theme', 'light')
  }
}

export const listenSystemTheme = () => {
  themeChange(darkThemeMq.matches)
  darkThemeMq.addEventListener('change', (e) => {
    themeChange(e.matches)
  })
}

export const setSystemTheme = () => {
  themeChange(darkThemeMq.matches)
}
