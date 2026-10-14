/**
 * 偵測是否在 LINE、Facebook、Instagram 等 App 的內建瀏覽器中。
 * Google 不允許在這些內建瀏覽器裡登入，需要提示使用者改用外部瀏覽器。
 */
export function detectInAppBrowser(): string | null {
  const ua = navigator.userAgent
  if (/Line\//i.test(ua)) return 'LINE'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook'
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/Messenger/i.test(ua)) return 'Messenger'
  return null
}

/** LINE 支援在網址加上 openExternalBrowser=1，自動改用外部瀏覽器開啟 */
export function externalBrowserUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set('openExternalBrowser', '1')
  return url.toString()
}
