const DEFAULT_CHANNELS = ['msedge', 'chrome'];

function cleanList(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function patchChromium(playwright) {
  const chromium = playwright?.chromium;
  if (!chromium || chromium.__mesaFallbackPatched) return;

  const originalLaunch = chromium.launch.bind(chromium);
  const configuredExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || process.env.EXTRACAO_CHROMIUM_EXECUTABLE
    || '';
  const configuredChannel = process.env.EXTRACAO_BROWSER_CHANNEL
    || process.env.PLAYWRIGHT_CHANNEL
    || '';

  chromium.launch = async function launchWithFallback(options = {}) {
    if (configuredExecutable && !options.executablePath && !options.channel) {
      return originalLaunch({ ...options, executablePath: configuredExecutable });
    }
    if (configuredChannel && !options.executablePath && !options.channel) {
      return originalLaunch({ ...options, channel: configuredChannel });
    }

    try {
      return await originalLaunch(options);
    } catch (firstError) {
      if (options.executablePath || options.channel) throw firstError;

      const channels = cleanList(configuredChannel).length
        ? cleanList(configuredChannel)
        : DEFAULT_CHANNELS;
      const errors = [firstError?.message || String(firstError)];

      for (const channel of channels) {
        try {
          console.log(`[Playwright] Chromium padrao indisponivel. Tentando canal instalado: ${channel}`);
          return await originalLaunch({ ...options, channel });
        } catch (fallbackError) {
          errors.push(`${channel}: ${fallbackError?.message || String(fallbackError)}`);
        }
      }

      throw new Error(
        'Nao foi possivel iniciar o navegador do Playwright. ' +
        'Instale Microsoft Edge/Google Chrome, configure EXTRACAO_BROWSER_CHANNEL=msedge, ' +
        'ou execute "npx playwright install chromium". Detalhes: ' + errors.join(' | ')
      );
    }
  };

  Object.defineProperty(chromium, '__mesaFallbackPatched', { value: true });
}

try {
  patchChromium(require('playwright'));
} catch (_) {
  // O script pode nao usar Playwright ou resolver o pacote por outro caminho.
}
