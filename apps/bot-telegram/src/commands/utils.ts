export const formatSessionName = (chatId: number) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `telegram-${chatId}-${timestamp}`.slice(0, 200)
}

export const shortId = () => Math.random().toString(36).slice(2, 8)
