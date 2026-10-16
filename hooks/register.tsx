import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AvatarState, Mood } from '../types'

const PANE = 'agent-avatar'
const TITLE = 'Avatar'
const mood = atom({ plugin: 'agent-avatar', key: 'mood' } as const, {
  state: 'idle',
  label: 'Olá 👋',
  ts: 0,
} as Mood)

function forTool(tool: string): [AvatarState, string] {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return ['writing', 'A escrever']
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return ['reading', 'A ler ficheiros']
  if (/^Bash$/.test(tool)) return ['running', 'A correr comandos']
  if (/^(WebSearch|WebFetch)$/.test(tool) || /image_search/.test(tool)) return ['searching', 'A pesquisar']
  if (/^(Task|Agent)$/.test(tool)) return ['delegating', 'A delegar num subagente']
  if (/^AskUserQuestion$/.test(tool)) return ['attention', 'Preciso de ti!']
  if (/^mcp__/.test(tool)) {
    const app = (tool.split('__')[1] || 'MCP').replace(/_/g, ' ')
    return ['working' as AvatarState, `A usar ${app}`]
  }
  return ['working' as AvatarState, `A usar ${tool}`]
}

// Reencaminha o estado para o MCP local no PC do Ricardo (ponte do Desktop).
// O nome com que o servidor aparece aqui ainda não é conhecido: tenta-se cada
// candidato e fica-se com o primeiro que responder.
const MCP_CANDIDATES: [string, string][] = [
  ['agent-avatar', 'avatar_set_state'],
  ['remote-devices', 'avatar_set_state'],
  ['remote-devices', 'agent-avatar__avatar_set_state'],
]
let mcpTarget: [string, string] | null = null
let retryAt = 0

async function relay($: any, state: AvatarState, label: string) {
  if (!mcpTarget && Date.now() < retryAt) return
  const args = { state, label }
  if (mcpTarget) {
    const r: any = await $.mcp.call(mcpTarget[0], mcpTarget[1], args).catch(() => null)
    if (!r || r.isError) mcpTarget = null
    return
  }
  for (const c of MCP_CANDIDATES) {
    const r: any = await $.mcp.call(c[0], c[1], args).catch(() => null)
    if (r && !r.isError) { mcpTarget = c; return }
  }
  retryAt = Date.now() + 20000 // nenhum respondeu: volta a procurar daqui a 20s
}

// timers vivem só no módulo; um reload recomeça-os, o estado fica no host
let timers: { cancel: () => void }[] = []

async function set($: any, state: AvatarState, label: string) {
  if ((state as string) === 'working') state = 'thinking'
  for (const t of timers) t.cancel()
  timers = []
  await update($, mood, () => ({ state, label, ts: Date.now() }))
  relay($, state, label)
  if (state === 'done') timers.push($.clock.after(6000, () => set($, 'idle', 'À espera')))
  if (state === 'idle') timers.push($.clock.after(180000, () => set($, 'sleeping', 'Zzz…')))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'avatar', description: 'Abre o painel do avatar' })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'avatar' }, async $ => {
    const r: any = await $.ui.open({ id: PANE, title: TITLE })
    const panes: any = await $.ui.panes().catch(() => null)
    return {
      text: r?.isPlaced
        ? 'Painel do avatar aberto.'
        : `Painel não colocado: ${r?.reason ?? 'sem motivo'} | panes=${JSON.stringify(panes)}`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text, Svg } = $.ui.resolve(e) as any
    const m = await read($, mood)
    if (!Svg) return next(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={avatarSvg(m.state)} alt={`Avatar: ${m.label}`} width={64} height={64} isInteractive />
        <Text bold>{m.label}</Text>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    set($, 'thinking', 'A pensar…').catch(() => {})
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (/avatar_set_state/.test(e.tool)) return next(e)
    const [state, label] = forTool(e.tool)
    set($, state, label).catch(() => {})
    try {
      return await next(e)
    } finally {
      set($, 'thinking', 'A pensar…').catch(() => {})
    }
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    set($, 'done', 'Feito ✓').catch(() => {})
    return out
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Svg } = $.ui.resolve(e) as any
    const m = await read($, mood)
    return (
      <Box flexDirection="column" alignItems="center" gap={1}>
        {Svg ? (
          <Svg source={avatarSvg(m.state)} alt={`Avatar: ${m.label}`} width={220} isInteractive />
        ) : (
          <Text>{FACE[m.state] ?? '(•‿•)'}</Text>
        )}
        <Text bold>{m.label}</Text>
      </Box>
    )
  })
}

// fallback para superfícies sem Svg (terminal)
const FACE: Record<string, string> = {
  idle: '(•‿•)', thinking: '(・_・)…', writing: '(•̀ᴗ•́)⌨', reading: '(°_°)📄',
  running: '(ง•̀_•́)ง $', searching: '(⊙_⊙)🔍', delegating: '(•‿•)ノ(•‿•)',
  attention: '(°o°)/ !', done: '(^‿^)✨', sleeping: '(-‿-) zZ',
}

function avatarSvg(state: AvatarState): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="220" height="220" class="${state}">
<style>
#char{transform-origin:100px 170px;animation:breathe 3.2s ease-in-out infinite}
.eye{transform-box:fill-box;transform-origin:center;animation:blink 4.5s infinite}
#pupils{transition:transform .3s}
.arm{transform-box:fill-box}#armL{transform-origin:100% 20%}#armR{transform-origin:0% 20%}
.prop,#happy,#sleepy{opacity:0}
.thinking #char{animation:bob 1.6s ease-in-out infinite}
.thinking #pupils{transform:translate(4px,-5px)}
.thinking #thought{opacity:1}
.thinking #thought circle{animation:dots 1.2s infinite}
.thinking #thought circle:nth-child(2){animation-delay:.2s}
.thinking #thought circle:nth-child(3){animation-delay:.4s}
.writing #laptop{opacity:1}.writing #pupils{transform:translate(0,5px)}
.writing #armL{animation:typeL .18s ease-in-out infinite alternate}
.writing #armR{animation:typeR .18s ease-in-out infinite alternate}
.writing #char{animation:bob .9s ease-in-out infinite}
.reading #paper{opacity:1}.reading #pupils{animation:scan 1.4s ease-in-out infinite}
.running #terminal{opacity:1}.running #char{animation:hop .5s ease-in-out infinite}
.running #cursor{animation:cur .6s steps(1) infinite}
.searching #glass{opacity:1;animation:orbit 2s linear infinite;transform-origin:100px 110px}
.searching #pupils{animation:scan 1s ease-in-out infinite}
.delegating #mini{opacity:1;animation:hop .7s ease-in-out infinite}
.delegating #pupils{transform:translate(-6px,2px)}
.attention #alert{opacity:1;animation:pulse .6s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
.attention #armR{animation:wave .35s ease-in-out infinite alternate}
.attention #char{animation:hop .8s ease-in-out infinite}
.done #eyes{opacity:0}.done #happy{opacity:1}.done #spark{opacity:1}
.done #spark path{animation:tw 1s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.done #char{animation:jump .6s ease-out 2,breathe 3.2s ease-in-out 1.2s infinite}
.done #armL{transform:rotate(35deg)}.done #armR{transform:rotate(-35deg)}
.sleeping #eyes{opacity:0}.sleeping #sleepy{opacity:1}.sleeping #zzz{opacity:1}
.sleeping #zzz text{animation:zz 2.4s ease-in infinite}
.sleeping #zzz text:nth-child(2){animation-delay:.8s}
.sleeping #zzz text:nth-child(3){animation-delay:1.6s}
.sleeping #char{animation:breathe 5s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes hop{0%,100%{transform:translateY(0) scale(1,1)}40%{transform:translateY(-14px) scale(.96,1.04)}80%{transform:translateY(0) scale(1.05,.95)}}
@keyframes jump{0%{transform:translateY(0)}40%{transform:translateY(-26px) rotate(-4deg)}100%{transform:translateY(0)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes dots{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes typeL{from{transform:rotate(-8deg)}to{transform:rotate(10deg)}}
@keyframes typeR{from{transform:rotate(10deg)}to{transform:rotate(-8deg)}}
@keyframes scan{0%,100%{transform:translate(-6px,3px)}50%{transform:translate(6px,3px)}}
@keyframes cur{50%{opacity:0}}
@keyframes orbit{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.12)}}
@keyframes wave{from{transform:rotate(-60deg)}to{transform:rotate(-110deg)}}
@keyframes tw{0%,100%{transform:scale(.6);opacity:.5}50%{transform:scale(1.2);opacity:1}}
@keyframes zz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(14px,-26px)}}
</style>
<ellipse cx="100" cy="182" rx="46" ry="7" fill="#000" opacity=".15"/>
<g id="glass" class="prop"><circle cx="170" cy="60" r="11" fill="none" stroke="#8a7f74" stroke-width="4"/><line x1="178" y1="68" x2="188" y2="78" stroke="#8a7f74" stroke-width="5" stroke-linecap="round"/></g>
<g id="char">
<path id="armL" class="arm" d="M52 118 q-18 6 -20 24" stroke="#b85c3e" stroke-width="11" stroke-linecap="round" fill="none"/>
<path id="armR" class="arm" d="M148 118 q18 6 20 24" stroke="#b85c3e" stroke-width="11" stroke-linecap="round" fill="none"/>
<path d="M100 40 C150 40 160 80 160 118 C160 160 135 176 100 176 C65 176 40 160 40 118 C40 80 50 40 100 40 Z" fill="#d97757"/>
<path d="M70 60 C80 50 95 48 108 50" stroke="#fff" stroke-opacity=".35" stroke-width="6" stroke-linecap="round" fill="none"/>
<ellipse cx="66" cy="124" rx="9" ry="5" fill="#f2a68b" opacity=".7"/><ellipse cx="134" cy="124" rx="9" ry="5" fill="#f2a68b" opacity=".7"/>
<g id="eyes"><ellipse class="eye" cx="78" cy="102" rx="12" ry="14" fill="#fff"/><ellipse class="eye" cx="122" cy="102" rx="12" ry="14" fill="#fff"/>
<g id="pupils"><circle cx="79" cy="104" r="6" fill="#2b2420"/><circle cx="123" cy="104" r="6" fill="#2b2420"/><circle cx="81" cy="101" r="2" fill="#fff"/><circle cx="125" cy="101" r="2" fill="#fff"/></g></g>
<g id="happy" stroke="#2b2420" stroke-width="4" stroke-linecap="round" fill="none"><path d="M68 106 q10 -12 20 0"/><path d="M112 106 q10 -12 20 0"/></g>
<g id="sleepy" stroke="#2b2420" stroke-width="4" stroke-linecap="round" fill="none"><path d="M68 104 q10 7 20 0"/><path d="M112 104 q10 7 20 0"/></g>
<path d="M92 134 q8 7 16 0" stroke="#2b2420" stroke-width="3.5" stroke-linecap="round" fill="none"/>
<g id="laptop" class="prop"><rect x="62" y="140" width="76" height="40" rx="4" fill="#3a332d"/><rect x="68" y="145" width="64" height="28" rx="2" fill="#7fd1a0" opacity=".85"/><rect x="56" y="178" width="88" height="6" rx="3" fill="#2b2420"/></g>
<g id="paper" class="prop"><rect x="70" y="138" width="60" height="42" rx="3" fill="#fff" stroke="#e6dccd"/><g stroke="#bbb" stroke-width="3" stroke-linecap="round"><line x1="78" y1="148" x2="122" y2="148"/><line x1="78" y1="157" x2="116" y2="157"/><line x1="78" y1="166" x2="120" y2="166"/></g></g>
<g id="terminal" class="prop"><rect x="64" y="140" width="72" height="40" rx="4" fill="#1b1815"/><text x="72" y="164" fill="#7fd1a0" font-family="monospace" font-size="14" font-weight="700">$</text><rect id="cursor" x="86" y="153" width="8" height="13" fill="#7fd1a0"/></g>
</g>
<g id="mini" class="prop"><path d="M170 140 c14 0 17 11 17 22 c0 12 -7 16 -17 16 c-10 0 -17 -4 -17 -16 c0 -11 3 -22 17 -22 z" fill="#d97757"/><circle cx="165" cy="158" r="3" fill="#2b2420"/><circle cx="176" cy="158" r="3" fill="#2b2420"/></g>
<g id="thought" class="prop" fill="#8a7f74"><circle cx="140" cy="30" r="5"/><circle cx="155" cy="24" r="5"/><circle cx="170" cy="18" r="5"/></g>
<g id="alert" class="prop"><circle cx="160" cy="34" r="16" fill="#e5484d"/><text x="160" y="41" text-anchor="middle" fill="#fff" font-size="20" font-weight="800" font-family="sans-serif">!</text></g>
<g id="spark" class="prop" fill="#f2c14e"><path d="M40 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z"/><path d="M160 30 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z"/><path d="M172 92 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z"/></g>
<g id="zzz" class="prop" fill="#8a7f74" font-weight="800" font-family="sans-serif"><text x="140" y="50" font-size="16">z</text><text x="150" y="40" font-size="20">z</text><text x="162" y="28" font-size="24">Z</text></g>
</svg>`
}
