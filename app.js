const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL_ID = 'onnx-community/whisper-tiny';
const TEXT_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

const $ = (id) => document.getElementById(id);
const fields = ['objective', 'activity', 'response', 'supports', 'continuity', 'free'];
let transcriber = null;
let textGenerator = null;
let recorder = null;
let mediaStream = null;
let recordedChunks = [];
let recordedBlob = null;
let isRecording = false;
let timerInterval = null;
let startedAt = 0;
let recordingTimeout = null;
let modelLoadPromise = null;
let aiModelLoadPromise = null;
let lastGenerated = '';

const friendlyFieldNames = {
  objective: 'Objetivo terapêutico',
  activity: 'Atividade e estratégias',
  response: 'Resposta observada',
  supports: 'Apoios necessários',
  continuity: 'Continuidade / próximos passos',
  free: 'Relato original para organização'
};

function setStatus(id, message, kind = '') {
  const node = $(id);
  node.textContent = message;
  node.dataset.kind = kind;
}

function formatTimer(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function setModelProgress(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  $('modelProgress').style.width = `${percent}%`;
}

function setAiModelProgress(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  $('aiModelProgress').style.width = `${percent}%`;
}

async function loadTextGenerator() {
  if (textGenerator) return textGenerator;
  if (aiModelLoadPromise) return aiModelLoadPromise;

  $('loadAiBtn').disabled = true;
  $('loadAiLabel').textContent = 'Carregando modelo…';
  setStatus('aiModelStatus', 'Preparando o modelo generativo local. O download é grande; mantenha o navegador aberto e use Wi-Fi.');
  setAiModelProgress(1);
  let selectedWebGPU = false;

  aiModelLoadPromise = (async () => {
    try {
      const { pipeline, env } = await import(TRANSFORMERS_CDN);
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;

      let useWebGPU = false;
      const forceCpu = $('loadAiBtn').dataset.forceCpu === 'true';
      if (!forceCpu && 'gpu' in navigator && navigator.gpu?.requestAdapter) {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          useWebGPU = Boolean(adapter);
        } catch (_) {
          useWebGPU = false;
        }
      }

      selectedWebGPU = useWebGPU;
      const modelOptions = useWebGPU
        ? { device: 'webgpu', dtype: 'q4f16' }
        : { device: 'wasm', dtype: 'q8' };

      setStatus('aiModelStatus', useWebGPU
        ? 'WebGPU detectado. Baixando e preparando o modelo quantizado para execução no dispositivo…'
        : 'WebGPU não detectado. Tentando executar pelo processador; isso pode ser mais lento e usar mais memória…');

      textGenerator = await pipeline('text-generation', TEXT_MODEL_ID, {
        ...modelOptions,
        progress_callback: (info) => {
          if (!info || typeof info !== 'object') return;
          const status = info.status || '';
          const file = info.file || info.name || '';
          if (Number.isFinite(info.progress)) {
            setAiModelProgress(info.progress);
            setStatus('aiModelStatus', status === 'progress'
              ? `Baixando componente da IA${file ? `: ${file}` : ''} (${Math.round(info.progress)}%).`
              : status === 'done' ? `Componente preparado${file ? `: ${file}` : ''}.` : `Preparando IA: ${status || 'carregando arquivos locais'}…`);
          } else if (status) {
            setStatus('aiModelStatus', `${status}${file ? `: ${file}` : ''}…`);
          }
        }
      });

      setAiModelProgress(100);
      $('loadAiLabel').textContent = 'IA generativa pronta';
      $('loadAiBtn').dataset.forceCpu = 'false';
      $('organizeAiBtn').disabled = false;
      setStatus('aiModelStatus', `Modelo de IA carregado (${useWebGPU ? 'WebGPU' : 'processador'}). A organização do texto será executada neste navegador.`, 'success');
      setStatus('aiStatus', 'IA pronta. Preencha ou transcreva o relato e toque em “Organizar relato com IA local”.', 'success');
      return textGenerator;
    } catch (error) {
      textGenerator = null;
      aiModelLoadPromise = null;
      setAiModelProgress(0);
      $('loadAiBtn').disabled = false;
      if (selectedWebGPU) {
        $('loadAiBtn').dataset.forceCpu = 'true';
        $('loadAiLabel').textContent = 'Tentar modo CPU (mais lento)';
        setStatus('aiModelStatus', `O carregamento pelo acelerador gráfico falhou. Toque novamente para tentar CPU/WASM; isso pode baixar outra variante de cerca de 512 MB. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
      } else {
        $('loadAiLabel').textContent = 'Tentar carregar IA novamente';
        setStatus('aiModelStatus', `Não foi possível carregar a IA local. Verifique conexão, memória e espaço livre. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
      }
      throw error;
    } finally {
      if (textGenerator) $('loadAiBtn').disabled = true;
    }
  })();
  return aiModelLoadPromise;
}

function collectSourceForAI() {
  const sections = [
    ['objective', 'Objetivo informado'],
    ['activity', 'Atividade e estratégias informadas'],
    ['response', 'Resposta observada informada'],
    ['supports', 'Apoios informados'],
    ['continuity', 'Continuidade informada'],
    ['free', 'Relato livre original']
  ];
  return sections
    .map(([id, label]) => ({ label, value: $(id).value.trim() }))
    .filter((item) => item.value)
    .map((item) => `${item.label}:\n${item.value}`)
    .join('\n\n');
}

function getGeneratedMessage(result) {
  const generated = result?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return typeof last?.content === 'string' ? last.content.trim() : '';
  }
  if (typeof generated === 'string') return generated.trim();
  if (typeof result?.[0]?.text === 'string') return result[0].text.trim();
  return '';
}

function parseStructuredJSON(generatedText) {
  const firstBrace = generatedText.indexOf('{');
  const lastBrace = generatedText.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('A IA não retornou um objeto estruturado válido. Tente novamente ou distribua o relato manualmente.');
  }

  let parsed;
  try {
    parsed = JSON.parse(generatedText.slice(firstBrace, lastBrace + 1));
  } catch (_) {
    throw new Error('A resposta da IA veio em formato inválido. Nenhum campo foi alterado; tente novamente.');
  }

  const keyAliases = {
    objective: ['objetivo', 'objective'],
    activity: ['atividade', 'activity'],
    response: ['resposta_observada', 'resposta', 'response'],
    supports: ['apoios', 'apoios_necessarios', 'supports'],
    continuity: ['continuidade', 'proximos_passos', 'continuity']
  };
  const normalized = {};
  for (const [key, aliases] of Object.entries(keyAliases)) {
    const foundKey = aliases.find((alias) => Object.prototype.hasOwnProperty.call(parsed, alias));
    if (!foundKey || typeof parsed[foundKey] !== 'string') {
      throw new Error('A resposta da IA não contém todos os campos esperados. Nenhum campo foi alterado; tente novamente.');
    }
    normalized[key] = parsed[foundKey].trim();
  }
  return normalized;
}

async function organizeWithAI() {
  if (!textGenerator) {
    setStatus('aiStatus', 'Carregue o modelo de IA generativa antes de organizar o relato.', 'error');
    return;
  }

  const source = collectSourceForAI();
  if (!source) {
    setStatus('aiStatus', 'Fale, transcreva ou preencha pelo menos um campo antes de organizar.', 'error');
    return;
  }

  const originalFields = {
    objective: $('objective').value.trim(),
    activity: $('activity').value.trim(),
    response: $('response').value.trim(),
    supports: $('supports').value.trim(),
    continuity: $('continuity').value.trim()
  };

  const messages = [
    {
      role: 'system',
      content: `Você é um assistente de redação de evoluções de atendimento multidisciplinar em português brasileiro. Sua única tarefa é organizar e aprimorar a redação do conteúdo informado pelo profissional. Não faça avaliação clínica, diagnóstico, inferência, recomendação nem decisão terapêutica. REGRAS OBRIGATÓRIAS: (1) use apenas fatos presentes no conteúdo de entrada; (2) não invente comportamentos, quantidades, objetivos, intervenções, nível de ajuda, resultados ou próximos passos; (3) preserve números, frequência, contexto e o grau de certeza do relato; (4) se uma informação não foi fornecida, devolva uma string vazia para aquele campo; (5) não transforme impressões vagas em fatos objetivos; (6) não repita a mesma informação em vários campos sem necessidade; (7) escreva de forma concisa, profissional, respeitosa e não infantilizante; (8) não inclua nome ou identificação que não esteja no conteúdo; (9) responda SOMENTE com um objeto JSON válido, sem markdown e sem comentários, com exatamente estas chaves de texto: objetivo, atividade, resposta_observada, apoios, continuidade.`
    },
    {
      role: 'user',
      content: `Organize o conteúdo abaixo em uma evolução terapêutica. Não complete lacunas com suposições. Quando não houver dados para um campo, use uma string vazia.\n\n${source}\n\nRetorne exclusivamente este formato JSON:\n{"objetivo":"","atividade":"","resposta_observada":"","apoios":"","continuidade":""}`
    }
  ];

  $('organizeAiBtn').disabled = true;
  $('organizeAiBtn').textContent = 'Organizando…';
  setStatus('aiStatus', 'A IA está organizando o relato no próprio navegador. Em celulares, isso pode levar algum tempo…');

  try {
    const result = await textGenerator(messages, {
      max_new_tokens: 400,
      do_sample: false,
      repetition_penalty: 1.05
    });
    const generatedText = getGeneratedMessage(result);
    if (!generatedText) throw new Error('A IA não retornou texto. Tente novamente.');
    const structured = parseStructuredJSON(generatedText);

    // Preserve manually entered content when the small model unexpectedly returns an empty value.
    for (const key of Object.keys(originalFields)) {
      const finalValue = structured[key] || originalFields[key];
      $(key).value = finalValue;
      $(key).dispatchEvent(new Event('input', { bubbles: true }));
    }

    const finalText = buildEvolution();
    if (!finalText) throw new Error('A IA respondeu, mas não foi possível montar a evolução. Confira os campos e tente novamente.');
    setStatus('aiStatus', 'Rascunho organizado. Revise cada campo e o texto final: modelos locais pequenos podem errar ou omitir informações.', 'success');
  } catch (error) {
    setStatus('aiStatus', `Não foi possível organizar o relato com IA. ${error?.message || 'Tente novamente.'}`, 'error');
  } finally {
    $('organizeAiBtn').disabled = !textGenerator;
    $('organizeAiBtn').textContent = 'Organizar relato com IA local';
  }
}

async function loadTranscriber() {
  if (transcriber) return transcriber;
  if (modelLoadPromise) return modelLoadPromise;

  $('loadModelBtn').disabled = true;
  $('loadModelLabel').textContent = 'Carregando…';
  setStatus('modelStatus', 'Conectando à biblioteca e preparando o modelo local…');
  setModelProgress(2);

  modelLoadPromise = (async () => {
    try {
      const { pipeline, env } = await import(TRANSFORMERS_CDN);
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;

      transcriber = await pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        {
          dtype: 'q8',
          progress_callback: (info) => {
            if (!info || typeof info !== 'object') return;
            const status = info.status || '';
            const file = info.file || info.name || '';
            if (Number.isFinite(info.progress)) {
              setModelProgress(info.progress);
              setStatus('modelStatus', status === 'progress'
                ? `Baixando componente do modelo${file ? `: ${file}` : ''} (${Math.round(info.progress)}%).`
                : status === 'done' ? `Componente preparado${file ? `: ${file}` : ''}.` : `Preparando: ${status || 'carregando arquivos locais'}…`);
            } else if (status) {
              setStatus('modelStatus', `${status}${file ? `: ${file}` : ''}…`);
            }
          }
        }
      );
      setModelProgress(100);
      setStatus('modelStatus', 'Modelo carregado. A transcrição será executada no navegador.', 'success');
      $('loadModelLabel').textContent = 'Modelo pronto';
      $('recordBtn').disabled = false;
      setStatus('recordStatus', 'Pronto. Escolha o campo e toque em “Gravar relato”.', 'success');
      return transcriber;
    } catch (error) {
      transcriber = null;
      modelLoadPromise = null;
      setModelProgress(0);
      $('loadModelBtn').disabled = false;
      $('loadModelLabel').textContent = 'Tentar carregar novamente';
      setStatus('modelStatus', `Não foi possível carregar o modelo. Confira a conexão e o espaço livre e tente novamente. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
      throw error;
    } finally {
      if (transcriber) $('loadModelBtn').disabled = true;
    }
  })();
  return modelLoadPromise;
}

function supportedMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function startRecording() {
  if (!transcriber) {
    setStatus('recordStatus', 'Carregue o modelo antes de gravar.', 'error');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus('recordStatus', 'Este navegador não oferece gravação de áudio compatível. Atualize o navegador ou use a digitação manual nos campos.', 'error');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    recordedChunks = [];
    recordedBlob = null;
    const mimeType = supportedMimeType();
    recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      recordedBlob = new Blob(recordedChunks, { type: recorder?.mimeType || 'audio/webm' });
      recordedChunks = [];
      stopTracks();
      isRecording = false;
      clearInterval(timerInterval);
      clearTimeout(recordingTimeout);
      $('recordBtn').disabled = false;
      $('recordBtn').classList.remove('recording');
      $('recordBtn').innerHTML = '<span aria-hidden="true">●</span> Gravar novamente';
      $('stopBtn').disabled = true;
      $('transcribeBtn').disabled = !recordedBlob || recordedBlob.size === 0;
      $('recordTitle').textContent = 'Relato gravado temporariamente';
      $('recordDescription').textContent = 'O áudio permanece apenas na memória da página até a transcrição ou limpeza.';
      $('recordIcon').textContent = '✓';
      $('recordIcon').parentElement.classList.remove('active');
      setStatus('recordStatus', recordedBlob?.size ? 'Áudio pronto para transcrever no dispositivo.' : 'Nenhum áudio foi capturado. Tente novamente.', recordedBlob?.size ? 'success' : 'error');
    });

    recorder.start(500);
    isRecording = true;
    startedAt = Date.now();
    $('recordBtn').disabled = true;
    $('recordBtn').classList.add('recording');
    $('recordBtn').innerHTML = '<span aria-hidden="true">●</span> Gravando…';
    $('stopBtn').disabled = false;
    $('transcribeBtn').disabled = true;
    $('targetField').disabled = true;
    $('recordTitle').textContent = 'Gravação em andamento';
    $('recordDescription').textContent = 'Fale em ambiente tranquilo. Toque em “Parar” quando terminar.';
    $('recordIcon').textContent = '●';
    $('recordIcon').parentElement.classList.add('active');
    setStatus('recordStatus', 'Gravando somente após sua ação. Limite desta demonstração: 3 minutos.');
    $('recordTimer').textContent = '00:00';
    timerInterval = window.setInterval(() => {
      $('recordTimer').textContent = formatTimer(Date.now() - startedAt);
    }, 250);
    recordingTimeout = window.setTimeout(() => {
      if (isRecording) stopRecording();
    }, 180000);
  } catch (error) {
    stopTracks();
    setStatus('recordStatus', `Não foi possível acessar o microfone. Confira a permissão do navegador. ${error?.message || ''}`, 'error');
  }
}

function stopTracks() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
}

function stopRecording() {
  if (recorder && isRecording && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (error) { console.warn('Não foi possível parar o gravador.', error); }
  }
  stopTracks();
}

function resampleTo16k(audioBuffer) {
  const targetRate = 16000;
  const inputRate = audioBuffer.sampleRate;
  const outputLength = Math.max(1, Math.floor(audioBuffer.duration * targetRate));
  const numberOfChannels = audioBuffer.numberOfChannels;
  const channels = [];
  for (let channel = 0; channel < numberOfChannels; channel++) channels.push(audioBuffer.getChannelData(channel));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / targetRate;

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const blend = position - index;
    let sample = 0;
    for (const channel of channels) {
      const left = channel[index] || 0;
      const right = channel[index + 1] ?? left;
      sample += left + (right - left) * blend;
    }
    output[i] = sample / channels.length;
  }
  return output;
}

async function transcribeRecording() {
  if (!transcriber) {
    setStatus('recordStatus', 'O modelo ainda não está pronto.', 'error');
    return;
  }
  if (!recordedBlob || recordedBlob.size === 0) {
    setStatus('recordStatus', 'Grave um relato antes de transcrever.', 'error');
    return;
  }

  $('transcribeBtn').disabled = true;
  $('recordBtn').disabled = true;
  $('targetField').disabled = true;
  $('transcribeBtn').textContent = 'Transcrevendo…';
  setStatus('recordStatus', 'Convertendo o áudio e transcrevendo no dispositivo. O tempo varia conforme o celular…');

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador não oferece decodificação de áudio compatível.');
    const context = new AudioContextClass();
    try {
      const audioData = await recordedBlob.arrayBuffer();
      const decoded = await context.decodeAudioData(audioData.slice(0));
      if (decoded.duration > 180) throw new Error('O áudio ultrapassou o limite de três minutos.');
      const samples = resampleTo16k(decoded);
      const result = await transcriber(samples, {
        language: 'portuguese',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      const transcript = (typeof result === 'string' ? result : result?.text || '').trim();
      if (!transcript) throw new Error('Nenhuma fala foi reconhecida. Tente falar mais perto do microfone.');
      const target = $( $('targetField').value );
      const existing = target.value.trim();
      target.value = existing ? `${existing}${/[.!?]$/.test(existing) ? ' ' : '. '}${transcript}` : transcript;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      recordedBlob = null;
      recordedChunks = [];
      $('recordTimer').textContent = '00:00';
      $('recordTitle').textContent = 'Transcrição inserida';
      $('recordDescription').textContent = `Texto adicionado a “${friendlyFieldNames[$('targetField').value]}”. Revise o conteúdo.`;
      setStatus('recordStatus', 'Transcrição concluída localmente. Revise nomes técnicos, pontuação e conteúdo antes de usar.', 'success');
    } finally {
      await context.close().catch(() => {});
    }
  } catch (error) {
    setStatus('recordStatus', `Não foi possível transcrever este áudio. ${error?.message || 'Tente novamente.'}`, 'error');
  } finally {
    recordedBlob = null;
    recordedChunks = [];
    $('transcribeBtn').disabled = true;
    $('transcribeBtn').textContent = 'Transcrever no dispositivo';
    $('recordBtn').disabled = !transcriber;
    $('targetField').disabled = false;
    if ($('recordBtn').classList.contains('recording')) $('recordBtn').classList.remove('recording');
  }
}

function dateForDisplay(value) {
  if (!value) return '';
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function buildEvolution() {
  const specialty = $('specialty').value.trim();
  const modality = $('modality').value.trim();
  const date = dateForDisplay($('sessionDate').value);
  const content = [];
  content.push('EVOLUÇÃO DE ATENDIMENTO');
  if (date) content.push(`Data: ${date}`);
  if (specialty) content.push(`Especialidade: ${specialty}`);
  if (modality) content.push(`Modalidade: ${modality}`);
  content.push('');

  const sections = [
    ['objective', 'Objetivo terapêutico'],
    ['activity', 'Atividade e estratégias'],
    ['response', 'Resposta observada'],
    ['supports', 'Apoios necessários'],
    ['continuity', 'Continuidade / próximos passos']
  ];
  const populated = sections.filter(([id]) => $(id).value.trim());
  if (populated.length === 0) {
    setStatus('copyStatus', 'Preencha pelo menos um campo antes de montar a evolução.', 'error');
    return '';
  }
  for (const [id, label] of populated) {
    content.push(`${label}:`);
    content.push($(id).value.trim());
    content.push('');
  }
  content.push('Registro organizado a partir do relato do profissional; revisar e validar antes de inserir no prontuário.');
  lastGenerated = content.join('\n').trim();
  $('outputText').value = lastGenerated;
  $('copyBtn').disabled = false;
  setStatus('copyStatus', 'Texto montado. Revise antes de copiar.', 'success');
  return lastGenerated;
}

async function copyOutput() {
  const value = $('outputText').value.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus('copyStatus', 'Texto copiado para a área de transferência do aparelho.', 'success');
  } catch (error) {
    $('outputText').focus();
    $('outputText').select();
    setStatus('copyStatus', 'Não foi possível copiar automaticamente. O texto foi selecionado para você copiar manualmente.');
  }
}

function clearAll() {
  if (isRecording) stopRecording();
  clearInterval(timerInterval);
  clearTimeout(recordingTimeout);
  stopTracks();
  recordedChunks = [];
  recordedBlob = null;
  for (const id of fields) $(id).value = '';
  $('outputText').value = '';
  $('recordTimer').textContent = '00:00';
  $('recordTitle').textContent = 'Pronto para gravar';
  $('recordDescription').textContent = 'O microfone só ficará ativo depois de você tocar em “Gravar relato”.';
  $('recordIcon').textContent = '●';
  $('recordIcon').parentElement.classList.remove('active');
  $('recordBtn').classList.remove('recording');
  $('recordBtn').innerHTML = '<span aria-hidden="true">●</span> Gravar relato';
  $('recordBtn').disabled = !transcriber;
  $('stopBtn').disabled = true;
  $('transcribeBtn').disabled = true;
  $('transcribeBtn').textContent = 'Transcrever no dispositivo';
  $('targetField').disabled = false;
  $('copyBtn').disabled = true;
  lastGenerated = '';
  setStatus('recordStatus', transcriber ? 'Campos limpos. Pronto para um novo relato.' : 'Carregue o modelo para habilitar a gravação.');
  setStatus('copyStatus', '');
}

function init() {
  const today = new Date();
  $('sessionDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  $('loadModelBtn').addEventListener('click', () => loadTranscriber().catch(() => {}));
  $('loadAiBtn').addEventListener('click', () => loadTextGenerator().catch(() => {}));
  $('organizeAiBtn').addEventListener('click', organizeWithAI);
  $('recordBtn').addEventListener('click', startRecording);
  $('stopBtn').addEventListener('click', stopRecording);
  $('transcribeBtn').addEventListener('click', transcribeRecording);
  $('generateBtn').addEventListener('click', buildEvolution);
  $('copyBtn').addEventListener('click', copyOutput);
  $('clearBtn').addEventListener('click', clearAll);

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus('recordStatus', 'Este navegador pode não ser compatível com gravação de áudio. Os campos também aceitam digitação manual.');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording) stopRecording();
  });
  window.addEventListener('pagehide', () => {
    if (isRecording) stopRecording();
    stopTracks();
  });
}

init();
