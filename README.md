# Evolução por Voz — protótipo PWA com IA generativa local

Protótipo demonstrativo em português para celular (iOS e Android). É uma aplicação web instalável (PWA), sem cadastro de pacientes, banco de dados clínico ou API paga.

## Fluxo da versão atual

1. Carregar o modelo de reconhecimento de voz (Whisper via Transformers.js).
2. Carregar o modelo de linguagem generativa (Qwen2.5-0.5B-Instruct via Transformers.js).
3. Gravar um relato com ação explícita do usuário, ou digitar um relato fictício.
4. Transcrever o áudio localmente para o campo “Relato original”.
5. Tocar em **Organizar relato com IA local**. A IA tenta reescrever e distribuir o conteúdo nos campos objetivo, atividade, resposta observada, apoios e continuidade.
6. Revisar e corrigir cada campo, montar o texto final e copiá-lo.

## Modelos e downloads

- Voz: `onnx-community/whisper-tiny`, quantizado em Q8.
- Organização textual: `onnx-community/Qwen2.5-0.5B-Instruct`.
- Em aparelhos com WebGPU disponível, o protótipo tenta `q4f16` para o modelo generativo. Em celulares, se WebGPU não estiver disponível, a aplicação interrompe a tentativa em vez de iniciar o modo WASM/CPU `q8`, para reduzir o risco de o navegador ser encerrado por excesso de memória.
- A variante `q4f16` publicada no repositório do modelo tem cerca de 483 MB; a variante Q8 tem cerca de 512 MB, além de arquivos auxiliares, da biblioteca e do modelo de voz. Os tamanhos e suporte real variam com a configuração escolhida e podem mudar no repositório upstream.
- A primeira configuração requer internet para carregar a biblioteca e baixar os pesos. O cache local pode permitir reutilização posterior, mas não se garante operação totalmente offline em todo navegador/dispositivo.

## Privacidade: o que este protótipo faz e não faz

- A lógica da aplicação executa a inferência de voz e de texto no navegador; não implementa chamadas a uma API de IA para enviar áudios, transcrições ou evoluções.
- O áudio gravado fica em memória durante o fluxo e é descartado após transcrição ou limpeza.
- Os campos clínicos não são salvos pelo app em `localStorage`, banco de dados ou servidor. Não há cadastro nem histórico de pacientes.
- Ao copiar, o texto passa para a área de transferência do aparelho. O aplicativo não consegue controlar o que o usuário faz depois com essa cópia.
- O app depende de uma biblioteca importada de CDN e de pesos baixados dos repositórios públicos de modelos na primeira carga. Logo, esse protótipo **não foi auditado quanto à cadeia de fornecimento**, e não deve ser considerado uma aplicação de produção ou uma garantia absoluta de privacidade.
- Não usar dados pessoais ou de saúde reais. Antes de qualquer uso clínico, são necessárias validação técnica, de segurança, institucional e jurídica/LGPD.

## Limitações conhecidas

- Não foi testado em aparelhos físicos iOS/Android nem numa variedade de navegadores.
- O modelo generativo tem 0,5 bilhão de parâmetros e foi escolhido para reduzir o custo computacional. Pode responder lentamente, falhar ao produzir JSON válido, omitir conteúdo ou inventar informações. A interface preserva os campos se a resposta estruturada for inválida, mas o profissional deve revisar toda informação.
- O protótipo agora tenta manter apenas um modelo pesado carregado por vez: libera Whisper antes de carregar Qwen e libera Qwen antes de carregar Whisper. Isso reduz, mas não elimina, o risco de falta de memória. Em celulares, o modo CPU/WASM para a IA generativa é bloqueado quando WebGPU não está disponível. O modelo ainda pode ser grande demais para determinados aparelhos.
- O navegador pode suspender a aba, limitar memória ou apagar caches.
- Não há integração automática com prontuário, login profissional, assinatura, trilha de auditoria institucional, permissões por função, backup ou sincronização.
- O texto final é apenas um rascunho. A pessoa profissional é responsável por validar e inserir a evolução no sistema autorizado.

## Publicar gratuitamente para teste

1. Crie um repositório de teste no GitHub e envie os arquivos desta pasta.
2. Em **Settings → Pages**, publique a branch principal a partir da raiz do repositório.
3. Abra a URL HTTPS gerada no Safari (iPhone) ou Chrome (Android).
4. No iPhone, use **Compartilhar → Adicionar à Tela de Início**. No Android, use o menu do Chrome → **Instalar app** ou **Adicionar à tela inicial**.
5. Teste inicialmente em Wi-Fi com o texto e os áudios fictícios. Carregar ambos os modelos pode exigir centenas de MB de download e bastante espaço livre.

## Personalização

Campos institucionais e texto de interface estão em `index.html`. A transcrição e a organização local estão em `app.js`; o prompt está na função `organizeWithAI()`. Os campos utilizados na saída final estão em `buildEvolution()`.

## Referências técnicas

- Transformers.js / WebGPU: https://huggingface.co/docs/transformers.js/guides/webgpu
- Modelo generativo ONNX: https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct
- Modelo de voz ONNX: https://huggingface.co/onnx-community/whisper-tiny


## Se o Chrome reiniciar ao terminar o download da IA

1. Não tente carregar repetidamente; feche outras abas e aplicativos pesados e reinicie o celular uma vez.
2. Atualize o arquivo `app.js`, `index.html`, `sw.js` e `README.md` no repositório GitHub pelo ZIP corrigido. O `sw.js` usa uma nova versão de cache para que o navegador busque os arquivos atualizados.
3. Abra o endereço do site no Chrome e recarregue. Se ainda mostrar a interface antiga, limpe os dados do site desse endereço e abra novamente; isso pode obrigar a baixar os modelos outra vez.
4. Carregue a IA generativa primeiro, sem iniciar o modelo Whisper. A nova versão libera automaticamente o modelo de voz antes de carregar a IA.
5. Se o Chrome continuar reiniciando, não force modo CPU/WASM. Isso indica que o modelo local pode ser grande demais para a memória disponível desse celular ou que o WebGPU não está compatível. Neste caso, a solução é trocar por modelo menor ou por outra arquitetura; não é possível garantir IA generativa local em todo telefone.
