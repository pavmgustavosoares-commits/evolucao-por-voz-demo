// Worker isolado para inferência de linguagem local
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

// Desativa verificações remotas repetitivas após o primeiro download
env.allowLocalModels = false;
env.useBrowserCache = true;

let generator = null;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'LOAD_AI') {
    try {
      self.postMessage({ type: 'STATUS', message: 'Iniciando carregamento do Qwen2.5-0.5B...' });

      // Verificação de suporte a WebGPU dentro do Worker
      let device = 'wasm';
      let dtype = 'q8';

      if (navigator.gpu) {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            device = 'webgpu';
            // Em mobile, q4 comum é muito mais estável que q4f16 contra crashes de shader
            dtype = adapter.features.has('shader-f16') ? 'q4f16' : 'q4';
          }
        } catch (gpuErr) {
          console.warn('WebGPU não pôde ser ativado no worker, utilizando WASM:', gpuErr);
          device = 'wasm';
          dtype = 'q8';
        }
      }

      self.postMessage({ 
        type: 'STATUS', 
        message: `Carregando pesos (${device.toUpperCase()} - ${dtype})... Isso pode levar 1 a 2 min.` 
      });

      generator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
        device: device,
        dtype: dtype,
        progress_callback: (progress) => {
          if (progress.status === 'progress') {
            self.postMessage({
              type: 'PROGRESS',
              file: progress.file,
              progress: Math.round((progress.loaded / progress.total) * 100) || 0
            });
          }
        }
      });

      self.postMessage({ type: 'LOADED', message: `IA Generativa pronta (${device.toUpperCase()}).` });
    } catch (err) {
      self.postMessage({ 
        type: 'ERROR', 
        message: `Falha no carregamento: ${err.message || 'Memória insuficiente no dispositivo.'}` 
      });
    }
  }

  if (type === 'ORGANIZE_TEXT') {
    if (!generator) {
      self.postMessage({ type: 'ERROR', message: 'Modelo de IA não está carregado.' });
      return;
    }

    try {
      self.postMessage({ type: 'STATUS', message: 'Organizando evolução clínica com IA local...' });

      const prompt = payload.prompt;
      const messages = [
        {
          role: 'system',
          content: 'Você é um assistente especializado em evolução terapêutica em saúde e autismo. Organize o relato nas seções pedidas com clareza clínica e gramática formal. Nunca invente dados não mencionados.'
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const output = await generator(messages, {
        max_new_tokens: 380,
        temperature: 0.2,
        do_sample: false,
        top_k: 1
      });

      const responseText = output[0]?.generated_text?.at(-1)?.content || '';
      self.postMessage({ type: 'GENERATED', result: responseText });
    } catch (err) {
      self.postMessage({ type: 'ERROR', message: `Erro ao gerar texto: ${err.message}` });
    }
  }

  if (type === 'DISPOSE') {
    generator = null;
    self.postMessage({ type: 'STATUS', message: 'Recursos de IA liberados da memória.' });
    self.close(); // Encerra o worker para liberar a memória física no SO
  }
};