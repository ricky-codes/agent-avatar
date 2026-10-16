import { expect, test } from 'claude-code/testing'

const PANE = { plugin: 'agent-avatar', component: 'Pane', props: {}, requestId: 'agent-avatar' } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`reage a mensagens e ferramentas (${surface})`, async ($, on) => {
    let seen = ''
    let ui: any
    on('prompt.submit', async (_$, e) => e as any)
    on('tool.call', async () => {
      seen = JSON.stringify(await ui.drawn())
      return { result: 'ok' } as any
    })

    await $.prompt.submit({ text: 'olá' } as any)
    ui = await $.ui.mount({ ...PANE, surface } as any)
    expect(JSON.stringify(await ui.drawn())).toContain('A pensar')

    await $.tool.call({ tool: 'Edit', input: { file_path: '/x', old_string: 'a', new_string: 'b' } } as any)
    expect(seen).toContain('A escrever')
    if (surface === 'desktop') expect(seen).toContain('class=\\"writing\\"')
  })
}
