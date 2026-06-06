// panel.js

/* ── Protección ── */
(function verificarAdmin() {
    var esAdmin = sessionStorage.getItem('esAdmin');
    var idUsuario = sessionStorage.getItem('idUsuario');
    if (esAdmin !== 'true' || !idUsuario) {
        window.location.replace('AdPanel.html'); 
        return;
    }
})();

var API_URL = '/api';
var allUsers = [];

document.addEventListener('DOMContentLoaded', cargarUsuarios);

// ── Evento del buscador ──
document.getElementById('searchInput').addEventListener('input', function(e) {
    var searchTerm = e.target.value.toLowerCase();
    var filteredUsers = [];
    
    for (var i = 0; i < allUsers.length; i++) {
        var user = allUsers[i];
        var usuario = (user.NombreUsuario || '').toLowerCase();
        var correo = (user.Correo || '').toLowerCase();
        // ✅ FIX: indexOf en vez de includes
        if (usuario.indexOf(searchTerm) !== -1 || correo.indexOf(searchTerm) !== -1) {
            filteredUsers.push(user);
        }
    }

    renderizarTabla(filteredUsers);
});

// ── Obtener usuarios de la API ──
function cargarUsuarios() {
    fetch(API_URL + '/usuarios', {
        headers: { 'x-user-id': sessionStorage.getItem('idUsuario') || '' }
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.exitoso && data.usuarios && data.usuarios.length > 0) {
            allUsers = data.usuarios;
            renderizarTabla(allUsers);
        } else {
            var tbody = document.getElementById('tabla-usuarios');
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:rgba(255,255,255,0.4);">No hay usuarios registrados</td></tr>';
        }
    })
    .catch(function(error) {
        console.error('Error al cargar usuarios:', error);
        alert('Error al conectar con el servidor para obtener usuarios.');
    });
}

// ── Renderizar la tabla ──
function renderizarTabla(usuarios) {
    var tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';

    if (!usuarios || usuarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:rgba(255,255,255,0.4);">No se encontraron usuarios</td></tr>';
        return;
    }

    for (var i = 0; i < usuarios.length; i++) {
        var user = usuarios[i];
        var tr = document.createElement('tr');
        
        var estadoClass = user.EstaConectado === 1 ? 'badge-active' : 'badge-inactive';
        var estadoText = user.EstaConectado === 1 ? 'Conectado' : 'Desconectado';
        
        var ultimaConexion = 'Nunca';
        if (user.FechaUltimaConexion) {
            try {
                var fecha = new Date(user.FechaUltimaConexion + 'Z');
                ultimaConexion = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            } catch(e) {
                ultimaConexion = user.FechaUltimaConexion;
            }
        }

        var nombreVisible = user.NombreVisible || 'N/A';

        tr.innerHTML = '<td>' + user.NombreUsuario + '</td>' +
            '<td>' + user.Correo + '</td>' +
            '<td>' + nombreVisible + '</td>' +
            '<td><span class="badge ' + estadoClass + '">' + estadoText + '</span></td>' +
            '<td>' + ultimaConexion + '</td>' +
            '<td>' +
                '<button class="btn-action btn-edit" onclick="abrirModalEditar(\'' + user.id + '\', \'' + user.NombreUsuario + '\', \'' + user.Correo + '\', \'' + nombreVisible + '\')">Editar</button>' +
                '<button class="btn-action btn-delete" onclick="abrirModalEliminar(\'' + user.id + '\', \'' + user.NombreUsuario + '\')">Eliminar</button>' +
            '</td>';
            
        tbody.appendChild(tr);
    }
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
    
    document.getElementById('grupo-password').style.display = 'block';
    document.getElementById('input-password').value = '';
    document.getElementById('input-password').required = false;
    document.getElementById('password-hint').textContent = 'Dejar vacío para no cambiar la contraseña.';

    document.getElementById('modal-usuario').classList.add('active');
}

function cerrarModal() {
    document.getElementById('modal-usuario').classList.remove('active');
}

function guardarUsuario(event) {
    event.preventDefault();
    
    var id = document.getElementById('usuario-id').value;
    var usuario = document.getElementById('input-usuario').value;
    var correo = document.getElementById('input-correo').value;
    var nombreVisible = document.getElementById('input-nombre-visible').value;
    var contrasena = document.getElementById('input-password').value;

    var myHeaders = {
        'Content-Type': 'application/json',
        'x-user-id': sessionStorage.getItem('idUsuario') || ''
    };

    var fetchUrl = '';
    var fetchBody = {};

    if (id) {
        fetchUrl = API_URL + '/admin/actualizar-usuario';
        fetchBody = { idUsuario: id, nombreVisible: nombreVisible };
        if (contrasena) fetchBody.contrasena = contrasena;
    } else {
        if (!contrasena) {
            alert('La contraseña es requerida para nuevos usuarios');
            return;
        }
        fetchUrl = API_URL + '/registro';
        fetchBody = { usuario: usuario, correo: correo, contrasena: contrasena };
    }

    fetch(fetchUrl, {
        method: 'POST',
        headers: myHeaders,
        body: JSON.stringify(fetchBody)
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.exitoso || data.idUsuario) {
            alert(id ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente');
            cerrarModal();
            cargarUsuarios();
        } else {
            alert('Error: ' + (data.error || 'No se pudo guardar el usuario'));
        }
    })
    .catch(function(error) {
        console.error('Error al guardar:', error);
        alert('Error de conexión al guardar');
    });
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

function confirmarEliminar() {
    var id = document.getElementById('eliminar-id').value;

    var myHeaders = {
        'Content-Type': 'application/json',
        'x-user-id': sessionStorage.getItem('idUsuario') || ''
    };

    fetch(API_URL + '/admin/eliminar-usuario', {
        method: 'POST',
        headers: myHeaders,
        body: JSON.stringify({ idUsuario: id })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.exitoso) {
            alert('Usuario eliminado correctamente');
            cerrarModalEliminar();
            cargarUsuarios();
        } else {
            alert('Error: ' + (data.error || 'No se pudo eliminar'));
        }
    })
    .catch(function(error) {
        console.error('Error al eliminar:', error);
        alert('Error de conexión al eliminar');
    });
}