// Worker da IA generativa. Roda o Transformers.js fora da thread principal.
// Ao trocar de modelo, o app chama worker.terminate(), o que devolve a memória (heap WASM) ao sistema.
let generator = null;

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      const { pipeline, env } = await import(data.cdn);
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      generator = await pipeline('text-generation', data.modelId, {
        device: data.device,
        dtype: data.dtype,
        progress_callback: (info) => self.postMessage({ type: 'progress', info })
      });
      self.postMessage({ id, type: 'loaded', result: true });
    } else if (type === 'generate') {
      if (!generator) throw new Error('Modelo não carregado no worker.');
      const result = await generator(data.messages, data.options);
      self.postMessage({ id, type: 'result', result });
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  }
};
