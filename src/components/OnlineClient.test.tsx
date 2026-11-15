import { describe, expect, it, vi } from 'vitest'
import { copyInviteCode } from './OnlineClient'

function makeInput(writeText?: (text: string) => Promise<void>, copyResult = true) {
  const execCommand = vi.fn(() => copyResult)
  const input = {
    value: 'ABCD2345',
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    ownerDocument: {
      defaultView: { navigator: { clipboard: writeText ? { writeText } : undefined } },
      execCommand,
    },
  }
  return { input, field: input as unknown as HTMLInputElement, execCommand }
}

describe('copying the PvP invite', () => {
  it('copies exactly the invite code through the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { field, execCommand } = makeInput(writeText)
    await expect(copyInviteCode(field)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('copies the selected code synchronously when the Clipboard API is unavailable', async () => {
    const { input, field, execCommand } = makeInput()
    const copy = copyInviteCode(field)
    expect(input.focus).toHaveBeenCalled()
    expect(input.select).toHaveBeenCalled()
    expect(input.setSelectionRange).toHaveBeenCalledWith(0, 8)
    expect(execCommand).toHaveBeenCalledWith('copy')
    await expect(copy).resolves.toBe(true)
  })

  it('falls back to copying the selection when the browser rejects clipboard access', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'))
    const { field, execCommand } = makeInput(writeText)
    await expect(copyInviteCode(field)).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('leaves the code selected for manual copy if copying is blocked', async () => {
    const { input, field, execCommand } = makeInput(undefined, false)
    await expect(copyInviteCode(field)).resolves.toBe(false)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(input.setSelectionRange).toHaveBeenCalledWith(0, 8)
  })
})
