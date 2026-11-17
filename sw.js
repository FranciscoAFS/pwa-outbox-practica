
// Importar IndexedDB
importScripts('./db-helper.js');

// CONFIGURACIÓN DE CACHÉ
const CACHE_STATIC_NAME = 'static-outbox-v2';

const STATIC_FILES = [
    './',
    './index.html',
    './styles.css',
    './db-helper.js',
    './app.js',
    './manifest.json'
];

// INSTALACIÓN DEL SERVICE WORKER
self.addEventListener('install', (event) => {
    console.log('[SW] Service Worker instalado');

    event.waitUntil(
        caches.open(CACHE_STATIC_NAME)
            .then((cache) => {
                return cache.addAll(STATIC_FILES);
            })
    );
});

// ACTIVACIÓN DEL SERVICE WORKER
self.addEventListener('activate', (event) => {
    const listaBlanca = [CACHE_STATIC_NAME];

    event.waitUntil(
        caches.keys()
            .then((nombresCaches) => {
                return Promise.all(
                    nombresCaches.map((nombreCache) => {
                        if (!listaBlanca.includes(nombreCache)) {
                            console.log('[SW] Eliminando caché antigua:', nombreCache);
                            return caches.delete(nombreCache);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// ESTRATEGIA CACHE FIRST
function cacheFirstEvolucionado(request) {
    return caches.match(request)
        .then((respuestaCache) => {
            if (respuestaCache) {
                return respuestaCache;
            }

            return fetch(request)
                .then((respuestaRed) => {
                    if (!respuestaRed || respuestaRed.status !== 200) {
                        return respuestaRed;
                    }

                    return caches.open(CACHE_STATIC_NAME)
                        .then((cache) => {
                            cache.put(request, respuestaRed.clone());
                            return respuestaRed;
                        });
                });
        });
}

// INTERCEPTAR PETICIONES
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (
        event.request.method === 'GET' &&
        url.origin === location.origin
    ) {
        event.respondWith(cacheFirstEvolucionado(event.request));
    }
});

// NOTIFICAR A LAS PESTAÑAS ABIERTAS
function notificarClientesActualizacion() {
    return self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    })
        .then((clientes) => {
            clientes.forEach((cliente) => {
                cliente.postMessage({
                    tipo: 'OUTBOX_SINCRONIZADO',
                    timestamp: Date.now()
                });
            });
        });
}

// SINCRONIZAR REPORTES PENDIENTES
function sincronizarPendientesSW() {
    console.log('[SW-Sync] Buscando reportes pendientes...');

    return obtenerTodosLosRegistros()
        .then((registros) => {
            const pendientes = registros.filter(
                (item) => item.estado === 'pendiente'
            );

            if (pendientes.length === 0) {
                console.log('[SW-Sync] No hay reportes pendientes.');
                return;
            }

            const promesasDeEnvio = pendientes.map((item) => {
                return fetch('https://jsonplaceholder.typicode.com/posts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: item.titulo,
                        body: item.descripcion
                    })
                })
                    .then((respuesta) => {
                        if (!respuesta.ok) {
                            throw new Error(
                                `Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`
                            );
                        }

                        return actualizarEstadoRegistro(
                            item.id,
                            'sincronizado'
                        );
                    });
            });

            return Promise.all(promesasDeEnvio)
                .then(() => {
                    console.log('[SW-Sync] Reportes sincronizados correctamente.');
                    return notificarClientesActualizacion();
                });
        });
}

// ESCUCHAR BACKGROUND SYNC
self.addEventListener('sync', (event) => {
    console.log('[SW-Sync] Evento recibido:', event.tag);

    if (event.tag === 'sync-reportes') {
        event.waitUntil(
            sincronizarPendientesSW()
                .catch((error) => {
                    console.error(
                        '[SW-Sync] Error durante la sincronización:',
                        error
                    );

                    // Permitir que el navegador intente nuevamente
                    throw error;
                })
        );
    }
});
