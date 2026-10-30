/**
 * 打開 App 時自動進入預設旅程：只在「剛打開、停在首頁」時做一次。
 * 從邀請連結或其他頁面進來、或使用者已經切到別頁時就取消，
 * 之後再回到旅程列表也不會又被帶走。
 */
const isHome = (hash: string) => hash === '' || hash === '#' || hash === '#/'

let pending = typeof window !== 'undefined' && isHome(window.location.hash)

export const launch = {
  /** 取出並清除：回傳 true 表示這次可以自動進入預設旅程 */
  take(): boolean {
    const v = pending
    pending = false
    return v
  },
  cancel(): void {
    pending = false
  },
}
