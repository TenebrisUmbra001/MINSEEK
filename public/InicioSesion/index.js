/* ========================================
   INICIO DE SESIÓN - Login
======================================== */

async function Iniciar() {
    const usuario = document.getElementById('User').value.trim();
    const contrasena = document.getElementById('pass').value;

    // Validaciones básicas
    if (!usuario || !contrasena) {
        alert('Por favor, ingrese usuario y contraseña.');
        return;
    }

    // Mostrar estado de carga
    const btn = document.querySelector('.btn-login');
    const span = btn.querySelector('span');
    const textoOriginal = span.textContent;
    
    btn.disabled = true;
    span.textContent = 'Iniciando...';

    try {
        // Enviar solicitud de login a la API pública
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario: usuario,
                contrasena: contrasena
            })
        });

        const data = await response.json();

        if (data.exitoso) {
            // Login exitoso
            console.log('✅ Login exitoso:', data);

            // Guardar en sesión
            sessionStorage.setItem('idUsuario', data.idUsuario);
            sessionStorage.setItem('usuario', data.usuario);
            sessionStorage.setItem('correo', data.correo);
            sessionStorage.setItem('idConexion', data.idConexion);

            alert('✅ ¡Bienvenido ' + data.usuario + '!');

            // Redirigir al dashboard/chatbot
            window.location.href = '/Chatbot/ChatMinSeek.html';
        } else {
            // Login fallido
            // ✅ MEJORA: Limpiar el campo de contraseña por seguridad/UX
            document.getElementById('pass').value = '';
            document.getElementById('User').focus(); // Poner el foco en el usuario
            
            // ✅ MEJORA: Mensaje genérico y claro (el backend ya devuelve uno seguro)
            alert('❌ ' + (data.error || 'Usuario o contraseña incorrectos.'));
        }
    } catch (error) {
        console.error('Error en login:', error);
        alert('❌ Error al conectar con el servidor. Intenta más tarde.');
    } finally {
        // Restaurar botón
        btn.disabled = false;
        span.textContent = textoOriginal;
    }
}

/* ========================================
   Función para logout
======================================== */

async function Logout() {
    const idConexion = sessionStorage.getItem('idConexion');

    if (!idConexion) {
        console.warn('No hay sesión activa');
        // Aún así redirigimos al login por si quedó sesión basura
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idConexion: idConexion
            })
        });

        const data = await response.json();

        if (data.exitoso) {
            console.log('✅ Sesión cerrada en el servidor');
        } else {
            console.error('Error cerrando sesión en servidor:', data.error);
        }
    } catch (error) {
        console.error('Error de red en logout:', error);
    } finally {
        // ✅ MEJORA: Siempre limpiar la sesión local y redirigir, falle o no la API
        sessionStorage.clear();
        window.location.href = '/';
    }
}

/* ========================================
   ✅ NUEVO: Permitir login con tecla Enter
======================================== */
document.addEventListener('DOMContentLoaded', function() {
    const inputPass = document.getElementById('pass');
    const inputUser = document.getElementById('User');

    // Si presiona Enter en el campo de usuario, pasar al de contraseña
    inputUser.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            inputPass.focus();
        }
    });

    // Si presiona Enter en el campo de contraseña, iniciar sesión
    inputPass.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            Iniciar();
        }
    });
});