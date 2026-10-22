// Controlador de Interface, Reconhecimento de Fala e Orquestração

let aiWorker = null;
let isAiLoaded = false;
let mediaRecorder = null;
let audioChunks = [];
let recordTimerInterval = null;
let recordSeconds = 0;
let speechRecognizer = null;

const dom = {
  // Diagnóstico
  diagBtn: document.getElementById('diagBtn'),
  diagStatus: document.getElementById('diagStatus'),
  diagOutput: document.getElementById('diagOutput'),
  diagCopyBtn: document.getElementById('diagCopyBtn'),

  // Etapa 1: Voz
  loadModelBtn: document.getElementById('loadModelBtn'),
  loadModelLabel: document.getElementById('loadModelLabel'),
  modelStatus: document.getElementById('modelStatus'),
  modelProgress: document.getElementById('modelProgress'),

  // Etapa 2: IA Generativa
  loadAiBtn: document.getElementById('loadAiBtn'),
  loadAiLabel: document.getElementById('loadAiLabel'),
  aiModelStatus: document.getElementById('aiModelStatus'),
  aiModelProgress: document.getElementById('aiModelProgress'),

  // Etapa 3: Contexto
  specialty: document.getElementById('specialty'),
  modality: document.getElementById('modality'),
  sessionDate: document.getElementById('sessionDate'),

  // Etapa 4: Gravação e Campos
  targetField: document.getElementById('targetField'),
  recordBtn: document.getElementById('recordBtn'),
  stopBtn: document.getElementById('stopBtn'),
  transcribeBtn: document.getElementById('transcribeBtn'),
  recordStatus: document.getElementById('recordStatus'),
  recordTitle: document.getElementById('recordTitle'),
  recordDescription: document.getElementById('recordDescription'),
  recordTimer: document.getElementById('recordTimer'),
  recordIcon: document.getElementById('recordIcon'),

  // Campos estruturados
  objective: document.getElementById('objective'),
  activity: document.getElementById('activity'),
  response: document.getElementById('response'),
  supports: document.getElementById('supports'),
  continuity: document.getElementById('continuity'),
  free: document.getElementById('free'),

  // Ação IA
  organizeAiBtn: document.getElementById('organizeAiBtn'),
  aiStatus: document.getElementById('aiStatus'),

  // Etapa 5: Saída
  generateBtn: document.getElementById('generateBtn'),
  outputText: document.getElementById('outputText'),
  copyBtn: document.getElementById('copyBtn'),
  clearBtn: document.getElementById('clearBtn'),
  copyStatus: document.getElementById('copyStatus')
};

// Data padrão hoje
dom.sessionDate.value = new Date().toISOString().split('T')[0];

// ==========================================
// ETAPA 0: DIAGNÓSTICO DO DISPOSITIVO
// ==========================================
dom.diagBtn.addEventListener('click', async () => {
  dom.diagStatus.textContent = 'Coletando métricas do hardware...';
  const info = {
    userAgent: navigator.userAgent,
    memoryEstimate: navigator.deviceMemory ? `~${navigator.deviceMemory} GB` : 'Não informada pela API',
    hardwareConcurrency: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : 'Desconhecido',
    isCrossOriginIsolated: window.crossOriginIsolated || false,
    webGPU: false,
    shaderF16: false,
    storage: {}
  };

  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        info.webGPU = true;
        info.shaderF16 = adapter.features.has('shader-f16');
        info.limits = {
          maxBufferSize: `${Math.round(adapter.limits.maxBufferSize / (1024 * 1024))} MB`,
          maxStorageBufferBindingSize: `${Math.round(adapter.limits.maxStorageBufferBindingSize / (1024 * 1024))} MB`
        };
      }
    } catch (e) {
      info.webGPUError = e.message;
    }
  }

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      info.storage = {
        usage: `${Math.round((estimate.usage || 0) / (1024 * 1024))} MB`,
        quota: `${Math.round((estimate.quota || 0) / (1024 * 1024))} MB`
      };
    } catch (_) {}
  }

  // Verifica se há registro do último crash
  const lastCrashMarker = localStorage.getItem('last_debug_step');
  if (lastCrashMarker) {
    info.lastCrashMarker = lastCrashMarker;
  }

  dom.diagOutput.textContent = JSON.stringify(info, null, 2);
  dom.diagStatus.textContent = 'Diagnóstico concluído com sucesso.';
  dom.diagStatus.setAttribute('data-kind', 'success');
  dom.diagCopyBtn.disabled = false;
});

dom.diagCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(dom.diagOutput.textContent).then(() => {
    dom.diagStatus.textContent = 'Diagnóstico copiado para a área de transferência!';
  });
});

// ==========================================
// ETAPA 1: PREPARAÇÃO DA VOZ
// ==========================================
// Identifica se há suporte nativo para Speech Recognition (Web Speech API)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

dom.loadModelBtn.addEventListener('click', () => {
  if (SpeechRecognition) {
    dom.modelStatus.textContent = 'Suporte de voz nativo do sistema ativado! Pronto para gravar sem downloads.';
    dom.modelStatus.setAttribute('data-kind', 'success');
    dom.modelProgress.style.width = '100%';
    dom.recordBtn.disabled = false;
    dom.recordStatus.textContent = 'Clique em "Gravar relato" para começar a ditar.';
    dom.loadModelBtn.disabled = true;
    dom.loadModelLabel.textContent = 'Voz nativa do aparelho ativa';
  } else {
    dom.modelStatus.textContent = 'SpeechRecognition nativo não disponível. Usando transcrição padrão via teclado/microfone.';
    dom.recordBtn.disabled = false;
  }
});

// ==========================================
// ETAPA 2: IA GENERATIVA EM WEB WORKER
// ==========================================
function initAiWorker() {
  if (aiWorker) {
    aiWorker.terminate();
  }
  aiWorker = new Worker('./ai-worker.js', { type: 'module' });

  aiWorker.onmessage = (e) => {
    const { type, message, progress, result } = e.data;

    if (type === 'STATUS') {
      dom.aiModelStatus.textContent = message;
    } else if (type === 'PROGRESS') {
      dom.aiModelProgress.style.width = `${progress}%`;
      dom.aiModelStatus.textContent = `Baixando modelo: ${progress}%`;
    } else if (type === 'LOADED') {
      isAiLoaded = true;
      dom.aiModelStatus.textContent = message;
      dom.aiModelStatus.setAttribute('data-kind', 'success');
      dom.aiModelProgress.style.width = '100%';
      dom.loadAiBtn.disabled = true;
      dom.loadAiLabel.textContent = 'IA Generativa pronta no aparelho';
      dom.organizeAiBtn.disabled = false;
      dom.aiStatus.textContent = 'Toque no botão acima para organizar o relato.';
      localStorage.setItem('last_debug_step', 'AI_LOADED_OK');
    } else if (type === 'GENERATED') {
      applyStructuredOutput(result);
      dom.organizeAiBtn.disabled = false;
      dom.aiStatus.textContent = 'Relato organizado pela IA. Revise os campos abaixo.';
      dom.aiStatus.setAttribute('data-kind', 'success');
    } else if (type === 'ERROR') {
      dom.aiModelStatus.textContent = message;
      dom.aiModelStatus.setAttribute('data-kind', 'error');
      dom.loadAiBtn.disabled = false;
      dom.organizeAiBtn.disabled = false;
      dom.aiStatus.textContent = message;
      dom.aiStatus.setAttribute('data-kind', 'error');
    }
  };
}

dom.loadAiBtn.addEventListener('click', () => {
  localStorage.setItem('last_debug_step', `START_LOAD_AI_${new Date().toISOString()}`);
  dom.loadAiBtn.disabled = true;
  dom.aiModelStatus.textContent = 'Inicializando worker isolado...';
  initAiWorker();
  aiWorker.postMessage({ type: 'LOAD_AI' });
});

// ==========================================
// ETAPA 4: GRAVAÇÃO E RECONHECIMENTO DE FALA
// ==========================================
function startTimer() {
  recordSeconds = 0;
  dom.recordTimer.textContent = '00:00';
  recordTimerInterval = setInterval(() => {
    recordSeconds++;
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
    const s = String(recordSeconds % 60).padStart(2, '0');
    dom.recordTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(recordTimerInterval);
}

dom.recordBtn.addEventListener('click', () => {
  if (SpeechRecognition) {
    speechRecognizer = new SpeechRecognition();
    speechRecognizer.lang = 'pt-BR';
    speechRecognizer.continuous = true;
    speechRecognizer.interimResults = true;

    speechRecognizer.onstart = () => {
      startTimer();
      dom.recordBtn.classList.add('recording');
      dom.recordBtn.disabled = true;
      dom.stopBtn.disabled = false;
      dom.recordTitle.textContent = 'Ouvindo e transcrevendo...';
      dom.recordDescription.textContent = 'Fale claramente ao microfone do aparelho.';
      dom.recordIcon.classList.add('active');
    };

    speechRecognizer.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        }
      }
      const target = dom.targetField.value;
      if (dom[target]) {
        dom[target].value = (dom[target].value + ' ' + finalTranscript).trim();
      }
    };

    speechRecognizer.onerror = (event) => {
      dom.recordStatus.textContent = `Aviso do microfone: ${event.error}`;
      stopRecording();
    };

    speechRecognizer.onend = () => {
      stopRecording();
    };

    speechRecognizer.start();
  } else {
    dom.recordStatus.textContent = 'Navegador sem suporte a gravação nativa direta. Por favor, digite no campo abaixo.';
  }
});

function stopRecording() {
  stopTimer();
  dom.recordBtn.classList.remove('recording');
  dom.recordBtn.disabled = false;
  dom.stopBtn.disabled = true;
  dom.recordTitle.textContent = 'Gravação finalizada';
  dom.recordDescription.textContent = 'O texto falado foi inserido no campo selecionado.';
  dom.recordIcon.classList.remove('active');
}

dom.stopBtn.addEventListener('click', () => {
  if (speechRecognizer) {
    speechRecognizer.stop();
  }
  stopRecording();
});

// ==========================================
// ORGANIZAÇÃO COM A IA LOCAL
// ==========================================
dom.organizeAiBtn.addEventListener('click', () => {
  const freeText = dom.free.value.trim();
  if (!freeText && !dom.objective.value && !dom.activity.value) {
    dom.aiStatus.textContent = 'Por favor, insira ou dite um relato no campo "Relato original" antes de organizar.';
    dom.aiStatus.setAttribute('data-kind', 'error');
    return;
  }

  dom.organizeAiBtn.disabled = true;
  dom.aiStatus.textContent = 'Processando com a IA no dispositivo...';

  const userContext = `
Especialidade: ${dom.specialty.value}
Modalidade: ${dom.modality.value}
Relato da sessão: ${freeText}

Campos atuais:
- Objetivo terapêutico: ${dom.objective.value}
- Atividade e estratégias: ${dom.activity.value}
- Resposta observada: ${dom.response.value}
- Apoios necessários: ${dom.supports.value}
- Continuidade / próximos passos: ${dom.continuity.value}

Instrução: Reorganize as informações acima distribuindo-as estritamente no seguinte padrão:
[OBJETIVO]: Habilidade ou meta trabalhada.
[ATIVIDADE]: Descrição da atividade realizada e intervenções.
[RESPOSTA]: Comportamentos do paciente efetivamente observados na sessão.
[APOIOS]: Pistas visuais, verbais ou físicas dadas.
[CONTINUIDADE]: Próximos passos planejados.
Deixe o campo vazio se não foi citado. Nunca invente dados.
`;

  aiWorker.postMessage({
    type: 'ORGANIZE_TEXT',
    payload: { prompt: userContext }
  });
});

function applyStructuredOutput(text) {
  const getSection = (tag) => {
    const regex = new RegExp(`\\[${tag}\\]:?\\s*([\\s\\S]*?)(?=\\[[A-Z]+\\]|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  };

  const obj = getSection('OBJETIVO');
  const act = getSection('ATIVIDADE');
  const resp = getSection('RESPOSTA');
  const supp = getSection('APOIOS');
  const cont = getSection('CONTINUIDADE');

  if (obj) dom.objective.value = obj;
  if (act) dom.activity.value = act;
  if (resp) dom.response.value = resp;
  if (supp) dom.supports.value = supp;
  if (cont) dom.continuity.value = cont;

  // Fallback: se o formato não vier com as tags, insere na área de revisão
  if (!obj && !act && !resp && !supp && !cont) {
    dom.outputText.value = text;
  }
}

// ==========================================
// ETAPA 5: REVISÃO E MONTAGEM DA EVOLUÇÃO
// ==========================================
dom.generateBtn.addEventListener('click', () => {
  const dateFormatted = dom.sessionDate.value
    ? dom.sessionDate.value.split('-').reverse().join('/')
    : 'Data não informada';

  const lines = [
    `EVOLUÇÃO TERAPÊUTICA — PAVM`,
    `Data do Atendimento: ${dateFormatted}`,
    `Especialidade: ${dom.specialty.value}`,
    `Modalidade: ${dom.modality.value}`,
    `--------------------------------------------------`,
    `1. OBJETIVO TERAPÊUTICO:`,
    dom.objective.value.trim() || 'Não informado / Não trabalhado.',
    ``,
    `2. ATIVIDADE E ESTRATÉGIAS:`,
    dom.activity.value.trim() || 'Não informado.',
    ``,
    `3. RESPOSTA OBSERVADA:`,
    dom.response.value.trim() || 'Sem intercorrências ou registros específicos.',
    ``,
    `4. APOIOS NECESSÁRIOS:`,
    dom.supports.value.trim() || 'Nenhum apoio adicional relatado.',
    ``,
    `5. CONTINUIDADE / PRÓXIMOS PASSOS:`,
    dom.continuity.value.trim() || 'Seguimento do plano terapêutico singular.',
    `--------------------------------------------------`,
    `Nota: Documento conferido e revisado pelo profissional responsável.`
  ];

  dom.outputText.value = lines.join('\n');
  dom.copyBtn.disabled = false;
  dom.copyStatus.textContent = 'Evolução montada. Revise o texto acima antes de copiar.';
  dom.copyStatus.setAttribute('data-kind', 'success');
});

dom.copyBtn.addEventListener('click', async () => {
  if (!dom.outputText.value.trim()) return;
  try {
    await navigator.clipboard.writeText(dom.outputText.value);
    dom.copyStatus.textContent = 'Texto copiado com sucesso para a área de transferência!';
    dom.copyStatus.setAttribute('data-kind', 'success');
  } catch (err) {
    dom.copyStatus.textContent = 'Não foi possível copiar automaticamente. Selecione e copie manualmente.';
    dom.copyStatus.setAttribute('data-kind', 'error');
  }
});

dom.clearBtn.addEventListener('click', () => {
  if (confirm('Deseja limpar todos os campos deste atendimento?')) {
    dom.objective.value = '';
    dom.activity.value = '';
    dom.response.value = '';
    dom.supports.value = '';
    dom.continuity.value = '';
    dom.free.value = '';
    dom.outputText.value = '';
    dom.copyBtn.disabled = true;
    dom.copyStatus.textContent = 'Campos limpos com sucesso.';
  }
});