const CACHE_NAME = 'evolucao-voz-v2.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './ai-worker.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRUCIAL PARA PREVENIR O CRASH DO CHROME NO CELULAR:
  // Nunca intercepte nem tente cachear arquivos gigantes de modelos ONNX
  // ou chamadas de CDN via Service Worker. Deixe o Cache API do Transformers.js gerenciar.
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('hf.co') ||
    url.pathname.endsWith('.onnx') ||
    url.pathname.endsWith('.bin') ||
    url.pathname.endsWith('.wasm')
  ) {
    return; // Passa direto para a rede nativa
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});