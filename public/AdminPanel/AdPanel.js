// AdPanel.js

function InicioAdministrador() {
    var usuario = document.getElementById('input-usuario').value.trim();
    var contrasena = document.getElementById('input-password').value.trim();

    if (!usuario || !contrasena) {
        alert('Por favor, ingrese usuario y contraseña.');
        return;
    }

    var USUARIOS_ADMIN = ['admin', 'administrador'];

    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario, contrasena: contrasena })
    })
    .then(function(response) { return response.json(); })
    .then(function(result) {
        if (result.exitoso) {
            // ✅ FIX: includes() no existe en FF43, usamos indexOf()
            if (USUARIOS_ADMIN.indexOf(result.usuario.toLowerCase()) !== -1) {
                
                sessionStorage.setItem('idUsuario', result.idUsuario);
                sessionStorage.setItem('idConexion', result.idConexion);
                sessionStorage.setItem('usuario', result.usuario);
                sessionStorage.setItem('esAdmin', 'true');

                window.location.href = 'panel.html';

            } else {
                alert('Acceso denegado. Este panel es exclusivo para Administradores.');
                
                // Cerramos la sesión que acabamos de abrir
                fetch('/api/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idConexion: result.idConexion })
                });
            }
        } else {
            alert('Credenciales incorrectas: ' + (result.error || 'Verifique su usuario y contraseña.'));
        }
    })
    .catch(function(error) {
        console.error('Error al intentar iniciar sesión:', error);
        alert('Error de conexión con el servidor. Intente más tarde.');
    });
}