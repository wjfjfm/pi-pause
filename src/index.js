export default function pause(pi) {
  pi.registerCommand('pause', {
    description: 'Pause after the current response and tools finish',
    handler: async (_args, ctx) => {
      if (typeof ctx.requestPause !== 'function') {
        ctx.ui.notify('pi-pause core patch is missing. Apply it to the current Pi installation, then restart (not /reload).', 'error');
        return;
      }
      ctx.ui.notify(ctx.requestPause() ? 'Pausing after the current turn…' : 'Already idle.', 'info');
    },
  });
}
