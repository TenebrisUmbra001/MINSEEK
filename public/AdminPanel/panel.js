// panel.js

/* ── Protección: Verificar que hay sesión de Administrador activa ── */
(function verificarAdmin() {
    var esAdmin = sessionStorage.getItem('esAdmin');
    var idUsuario = sessionStorage.getItem('idUsuario');
    
    // Si no es admin o no hay sesión, lo echamos al login
    if (esAdmin !== 'true' || !idUsuario) {
        window.location.replace('AdPanel.html'); 
        return;
    }
})();

// URL base de tu API Pública
const API_URL = '/api';

// Variable global para guardar todos los usuarios y filtrarlos en el buscador
let allUsers = [];

// Cargar usuarios al iniciar
document.addEventListener('DOMContentLoaded', cargarUsuarios);

// ── Evento del buscador ──
document.getElementById('searchInput').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    
    // Filtrar los usuarios guardados en memoria
    const filteredUsers = allUsers.filter(user => {
        const usuario = (user.NombreUsuario || '').toLowerCase();
        const correo = (user.Correo || '').toLowerCase();
        return usuario.includes(searchTerm) || correo.includes(searchTerm);
    });

    renderizarTabla(filteredUsers);
});

// ── Obtener usuarios de la API ──
async function cargarUsuarios() {
    try {
        const response = await fetch(`${API_URL}/usuarios`, {
            headers: { 'x-user-id': sessionStorage.getItem('idUsuario') || '' } // 🔒 Seguridad extra para el backend
        });
        const data = await response.json();
        
        if (data.exitoso && data.usuarios.length > 0) {
            allUsers = data.usuarios; // Guardamos en memoria
            renderizarTabla(allUsers); // Renderizamos todos
        } else {
            const tbody = document.getElementById('tabla-usuarios');
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:rgba(255,255,255,0.4);">No hay usuarios registrados</td></tr>';
        }
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        alert('Error al conectar con el servidor para obtener usuarios.');
    }
}

// ── Renderizar la tabla con los datos dados ──
function renderizarTabla(usuarios) {
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';

    if (usuarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:rgba(255,255,255,0.4);">No se encontraron usuarios</td></tr>';
        return;
    }

    usuarios.forEach(user => {
        const tr = document.createElement('tr');
        
        // Determinar estado (En la BD SQLite los booleanos son 1 o 0)
        const estadoClass = user.EstaConectado === 1 ? 'badge-active' : 'badge-inactive';
        const estadoText = user.EstaConectado === 1 ? 'Conectado' : 'Desconectado';
        
        // Formatear fecha de última conexión
        let ultimaConexion = 'Nunca';
        if (user.FechaUltimaConexion) {
            try {
                const fecha = new Date(user.FechaUltimaConexion + 'Z'); // Añadir Z para UTC si viene sin ella
                ultimaConexion = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            } catch(e) {
                ultimaConexion = user.FechaUltimaConexion;
            }
        }

        tr.innerHTML = `
            <td>${user.NombreUsuario}</td>
            <td>${user.Correo}</td>
            <td>${user.NombreVisible || 'N/A'}</td>
            <td><span class="badge ${estadoClass}">${estadoText}</span></td>
            <td>${ultimaConexion}</td>
            <td>
                <button class="btn-action btn-edit" onclick="abrirModalEditar('${user.id}', '${user.NombreUsuario}', '${user.Correo}', '${user.NombreVisible || ''}')">Editar</button>
                <button class="btn-action btn-delete" onclick="abrirModalEliminar('${user.id}', '${user.NombreUsuario}')">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- LÓGICA MODAL CREAR/EDITAR ---
function abrirModalCrear() {
    document.getElementById('modal-titulo').textContent = 'Crear Nuevo Usuario';
    document.getElementById('usuario-id').value = '';
    document.getElementById('form-usuario').reset();
    document.getElementById('grupo-password').style.display = 'block';
    document.getElementById('input-password').required = true;
    document.getElementById('password-hint').textContent = 'Mínimo 8 caracteres, mayúsculas, minúsculas y números.';
    document.getElementById('modal-usuario').classList.add('active');
}

function abrirModalEditar(id, usuario, correo, nombreVisible) {
    document.getElementById('modal-titulo').textContent = 'Editar Usuario';
    document.getElementById('usuario-id').value = id;
    document.getElementById('input-usuario').value = usuario;
    document.getElementById('input-correo').value = correo;
    document.getElementById('input-nombre-visible').value = nombreVisible;
    
    // Al editar, la contraseña no es obligatoria cambiarla
    document.getElementById('grupo-password').style.display = 'block';
    document.getElementById('input-password').value = '';
    document.getElementById('input-password').required = false;
    document.getElementById('password-hint').textContent = 'Dejar vacío para no cambiar la contraseña.';

    document.getElementById('modal-usuario').classList.add('active');
}

function cerrarModal() {
    document.getElementById('modal-usuario').classList.remove('active');
}

async function guardarUsuario(event) {
    event.preventDefault();
    
    const id = document.getElementById('usuario-id').value;
    const usuario = document.getElementById('input-usuario').value;
    const correo = document.getElementById('input-correo').value;
    const nombreVisible = document.getElementById('input-nombre-visible').value;
    const contrasena = document.getElementById('input-password').value;

    // 🔒 Headers con ID del admin para validar en el backend
    const myHeaders = {
        'Content-Type': 'application/json',
        'x-user-id': sessionStorage.getItem('idUsuario') || ''
    };

    try {
        let response;
        if (id) {
            // EDITAR (Usamos la ruta de admin)
            const body = { idUsuario: id, nombreVisible: nombreVisible };
            if (contrasena) body.contrasena = contrasena; // Solo se envía si se llenó
            
            response = await fetch(`${API_URL}/admin/actualizar-usuario`, {
                method: 'POST',
                headers: myHeaders,
                body: JSON.stringify(body)
            });
        } else {
            // CREAR
            if (!contrasena) {
                alert('La contraseña es requerida para nuevos usuarios');
                return;
            }
            response = await fetch(`${API_URL}/registro`, {
                method: 'POST',
                headers: myHeaders,
                body: JSON.stringify({ usuario, correo, contrasena })
            });
        }

        const data = await response.json();
        
        if (data.exitoso || data.idUsuario) {
            alert(id ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente');
            cerrarModal();
            cargarUsuarios(); // Refrescar la tabla
        } else {
            alert('Error: ' + (data.error || 'No se pudo guardar el usuario'));
        }
    } catch (error) {
        console.error('Error al guardar:', error);
        alert('Error de conexión al guardar');
    }
}

// --- LÓGICA MODAL ELIMINAR ---
function abrirModalEliminar(id, nombre) {
    document.getElementById('eliminar-id').value = id;
    document.getElementById('nombre-eliminar').textContent = nombre;
    document.getElementById('modal-eliminar').classList.add('active');
}

function cerrarModalEliminar() {
    document.getElementById('modal-eliminar').classList.remove('active');
}

async function confirmarEliminar() {
    const id = document.getElementById('eliminar-id').value;

    // 🔒 Headers con ID del admin para validar en el backend
    const myHeaders = {
        'Content-Type': 'application/json',
        'x-user-id': sessionStorage.getItem('idUsuario') || ''
    };

    try {
        const response = await fetch(`${API_URL}/admin/eliminar-usuario`, {
            method: 'POST',
            headers: myHeaders,
            body: JSON.stringify({ idUsuario: id })
        });
        const data = await response.json();
        
        if (data.exitoso) {
            alert('Usuario eliminado correctamente');
            cerrarModalEliminar();
            cargarUsuarios(); // Refrescar la tabla
        } else {
            alert('Error: ' + (data.error || 'No se pudo eliminar'));
        }
    } catch (error) {
        console.error('Error al eliminar:', error);
        alert('Error de conexión al eliminar');
    }
}