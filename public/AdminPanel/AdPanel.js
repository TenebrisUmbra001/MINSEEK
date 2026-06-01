// AdPanel.js

async function InicioAdministrador() {
    // 1. Obtener lo que el usuario escribió en los inputs
    const usuario = document.getElementById('input-usuario').value.trim();
    const contrasena = document.getElementById('input-password').value.trim();

    // 2. Validar que no estén vacíos
    if (!usuario || !contrasena) {
        alert('Por favor, ingrese usuario y contraseña.');
        return;
    }

    // 3. Lista de usuarios permitidos para entrar a este panel (en minúsculas)
    const USUARIOS_ADMIN = ['admin', 'administrador']; 

    try {
        // 4. Llamar a tu API de login existente
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, contrasena })
        });

        const result = await response.json();

        // 5. Si el login fue exitoso...
        if (result.exitoso) {
            
            // 6. PREGUNTA CLAVE: ¿El usuario que inició sesión es Admin?
            if (USUARIOS_ADMIN.includes(result.usuario.toLowerCase())) {
                
                // 7. Guardar la sesión y el permiso de administrador
                sessionStorage.setItem('idUsuario', result.idUsuario);
                sessionStorage.setItem('idConexion', result.idConexion);
                sessionStorage.setItem('usuario', result.usuario);
                sessionStorage.setItem('esAdmin', 'true'); // 🔒 LLAVE DE SEGURIDAD

                // 8. Redirigir al panel
                window.location.href = 'panel.html';

            } else {
                // Si las credenciales son buenas pero NO es admin, lo echamos
                alert('Acceso denegado. Este panel es exclusivo para Administradores.');
                
                // Cerramos la sesión que acabamos de abrir para que no quede activa en el chat
                await fetch('/api/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idConexion: result.idConexion })
                });
            }
        } else {
            // Si la API dice que la contraseña o usuario están mal
            alert('Credenciales incorrectas: ' + (result.error || 'Verifique su usuario y contraseña.'));
        }
    } catch (error) {
        console.error('Error al intentar iniciar sesión:', error);
        alert('Error de conexión con el servidor. Intente más tarde.');
    }
}