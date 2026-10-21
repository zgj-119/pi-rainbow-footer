import rainbowFooterExtension from '../rainbow-footer.js';

// Synthetic data shared by the runtime tests and the rendered README preview.
export function createHarness(mode = 'tui') {
  const handlers = new Map<string, (...args: any[]) => any>();
  const state = { component: undefined as any, requests: 0, unsubscribes: 0, footerCalls: 0 };
  const tui = { requestRender() { state.requests++; } };
  const footerData = {
    getGitBranch: () => 'main',
    getAvailableProviderCount: () => 2,
    onBranchChange: () => () => { state.unsubscribes++; },
  };
  const context: any = {
    mode,
    model: { id: 'gpt-demo', provider: 'openai-codex', reasoning: true, contextWindow: 200_000 },
    modelRegistry: { isUsingOAuth: () => true },
    getContextUsage: () => ({ percent: 12.5, contextWindow: 200_000 }),
    sessionManager: {
      getCwd: () => '/demo/project',
      getSessionName: () => 'Rainbow demo',
      getEntries: () => [{
        type: 'message',
        message: {
          role: 'assistant',
          usage: { input: 1200, output: 400, cacheRead: 8800, cacheWrite: 0, cost: { total: 0.012 } },
        },
      }],
    },
    ui: {
      setFooter(factory: any) {
        state.footerCalls++;
        state.component?.dispose();
        state.component = factory?.(tui, {}, footerData);
      },
    },
  };
  const api: any = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getThinkingLevel: () => 'high',
  };
  rainbowFooterExtension(api);
  return {
    context,
    state,
    handlers,
    emit: (event: string, data: any = {}) => handlers.get(event)?.(data, context),
    start() { handlers.get('session_start')?.({}, context); },
    stop() { handlers.get('session_shutdown')?.({}, context); state.component?.dispose(); },
  };
}

export const demoHeaders = {
  'X-Codex-Primary-Used-Percent': '12',
  'x-codex-primary-window-minutes': '300',
  'x-codex-primary-reset-after-seconds': '3600',
  'x-codex-secondary-used-percent': '40',
  'x-codex-secondary-window-minutes': '10080',
  'x-codex-secondary-reset-after-seconds': '86400',
};

export const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');
