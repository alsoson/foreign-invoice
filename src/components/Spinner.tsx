export function Spinner({ full = false }: { full?: boolean }) {
  const spinner = (
    <div
      role="status"
      aria-label="載入中"
      className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent"
    />
  )
  if (!full) return spinner
  return <div className="flex min-h-dvh items-center justify-center">{spinner}</div>
}
