import { InlineKeyboard } from "grammy"

const DEFAULT_MENU_CANCEL_DELAY_MS = 4000

type MenuMessageTarget = {
  chatId: number
  messageId: number
}

type MenuContextBase = {
  chat?: { id?: number }
  message?: { message_id?: number; chat?: { id?: number } }
  callbackQuery?: { message?: { message_id?: number; chat?: { id?: number } } }
}

export type MenuCancelContext = MenuContextBase & {
  api: {
    deleteMessage: (chatId: number, messageId: number) => Promise<unknown>
  }
  answerCallbackQuery: (
    options?: { text?: string; show_alert?: boolean },
  ) => Promise<unknown>
  editMessageText: (
    text: string,
    options?: { reply_markup?: InlineKeyboard },
  ) => Promise<unknown>
}

type MenuCancelOptions = {
  text?: string
  delayMs?: number
  onCancel?: () => void | Promise<void>
}

type OrderListTextOptions<Item> = {
  title: string
  items: Item[]
  offset: number
  getLabel: (item: Item) => string
  footer?: string
}

type OrderListKeyboardOptions<Item> = {
  offset: number
  getCallbackData: (item: Item, order: number) => string
  prevData?: string
  nextData?: string
  cancelData?: string
}

const resolveMenuTarget = (ctx: MenuContextBase): MenuMessageTarget | null => {
  const message = ctx.callbackQuery?.message ?? ctx.message
  const chatId = message?.chat?.id ?? ctx.chat?.id
  const messageId = message?.message_id
  if (!chatId || !messageId) return null
  return { chatId, messageId }
}

export const scheduleMenuDeletion = (
  ctx: MenuCancelContext,
  delayMs: number = DEFAULT_MENU_CANCEL_DELAY_MS,
) => {
  const target = resolveMenuTarget(ctx)
  if (!target) return
  setTimeout(() => {
    void ctx.api.deleteMessage(target.chatId, target.messageId).catch(() => {})
  }, delayMs)
}

export const handleMenuCancel = async (
  ctx: MenuCancelContext,
  options: MenuCancelOptions = {},
) => {
  const {
    text = "Menu canceled.",
    delayMs = DEFAULT_MENU_CANCEL_DELAY_MS,
    onCancel,
  } = options

  await ctx.answerCallbackQuery()
  if (onCancel) {
    await onCancel()
  }
  try {
    await ctx.editMessageText(text)
  } catch {
    // Ignore edit errors to ensure deletion still happens.
  }
  scheduleMenuDeletion(ctx, delayMs)
}

export const buildOrderListText = <Item>({
  title,
  items,
  offset,
  getLabel,
  footer,
}: OrderListTextOptions<Item>) => {
  const lines = [title]
  items.forEach((item, index) => {
    const order = offset + index + 1
    const label = getLabel(item)
    lines.push(`${order}. ${label}`)
  })
  if (footer) lines.push(footer)
  return lines.join("\n")
}

export const buildOrderListKeyboard = <Item>(
  items: Item[],
  options: OrderListKeyboardOptions<Item>,
) => {
  const keyboard = new InlineKeyboard()
  items.forEach((item, index) => {
    const order = options.offset + index + 1
    keyboard.text(String(order), options.getCallbackData(item, order)).row()
  })

  if (options.prevData || options.nextData) {
    if (options.prevData) keyboard.text("Prev", options.prevData)
    if (options.nextData) keyboard.text("Next", options.nextData)
    keyboard.row()
  }

  if (options.cancelData) {
    keyboard.text("Cancel", options.cancelData)
  }

  return keyboard
}

export const getNextEnumValue = <T extends string>(
  values: readonly T[],
  current: T,
) => {
  if (values.length === 0) {
    throw new Error("No enum values provided.")
  }
  const index = values.indexOf(current)
  const nextIndex = index === -1 ? 0 : (index + 1) % values.length
  return values[nextIndex]!
}
