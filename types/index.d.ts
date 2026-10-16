export type AvatarState =
  | 'idle' | 'thinking' | 'writing' | 'reading' | 'running'
  | 'searching' | 'delegating' | 'attention' | 'done' | 'sleeping'

export type Mood = { state: AvatarState; label: string; ts: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-avatar': { mood: Mood }
  }
}
