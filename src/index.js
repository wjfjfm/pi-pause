export default function pause(pi) {
  pi.registerCommand('pause', {
    description: 'Pause after the current response and tools finish',
    handler: async (_args, ctx) => {
      if (typeof ctx.requestPause !== 'function') {
        ctx.ui.notify('pi-pause requires the Pi 1.3.0 core patch and a restart.', 'error');
        return;
      }
      ctx.ui.notify(ctx.requestPause() ? 'Pausing after the current turn…' : 'Already idle.', 'info');
    },
  });
}
