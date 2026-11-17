if ('serviceWorker' in navigator) {

    // Escuchar mensajes del Service Worker (Tema 5.3 - Fragmento G)
    navigator.serviceWorker.addEventListener('message', function (event) {
        if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
            console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
            renderizarColaOutbox();
        }
    });

    // Registrar el SW con ruta relativa para GitHub Pages
    navigator.serviceWorker.register('./sw.js')
        .then(function (reg) {
            console.log('[SW] Service Worker registrado. Scope:', reg.scope);
        })
        .catch(function (error) {
            console.error('[SW] Error al registrar Service Worker:', error);
        });
}

function procesarEnvioReporte(datosFormulario) {
    const endpoint = 'https://jsonplaceholder.typicode.com/posts';

    return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosFormulario)
    })
        .then((respuesta) => {
            if (!respuesta.ok) throw new Error('Error HTTP del servidor');
            return respuesta.json();
        })
        .then(() => {
            // Envío exitoso en vivo: registrar en bitácora local como sincronizado
            return guardarRegistro({
                ...datosFormulario,
                estado: 'sincronizado',
                fechaCreacion: Date.now()
            });
        })
        .catch(() => {
            console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

            return guardarRegistro({
                ...datosFormulario,
                estado: 'pendiente',
                fechaCreacion: Date.now()
            })
                .then(() => {
                    // Detección de soporte para Background Sync API
                    if ('serviceWorker' in navigator && 'SyncManager' in window) {
                        return navigator.serviceWorker.ready
                            .then((registro) => {
                                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                                return registro.sync.register('sync-reportes');
                            });
                    }
                });
        })
        .then(() => {
            // Actualizar la lista visual en ambos escenarios
            return renderizarColaOutbox();
        });
}

function sincronizarPendientesFallback() {
    console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

    return obtenerTodosLosRegistros()
        .then((registros) => {
            const pendientes = registros.filter((item) => item.estado === 'pendiente');

            if (pendientes.length === 0) {
                console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
                return;
            }

            // Convertir cada registro pendiente en una promesa de envío + actualización
            const promesasDeEnvio = pendientes.map((item) => {
                return fetch('https://jsonplaceholder.typicode.com/posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: item.titulo, body: item.descripcion })
                })
                    .then((res) => {
                        if (!res.ok) throw new Error('Falla al reintentar envío');
                        // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
                        return actualizarEstadoRegistro(item.id, 'sincronizado');
                    });
            });

            // Esperar a que todos los reenvíos concluyan
            return Promise.all(promesasDeEnvio);
        })
        .then(() => {
            return renderizarColaOutbox();
        })
        .catch((error) => {
            console.error('[Outbox] Error durante la sincronización masiva:', error);
        });
}

window.addEventListener('online', () => {
    actualizarIndicadorRed();

    // Degradación elegante: Solo sincronizar desde UI si el navegador NO soporta Background Sync (ej. Safari/iOS)
    if (!('SyncManager' in window)) {
        console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
        sincronizarPendientesFallback();
    }
});

window.addEventListener('offline', actualizarIndicadorRed);

// 1. READ: RENDERIZAR COLA OUTBOX

function renderizarColaOutbox() {
    const lista = document.getElementById('lista-outbox');

    return obtenerTodosLosRegistros()
        .then((registros) => {

            lista.innerHTML = '';

            registros.forEach((item) => {
                const li = document.createElement('li');

                const fecha = new Date(item.fechaCreacion);
                const hora = fecha.toLocaleString('es-MX');

                li.textContent =
                    `${item.titulo} | Estado: ${item.estado} | Fecha: ${hora}`;

                lista.appendChild(li);
            });

        })
        .catch((error) => {
            console.error('Error al mostrar la cola:', error);
        });
}


// 2. CONEXIÓN DEL FORMULARIO

const formulario = document.getElementById('form-incidencia');

formulario.addEventListener('submit', (e) => {
    e.preventDefault();

    const datosFormulario = {
        titulo: document.getElementById('titulo').value,
        descripcion: document.getElementById('descripcion').value
    };

    procesarEnvioReporte(datosFormulario)
        .then(() => {
            formulario.reset();
        })
        .catch((error) => {
            console.error('Error al procesar el reporte:', error);
        });
});


// 3. DELETE: PURGAR REGISTROS SINCRONIZADOS

const botonPurgar = document.getElementById('btn-purgar');

botonPurgar.addEventListener('click', () => {

    obtenerTodosLosRegistros()
        .then((registros) => {

            const sincronizados = registros.filter(
                (item) => item.estado === 'sincronizado'
            );

            const promesasEliminacion = sincronizados.map((item) => {
                return eliminarRegistro(item.id);
            });

            return Promise.all(promesasEliminacion);

        })
        .then(() => {
            console.log('Registros sincronizados eliminados.');
            return renderizarColaOutbox();
        })
        .catch((error) => {
            console.error('Error al purgar registros:', error);
        });

});


renderizarColaOutbox();

function actualizarIndicadorRed() {
    const badge = document.getElementById('badge-red');

    if (navigator.onLine) {
        badge.textContent = 'En Línea';
        badge.classList.remove('offline');
        badge.classList.add('online');
    } else {
        badge.textContent = 'Sin Conexión';
        badge.classList.remove('online');
        badge.classList.add('offline');
    }
}

actualizarIndicadorRed();