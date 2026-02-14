import {
  createAgentProvider,
  listAgentProviders,
  updateAgentProvider,
  type ApiClient,
} from "./api"
import { createRequestId } from "./request-id"

const WIZARD_TTL_MS = 15 * 60 * 1000

type WizardMode = "add" | "update"

type WizardStep =
  | "provider"
  | "model"
  | "baseUrl"
  | "apiKey"
  | "headers"
  | "activate"

type WizardState = {
  mode: WizardMode
  step: WizardStep
  createdAt: number
  providerId?: string
  current?: {
    id: string
    provider: string
    model: string
    baseUrl?: string
    headers?: Record<string, string>
  }
  data: {
    provider?: string
    model?: string
    baseUrl?: string | null
    apiKey?: string
    headers?: Record<string, string> | null
    activate?: boolean
  }
}

const wizardByChat = new Map<number, WizardState>()

const stepsByMode: Record<WizardMode, WizardStep[]> = {
  add: ["provider", "model", "baseUrl", "apiKey", "headers", "activate"],
  update: ["provider", "model", "baseUrl", "apiKey", "headers"],
}

const isExpired = (state: WizardState) =>
  Date.now() - state.createdAt > WIZARD_TTL_MS

const clearExpired = () => {
  for (const [chatId, state] of wizardByChat.entries()) {
    if (isExpired(state)) {
      wizardByChat.delete(chatId)
    }
  }
}

export const clearProviderWizard = (chatId: number) => {
  wizardByChat.delete(chatId)
}

export const hasProviderWizard = (chatId: number) => wizardByChat.has(chatId)

const parseBoolean = (input: string) => {
  const normalized = input.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return null
}

const parseHeadersJson = (input: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Invalid headers JSON: ${message}` }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Headers must be a JSON object." }
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return { error: `Header ${key} must be a string value.` }
    }
    headers[key] = value
  }
  return { headers }
}

const nextStep = (state: WizardState) => {
  const steps = stepsByMode[state.mode]
  const index = steps.indexOf(state.step)
  if (index < 0 || index === steps.length - 1) return null
  return steps[index + 1]
}

const buildPrompt = (state: WizardState) => {
  if (state.mode === "add") {
    switch (state.step) {
      case "provider":
        return "Enter provider (e.g., openai)."
      case "model":
        return "Enter model id (e.g., gpt-5.2-codex)."
      case "baseUrl":
        return "Enter baseUrl or reply 'skip'."
      case "apiKey":
        return "Enter apiKey or reply 'skip'."
      case "headers":
        return "Enter headers JSON or reply 'skip'."
      case "activate":
        return "Activate now? Reply yes/no (default yes)."
      default:
        return "Provide the next value."
    }
  }

  switch (state.step) {
    case "provider":
      return "Enter new provider or reply 'skip'."
    case "model":
      return "Enter new model or reply 'skip'."
    case "baseUrl":
      return "Enter new baseUrl, reply 'skip', or 'clear'."
    case "apiKey":
      return "Enter new apiKey or reply 'skip'."
    case "headers":
      return "Enter headers JSON, reply 'skip', or 'clear'."
    default:
      return "Provide the next value."
  }
}

const normalizeInput = (text: string) => text.trim()

const isSkip = (value: string) => value.trim().toLowerCase() === "skip"

const isClear = (value: string) => value.trim().toLowerCase() === "clear"

const isCancel = (value: string) => value.trim().toLowerCase() === "cancel"

const applyStepInput = async (
  state: WizardState,
  input: string,
  sendMessage: (text: string) => Promise<unknown>,
) => {
  const value = normalizeInput(input)
  if (!value) {
    await sendMessage("Input cannot be empty.")
    return { done: false }
  }

  if (isCancel(value)) {
    return { done: true, canceled: true }
  }

  if (state.mode === "add") {
    switch (state.step) {
      case "provider":
        state.data.provider = value
        return { done: false }
      case "model":
        state.data.model = value
        return { done: false }
      case "baseUrl":
        if (!isSkip(value)) {
          state.data.baseUrl = value
        }
        return { done: false }
      case "apiKey":
        if (!isSkip(value)) {
          state.data.apiKey = value
        }
        return { done: false }
      case "headers":
        if (isSkip(value)) return { done: false }
        {
          const result = parseHeadersJson(value)
          if (result.error) {
            await sendMessage(result.error)
            return { done: false, retry: true }
          }
          state.data.headers = result.headers
        }
        return { done: false }
      case "activate":
        if (isSkip(value)) {
          state.data.activate = true
          return { done: false }
        }
        {
          const parsed = parseBoolean(value)
          if (parsed === null) {
            await sendMessage("Invalid value. Reply yes or no.")
            return { done: false, retry: true }
          }
          state.data.activate = parsed
        }
        return { done: false }
      default:
        return { done: false }
    }
  }

  switch (state.step) {
    case "provider":
      if (!isSkip(value)) {
        state.data.provider = value
      }
      return { done: false }
    case "model":
      if (!isSkip(value)) {
        state.data.model = value
      }
      return { done: false }
    case "baseUrl":
      if (isClear(value)) {
        state.data.baseUrl = null
      } else if (!isSkip(value)) {
        state.data.baseUrl = value
      }
      return { done: false }
    case "apiKey":
      if (!isSkip(value)) {
        state.data.apiKey = value
      }
      return { done: false }
    case "headers":
      if (isClear(value)) {
        state.data.headers = null
        return { done: false }
      }
      if (isSkip(value)) return { done: false }
      {
        const result = parseHeadersJson(value)
        if (result.error) {
          await sendMessage(result.error)
          return { done: false, retry: true }
        }
        state.data.headers = result.headers
      }
      return { done: false }
    default:
      return { done: false }
  }
}

export const startProviderWizard = async (input: {
  chatId: number
  mode: WizardMode
  apiClient: ApiClient
  sendMessage: (text: string) => Promise<unknown>
  providerId?: string
}) => {
  clearExpired()

  const initialStep = stepsByMode[input.mode][0]
  if (!initialStep) {
    await input.sendMessage("Provider wizard is not configured.")
    return
  }

  const state: WizardState = {
    mode: input.mode,
    step: initialStep,
    createdAt: Date.now(),
    providerId: input.providerId,
    data: {},
  }

  if (input.mode === "update") {
    if (!input.providerId) {
      await input.sendMessage("Provider id is required for update.")
      return
    }
    const list = await listAgentProviders(input.apiClient)
    const current = list.providers.find((item) => item.id === input.providerId)
    if (!current) {
      await input.sendMessage("Provider not found.")
      return
    }
    state.current = {
      id: current.id,
      provider: current.provider,
      model: current.model,
      baseUrl: current.baseUrl,
      headers: current.headers,
    }
    await input.sendMessage(
      `Updating ${current.id} (${current.provider}/${current.model}). Reply 'skip' to keep values or 'cancel' to exit.`,
    )
  } else {
    await input.sendMessage(
      "Creating a provider. Reply 'cancel' to exit at any time.",
    )
  }

  wizardByChat.set(input.chatId, state)
  await input.sendMessage(buildPrompt(state))
}

export const handleProviderWizardInput = async (input: {
  chatId: number
  text: string
  apiClient: ApiClient
  sendMessage: (text: string) => Promise<unknown>
}) => {
  clearExpired()
  const state = wizardByChat.get(input.chatId)
  if (!state) return false

  if (isExpired(state)) {
    wizardByChat.delete(input.chatId)
    await input.sendMessage("Provider wizard expired. Start again.")
    return true
  }

  const applied = await applyStepInput(state, input.text, input.sendMessage)
  if (applied.canceled) {
    wizardByChat.delete(input.chatId)
    await input.sendMessage("Provider wizard canceled.")
    return true
  }

  if (applied.retry) {
    await input.sendMessage(buildPrompt(state))
    return true
  }

  const next = nextStep(state)
  if (next) {
    state.step = next
    await input.sendMessage(buildPrompt(state))
    return true
  }

  wizardByChat.delete(input.chatId)

  if (state.mode === "add") {
    if (!state.data.provider || !state.data.model) {
      await input.sendMessage("Provider and model are required.")
      return true
    }

    try {
      const requestId = createRequestId()
      await createAgentProvider(input.apiClient, {
        provider: state.data.provider,
        model: state.data.model,
        baseUrl:
          typeof state.data.baseUrl === "string" ? state.data.baseUrl : undefined,
        apiKey: state.data.apiKey,
        headers: state.data.headers ?? undefined,
        activate: state.data.activate,
        requestId,
      })

      await input.sendMessage("Provider created.")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await input.sendMessage(`Provider creation failed: ${message}`)
    }
    return true
  }

  if (!state.providerId) {
    await input.sendMessage("Provider id is required for update.")
    return true
  }

  if (
    !state.data.provider &&
    !state.data.model &&
    state.data.baseUrl === undefined &&
    state.data.headers === undefined &&
    !state.data.apiKey
  ) {
    await input.sendMessage("No update fields provided.")
    return true
  }

  try {
    const requestId = createRequestId()
    await updateAgentProvider(input.apiClient, {
      id: state.providerId,
      provider: state.data.provider,
      model: state.data.model,
      baseUrl: state.data.baseUrl,
      apiKey: state.data.apiKey,
      headers: state.data.headers,
      requestId,
    })

    await input.sendMessage("Provider updated.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await input.sendMessage(`Provider update failed: ${message}`)
  }
  return true
}
